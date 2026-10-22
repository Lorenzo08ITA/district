import { TAU, clamp, Vec3 } from './math.js';
import { PlayerInput, KinematicState } from './kinematics.js';
export const VELOCITY_SCALE = 512;
export const MAX_FPS_VELOCITY = 32767 / VELOCITY_SCALE;
export const FPS_PROTOCOL_VERSION = 1,
  MAX_FPS_PACKET_BYTES = 65536,
  MAX_INPUTS_PER_PACKET = 32,
  MAX_SNAPSHOT_PLAYERS = 64;
const MAGIC = 0x31535046,
  HEADER = 16,
  INPUT_BYTES = 24,
  SNAPSHOT_BYTES = 128,
  HIT_BYTES = 32;
export enum FpsPacketKind {
  Inputs = 1,
  Snapshot = 2,
  Fire = 3,
  HitConfirm = 4,
}
export class FpsProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FpsProtocolError';
  }
}
const finite = (n: number, min: number, max: number): boolean =>
  Number.isFinite(n) && n >= min && n <= max;
const integer = (n: number, min: number, max: number): boolean =>
  Number.isInteger(n) && n >= min && n <= max;
export function packAngle(angle: number): number {
  return Math.round(((((angle % TAU) + TAU) % TAU) / TAU) * 65535);
}
export function unpackAngle(angle: number): number {
  return (angle / 65535) * TAU;
}
function unpackPitch(angle: number): number {
  const value = unpackAngle(angle);
  const signed = value > Math.PI ? value - TAU : value;
  return Math.abs(signed) <= Math.PI / 2 + 0.0001
    ? clamp(signed, -Math.PI / 2, Math.PI / 2)
    : signed;
}
export function quantizeInput(out: PlayerInput, input: Readonly<PlayerInput>): PlayerInput {
  out.copy(input);
  out.yaw = unpackAngle(packAngle(input.yaw));
  out.pitch = unpackPitch(packAngle(input.pitch));
  out.subTickFraction = Math.fround(input.subTickFraction);
  out.moveX = Math.round(input.moveX * 127) / 127;
  out.moveZ = Math.round(input.moveZ * 127) / 127;
  return out;
}
export class PlayerSnapshot {
  playerId = 1;
  weapon = 0;
  lastProcessedSeq = 0;
  readonly state = new KinematicState();
  yaw = 0;
  pitch = 0;
  hp = 100;
  ammo = 30;
  reserve = 120;
  nextFire = 0;
  reloadUntil = 0;
  bloom = 0;
  shots = 0;
}
export class HitConfirm {
  shotSequence = 0;
  victimId = 1;
  isHeadshot = false;
  isKill = false;
  zone = 0;
  damageDealt = 0;
  readonly hitPosition = new Vec3();
  serverTick = 0;
  subTickFraction = 0;
}
function stride(kind: FpsPacketKind): number {
  switch (kind) {
    case FpsPacketKind.Inputs:
    case FpsPacketKind.Fire:
      return INPUT_BYTES;
    case FpsPacketKind.Snapshot:
      return SNAPSHOT_BYTES;
    case FpsPacketKind.HitConfirm:
      return HIT_BYTES;
    default:
      throw new FpsProtocolError('Unknown FPS packet kind');
  }
}
function validInput(input: Readonly<PlayerInput>): boolean {
  return (
    integer(input.sequenceNumber, 0, 0xffffffff) &&
    integer(input.clientTick, 0, 0xffffffff) &&
    finite(input.subTickFraction, 0, 1) &&
    finite(input.yaw, -1e6, 1e6) &&
    finite(input.pitch, -Math.PI / 2, Math.PI / 2) &&
    finite(input.moveX, -1, 1) &&
    finite(input.moveZ, -1, 1) &&
    integer(input.buttons, 0, 127) &&
    integer(input.weapon, 0, 5)
  );
}
/** Cached exact-length views avoid subarray/new DataView allocation when finishing hot-path packets. */
function validSnapshot(snapshot: Readonly<PlayerSnapshot>): boolean {
  const s = snapshot.state;
  return (
    integer(snapshot.playerId, 1, 65535) &&
    integer(snapshot.weapon, 0, 5) &&
    integer(snapshot.lastProcessedSeq, 0, 0xffffffff) &&
    integer(s.tick, 0, 0xffffffff) &&
    finite(s.position.x, -1e7, 1e7) &&
    finite(s.position.y, -1e7, 1e7) &&
    finite(s.position.z, -1e7, 1e7) &&
    finite(s.velocity.x, -MAX_FPS_VELOCITY, MAX_FPS_VELOCITY) &&
    finite(s.velocity.y, -MAX_FPS_VELOCITY, MAX_FPS_VELOCITY) &&
    finite(s.velocity.z, -MAX_FPS_VELOCITY, MAX_FPS_VELOCITY) &&
    finite(s.groundNormal.x, -1, 1) &&
    finite(s.groundNormal.y, -1, 1) &&
    finite(s.groundNormal.z, -1, 1) &&
    Math.abs(s.groundNormal.lengthSquared() - 1) < 0.001 &&
    finite(s.eyeHeight, 0, 2) &&
    finite(s.slideTimeMs, 0, 1e9) &&
    finite(s.coyoteMs, 0, 100) &&
    finite(s.jumpBufferMs, 0, 120) &&
    finite(s.crouchBufferMs, 0, 160) &&
    finite(s.padCooldownMs, 0, 1000) &&
    integer(s.previousButtons, 0, 127) &&
    integer(s.events, 0, 15) &&
    integer(s.lastPad, -1, 32767) &&
    finite(s.impactVelocity, 0, 1000) &&
    finite(snapshot.yaw, -1e6, 1e6) &&
    finite(snapshot.pitch, -Math.PI / 2 - 0.0001, Math.PI / 2 + 0.0001) &&
    integer(snapshot.hp, 0, 65535) &&
    integer(snapshot.ammo, 0, 65535) &&
    integer(snapshot.reserve, 0, 65535) &&
    finite(snapshot.nextFire, 0, 1e12) &&
    finite(snapshot.reloadUntil, 0, 1e12) &&
    finite(snapshot.bloom, 0, 100) &&
    integer(snapshot.shots, 0, 0xffffffff)
  );
}
export class PacketWriter {
  readonly buffer: ArrayBuffer;
  private bytes: Uint8Array;
  private view: DataView;
  private views = new Map<number, Uint8Array>();
  private count = 0;
  private offset = HEADER;
  private kind = FpsPacketKind.Inputs;
  constructor(readonly capacity = 16384) {
    if (!integer(capacity, HEADER + INPUT_BYTES, MAX_FPS_PACKET_BYTES))
      throw new RangeError('Invalid FPS buffer size');
    this.buffer = new ArrayBuffer(capacity);
    this.bytes = new Uint8Array(this.buffer);
    this.view = new DataView(this.buffer);
    for (let kind = 1; kind <= 4; kind++) {
      const limit = kind === FpsPacketKind.Snapshot ? MAX_SNAPSHOT_PLAYERS : MAX_INPUTS_PER_PACKET;
      for (let count = 0; count <= limit; count++) {
        const length = HEADER + stride(kind) * count;
        if (length <= capacity && !this.views.has(length))
          this.views.set(length, new Uint8Array(this.buffer, 0, length));
      }
    }
    this.begin(FpsPacketKind.Inputs);
  }
  begin(kind: FpsPacketKind): this {
    stride(kind);
    this.kind = kind;
    this.count = 0;
    this.offset = HEADER;
    return this;
  }
  private room(kind: FpsPacketKind, size: number): number {
    if (this.kind !== kind) throw new FpsProtocolError('Wrong writer packet kind');
    const limit = kind === FpsPacketKind.Snapshot ? MAX_SNAPSHOT_PLAYERS : MAX_INPUTS_PER_PACKET;
    if (this.count >= limit || this.offset + size > this.capacity)
      throw new FpsProtocolError('FPS packet capacity exceeded');
    const offset = this.offset;
    this.offset += size;
    this.count++;
    return offset;
  }
  input(input: Readonly<PlayerInput>): this {
    if (
      (this.kind !== FpsPacketKind.Inputs && this.kind !== FpsPacketKind.Fire) ||
      !validInput(input)
    )
      throw new FpsProtocolError('Invalid FPS input');
    const o = this.room(this.kind, INPUT_BYTES),
      v = this.view;
    v.setUint32(o, input.sequenceNumber, true);
    v.setUint32(o + 4, input.clientTick, true);
    v.setFloat32(o + 8, input.subTickFraction, true);
    v.setUint16(o + 12, packAngle(input.yaw), true);
    v.setUint16(o + 14, packAngle(input.pitch), true);
    v.setInt8(o + 16, Math.round(input.moveX * 127));
    v.setInt8(o + 17, Math.round(input.moveZ * 127));
    v.setUint16(o + 18, input.buttons, true);
    v.setUint8(o + 20, input.weapon);
    v.setUint8(o + 21, 0);
    v.setUint16(o + 22, 0, true);
    return this;
  }
  snapshot(snapshot: Readonly<PlayerSnapshot>): this {
    const s = snapshot.state;
    if (!validSnapshot(snapshot)) throw new FpsProtocolError('Invalid FPS snapshot');
    const o = this.room(FpsPacketKind.Snapshot, SNAPSHOT_BYTES),
      v = this.view;
    v.setUint16(o, snapshot.playerId, true);
    v.setUint8(o + 2, snapshot.weapon);
    v.setUint8(o + 3, (s.grounded ? 1 : 0) | (s.crouched ? 2 : 0) | (s.sliding ? 4 : 0));
    v.setUint32(o + 4, snapshot.lastProcessedSeq, true);
    v.setUint32(o + 8, s.tick, true);
    v.setFloat64(o + 12, s.position.x, true);
    v.setFloat64(o + 20, s.position.y, true);
    v.setFloat64(o + 28, s.position.z, true);
    v.setInt16(o + 36, Math.round(s.velocity.x * 512), true);
    v.setInt16(o + 38, Math.round(s.velocity.y * 512), true);
    v.setInt16(o + 40, Math.round(s.velocity.z * 512), true);
    v.setFloat32(o + 42, s.groundNormal.x, true);
    v.setFloat32(o + 46, s.groundNormal.y, true);
    v.setFloat32(o + 50, s.groundNormal.z, true);
    v.setFloat32(o + 54, s.eyeHeight, true);
    v.setFloat32(o + 58, s.slideTimeMs, true);
    v.setFloat32(o + 62, s.coyoteMs, true);
    v.setFloat32(o + 66, s.jumpBufferMs, true);
    v.setFloat32(o + 70, s.crouchBufferMs, true);
    v.setFloat32(o + 74, s.padCooldownMs, true);
    v.setUint16(o + 78, s.previousButtons, true);
    v.setInt16(o + 80, s.lastPad, true);
    v.setUint16(o + 82, s.events, true);
    v.setFloat32(o + 84, s.impactVelocity, true);
    v.setUint16(o + 88, packAngle(snapshot.yaw), true);
    v.setUint16(o + 90, packAngle(snapshot.pitch), true);
    v.setUint16(o + 92, snapshot.hp, true);
    v.setUint16(o + 94, snapshot.ammo, true);
    v.setUint16(o + 96, snapshot.reserve, true);
    v.setFloat64(o + 98, snapshot.nextFire, true);
    v.setFloat64(o + 106, snapshot.reloadUntil, true);
    v.setFloat32(o + 114, snapshot.bloom, true);
    v.setUint32(o + 118, snapshot.shots, true);
    v.setUint16(o + 122, 0, true);
    v.setUint32(o + 124, 0, true);
    return this;
  }
  hit(hit: Readonly<HitConfirm>): this {
    if (
      !integer(hit.shotSequence, 0, 0xffffffff) ||
      !integer(hit.victimId, 1, 65535) ||
      !integer(hit.zone, 0, 3) ||
      !finite(hit.damageDealt, 0, 10000) ||
      !finite(hit.hitPosition.x, -1e7, 1e7) ||
      !finite(hit.hitPosition.y, -1e7, 1e7) ||
      !finite(hit.hitPosition.z, -1e7, 1e7) ||
      !integer(hit.serverTick, 0, 0xffffffff) ||
      !finite(hit.subTickFraction, 0, 1)
    )
      throw new FpsProtocolError('Invalid hit confirm');
    const o = this.room(FpsPacketKind.HitConfirm, HIT_BYTES),
      v = this.view;
    v.setUint32(o, hit.shotSequence, true);
    v.setUint16(o + 4, hit.victimId, true);
    v.setUint8(o + 6, (hit.isHeadshot ? 1 : 0) | (hit.isKill ? 2 : 0));
    v.setUint8(o + 7, hit.zone);
    v.setFloat32(o + 8, hit.damageDealt, true);
    v.setFloat32(o + 12, hit.hitPosition.x, true);
    v.setFloat32(o + 16, hit.hitPosition.y, true);
    v.setFloat32(o + 20, hit.hitPosition.z, true);
    v.setUint32(o + 24, hit.serverTick, true);
    v.setFloat32(o + 28, hit.subTickFraction, true);
    return this;
  }
  finish(): Uint8Array {
    const v = this.view;
    v.setUint32(0, MAGIC, true);
    v.setUint16(4, FPS_PROTOCOL_VERSION, true);
    v.setUint8(6, this.kind);
    v.setUint8(7, 0);
    v.setUint32(8, this.offset, true);
    v.setUint16(12, this.count, true);
    v.setUint16(14, 0, true);
    const bytes = this.views.get(this.offset);
    if (!bytes) throw new FpsProtocolError('Unsupported frame length');
    return bytes;
  }
  clear(): void {
    this.bytes.fill(0);
    this.begin(FpsPacketKind.Inputs);
  }
}
export class PacketReader {
  readonly buffer: ArrayBuffer;
  private bytes: Uint8Array;
  private view: DataView;
  private offset = HEADER;
  private end = HEADER;
  private index = 0;
  count = 0;
  kind = FpsPacketKind.Inputs;
  constructor(readonly capacity = 16384) {
    if (!integer(capacity, HEADER + INPUT_BYTES, MAX_FPS_PACKET_BYTES))
      throw new RangeError('Invalid FPS buffer size');
    this.buffer = new ArrayBuffer(capacity);
    this.bytes = new Uint8Array(this.buffer);
    this.view = new DataView(this.buffer);
  }
  reset(source: Uint8Array): this {
    if (source.byteLength < HEADER || source.byteLength > this.capacity)
      throw new FpsProtocolError('Invalid FPS packet size');
    this.bytes.set(source);
    const v = this.view;
    this.kind = v.getUint8(6);
    this.count = v.getUint16(12, true);
    this.end = v.getUint32(8, true);
    const limit =
      this.kind === FpsPacketKind.Snapshot ? MAX_SNAPSHOT_PLAYERS : MAX_INPUTS_PER_PACKET;
    if (
      v.getUint32(0, true) !== MAGIC ||
      v.getUint16(4, true) !== FPS_PROTOCOL_VERSION ||
      v.getUint8(7) !== 0 ||
      v.getUint16(14, true) !== 0 ||
      this.end !== source.length ||
      this.count > limit ||
      this.end !== HEADER + stride(this.kind) * this.count
    )
      throw new FpsProtocolError('Invalid FPS header/version/length');
    this.index = 0;
    this.offset = HEADER;
    return this;
  }
  private next(kind: FpsPacketKind, size: number): number {
    if (this.kind !== kind || this.index >= this.count || this.offset + size > this.end)
      throw new FpsProtocolError('FPS packet exhausted or wrong kind');
    const offset = this.offset;
    this.offset += size;
    this.index++;
    return offset;
  }
  input(out: PlayerInput): PlayerInput {
    if (this.kind !== FpsPacketKind.Inputs && this.kind !== FpsPacketKind.Fire)
      throw new FpsProtocolError('Expected input frame');
    const o = this.next(this.kind, INPUT_BYTES),
      v = this.view;
    out.sequenceNumber = v.getUint32(o, true);
    out.clientTick = v.getUint32(o + 4, true);
    out.subTickFraction = v.getFloat32(o + 8, true);
    out.yaw = unpackAngle(v.getUint16(o + 12, true));
    out.pitch = unpackPitch(v.getUint16(o + 14, true));
    out.moveX = v.getInt8(o + 16) / 127;
    out.moveZ = v.getInt8(o + 17) / 127;
    out.buttons = v.getUint16(o + 18, true);
    out.weapon = v.getUint8(o + 20);
    if (!validInput(out) || v.getUint8(o + 21) !== 0 || v.getUint16(o + 22, true) !== 0)
      throw new FpsProtocolError('Invalid decoded input');
    return out;
  }
  snapshot(out: PlayerSnapshot): PlayerSnapshot {
    const o = this.next(FpsPacketKind.Snapshot, SNAPSHOT_BYTES),
      v = this.view,
      s = out.state,
      flags = v.getUint8(o + 3);
    out.playerId = v.getUint16(o, true);
    out.weapon = v.getUint8(o + 2);
    out.lastProcessedSeq = v.getUint32(o + 4, true);
    s.tick = v.getUint32(o + 8, true);
    s.grounded = !!(flags & 1);
    s.crouched = !!(flags & 2);
    s.sliding = !!(flags & 4);
    s.position.set(
      v.getFloat64(o + 12, true),
      v.getFloat64(o + 20, true),
      v.getFloat64(o + 28, true),
    );
    s.velocity.set(
      v.getInt16(o + 36, true) / 512,
      v.getInt16(o + 38, true) / 512,
      v.getInt16(o + 40, true) / 512,
    );
    s.groundNormal.set(
      v.getFloat32(o + 42, true),
      v.getFloat32(o + 46, true),
      v.getFloat32(o + 50, true),
    );
    s.eyeHeight = v.getFloat32(o + 54, true);
    s.slideTimeMs = v.getFloat32(o + 58, true);
    s.coyoteMs = v.getFloat32(o + 62, true);
    s.jumpBufferMs = v.getFloat32(o + 66, true);
    s.crouchBufferMs = v.getFloat32(o + 70, true);
    s.padCooldownMs = v.getFloat32(o + 74, true);
    s.previousButtons = v.getUint16(o + 78, true);
    s.lastPad = v.getInt16(o + 80, true);
    s.events = v.getUint16(o + 82, true);
    s.impactVelocity = v.getFloat32(o + 84, true);
    out.yaw = unpackAngle(v.getUint16(o + 88, true));
    out.pitch = unpackPitch(v.getUint16(o + 90, true));
    out.hp = v.getUint16(o + 92, true);
    out.ammo = v.getUint16(o + 94, true);
    out.reserve = v.getUint16(o + 96, true);
    out.nextFire = v.getFloat64(o + 98, true);
    out.reloadUntil = v.getFloat64(o + 106, true);
    out.bloom = v.getFloat32(o + 114, true);
    out.shots = v.getUint32(o + 118, true);
    if (
      !validSnapshot(out) ||
      flags > 7 ||
      v.getUint16(o + 122, true) !== 0 ||
      v.getUint32(o + 124, true) !== 0
    )
      throw new FpsProtocolError('Invalid decoded snapshot');
    return out;
  }
  hit(out: HitConfirm): HitConfirm {
    const o = this.next(FpsPacketKind.HitConfirm, HIT_BYTES),
      v = this.view,
      flags = v.getUint8(o + 6);
    out.shotSequence = v.getUint32(o, true);
    out.victimId = v.getUint16(o + 4, true);
    out.isHeadshot = !!(flags & 1);
    out.isKill = !!(flags & 2);
    out.zone = v.getUint8(o + 7);
    out.damageDealt = v.getFloat32(o + 8, true);
    out.hitPosition.set(
      v.getFloat32(o + 12, true),
      v.getFloat32(o + 16, true),
      v.getFloat32(o + 20, true),
    );
    out.serverTick = v.getUint32(o + 24, true);
    out.subTickFraction = v.getFloat32(o + 28, true);
    if (
      !out.victimId ||
      out.zone > 3 ||
      flags > 3 ||
      !finite(out.damageDealt, 0, 10000) ||
      !finite(out.hitPosition.x, -1e7, 1e7) ||
      !finite(out.hitPosition.y, -1e7, 1e7) ||
      !finite(out.hitPosition.z, -1e7, 1e7) ||
      !finite(out.subTickFraction, 0, 1)
    )
      throw new FpsProtocolError('Invalid decoded hit');
    return out;
  }
}
/** Keeps every unacknowledged input; overflow is explicit so callers request authoritative resync. */
export class InputRingBuffer {
  readonly capacity = 128;
  private records = Array.from({ length: 128 }, () => new PlayerInput());
  private head = 0;
  private size = 0;
  private lastSequence = -1;
  get length(): number {
    return this.size;
  }
  push(input: Readonly<PlayerInput>): void {
    if (!validInput(input)) throw new FpsProtocolError('Invalid ring input');
    if (this.size === this.capacity) throw new RangeError('Input ring overflow: resync required');
    if (input.sequenceNumber <= this.lastSequence)
      throw new RangeError('Input sequence must increase');
    this.records[(this.head + this.size) & 127]!.copy(input);
    this.lastSequence = input.sequenceNumber;
    this.size++;
  }
  acknowledge(sequence: number): void {
    while (this.size && this.records[this.head]!.sequenceNumber <= sequence) {
      this.head = (this.head + 1) & 127;
      this.size--;
    }
  }
  at(index: number): Readonly<PlayerInput> {
    if (index < 0 || index >= this.size || !Number.isInteger(index))
      throw new RangeError('Input ring index');
    return this.records[(this.head + index) & 127]!;
  }
  clear(): void {
    this.head = 0;
    this.size = 0;
    this.lastSequence = -1;
  }
}

/** Node transports can retain bytes until send completes; lease one writer per in-flight frame. */
export class PacketBufferPool {
  private writers: PacketWriter[];
  private active: Uint8Array;
  private indices = new Map<PacketWriter, number>();
  private cursor = 0;
  constructor(
    readonly size = 32,
    capacity = 16384,
  ) {
    if (!integer(size, 1, 256)) throw new RangeError('Invalid packet pool');
    this.active = new Uint8Array(size);
    this.writers = Array.from({ length: size }, (_, i) => {
      const writer = new PacketWriter(capacity);
      this.indices.set(writer, i);
      return writer;
    });
  }
  acquire(): PacketWriter {
    for (let n = 0; n < this.size; n++) {
      const index = (this.cursor + n) % this.size;
      if (!this.active[index]) {
        this.active[index] = 1;
        this.cursor = (index + 1) % this.size;
        return this.writers[index]!;
      }
    }
    throw new RangeError('Packet pool exhausted: transport backpressure');
  }
  release(writer: PacketWriter): void {
    const index = this.indices.get(writer);
    if (index === undefined || !this.active[index])
      throw new RangeError('Unknown or released packet writer');
    this.active[index] = 0;
  }
}
