import { describe, it, expect } from 'vitest';
import {
  MAX_FPS_VELOCITY,
  PacketWriter,
  PacketReader,
  FpsPacketKind,
  PlayerInput,
  PlayerSnapshot,
  HitConfirm,
  InputRingBuffer,
  PacketBufferPool,
  InputButtons,
  quantizeInput,
} from '@district/rts-shared/fps';
describe('FPS binary protocol', () => {
  it('round-trips quantized inputs and the sub-tick boundary using the same output registers', () => {
    const writer = new PacketWriter(),
      reader = new PacketReader(),
      input = new PlayerInput(),
      out = new PlayerInput(),
      expected = new PlayerInput();
    input.sequenceNumber = 4294967295;
    input.clientTick = 60;
    input.yaw = -2.3;
    input.pitch = -Math.PI / 2;
    input.subTickFraction = 0.783246;
    input.moveX = 0.371;
    input.moveZ = -1;
    input.buttons = InputButtons.Jump | InputButtons.Fire;
    input.weapon = 4;
    writer.begin(FpsPacketKind.Inputs).input(input);
    const view = writer.finish();
    expect(view.byteLength).toBe(40);
    reader.reset(view).input(out);
    expect(out).toEqual(quantizeInput(expected, input));
    input.pitch = Math.PI / 2;
    input.subTickFraction = 1;
    expect(writer.begin(FpsPacketKind.Inputs).input(input).finish()).toBe(view);
    reader.reset(view).input(out);
    expect(out.pitch).toBe(Math.PI / 2);
    expect(out.subTickFraction).toBe(1);
    expect(() => reader.input(out)).toThrow('exhausted');
  });
  it('round-trips full authoritative movement state and equipment with fixed-point velocities', () => {
    const writer = new PacketWriter(),
      reader = new PacketReader(),
      source = new PlayerSnapshot(),
      out = new PlayerSnapshot();
    source.playerId = 8;
    source.lastProcessedSeq = 723;
    source.state.tick = 900;
    source.state.position.set(125.215, -0.002, -18.5);
    source.state.velocity.set(12.23, 9.4, -5.2);
    source.state.crouched = true;
    source.state.sliding = true;
    source.state.slideTimeMs = 125;
    source.state.coyoteMs = 18;
    source.state.crouchBufferMs = 100;
    source.state.eyeHeight = 0.95;
    source.state.padCooldownMs = 220;
    source.state.lastPad = 2;
    source.ammo = 17;
    source.reloadUntil = 23;
    source.yaw = 2.1;
    source.pitch = -0.31;
    source.shots = 19;
    reader.reset(writer.begin(FpsPacketKind.Snapshot).snapshot(source).finish()).snapshot(out);
    expect(out.playerId).toBe(8);
    expect(out.state.position).toEqual(source.state.position);
    expect(Math.abs(out.state.velocity.x - source.state.velocity.x)).toBeLessThan(1 / 512);
    expect(out.state.crouched).toBe(true);
    expect(out.state.sliding).toBe(true);
    expect(out.state.slideTimeMs).toBe(125);
    expect(out.lastProcessedSeq).toBe(723);
    expect(out.state.padCooldownMs).toBe(220);
    expect(out.ammo).toBe(17);
    expect(out.reloadUntil).toBe(23);
    expect(out.shots).toBe(19);
  });
  it('encodes hit confirms and batched fire inputs', () => {
    const writer = new PacketWriter(),
      reader = new PacketReader(),
      hit = new HitConfirm(),
      out = new HitConfirm();
    hit.victimId = 7;
    hit.isHeadshot = true;
    hit.isKill = true;
    hit.damageDealt = 145;
    hit.hitPosition.set(1, 2, 3);
    hit.subTickFraction = 0.5;
    reader.reset(writer.begin(FpsPacketKind.HitConfirm).hit(hit).finish()).hit(out);
    expect(out).toEqual(hit);
    const input = new PlayerInput();
    input.buttons = InputButtons.Fire;
    writer.begin(FpsPacketKind.Fire).input(input);
    input.sequenceNumber++;
    writer.input(input);
    reader.reset(writer.finish());
    expect(reader.count).toBe(2);
    reader.input(new PlayerInput());
    expect(reader.input(new PlayerInput()).sequenceNumber).toBe(1);
  });
  it('rejects truncation, overflow, mismatched versions, reserved bits and non-finite input', () => {
    const writer = new PacketWriter(128),
      reader = new PacketReader(),
      input = new PlayerInput();
    const bytes = writer.begin(FpsPacketKind.Inputs).input(input).finish();
    expect(() => reader.reset(bytes.subarray(0, bytes.length - 1))).toThrow();
    const bad = bytes.slice();
    bad[4] = 99;
    expect(() => reader.reset(bad)).toThrow();
    bad.set(bytes);
    bad[7] = 1;
    expect(() => reader.reset(bad)).toThrow();
    bad.set(bytes);
    new DataView(bad.buffer).setFloat32(24, NaN, true);
    expect(() => reader.reset(bad).input(new PlayerInput())).toThrow('decoded');
    input.subTickFraction = 1.1;
    expect(() => writer.begin(FpsPacketKind.Inputs).input(input)).toThrow();
    input.subTickFraction = 0;
    expect(() => {
      writer.begin(FpsPacketKind.Inputs);
      for (let n = 0; n < 10; n++) writer.input(input);
    }).toThrow('capacity');
    expect(() => new PacketWriter(1)).toThrow();
  });
  it('validates snapshot state on both sides of the trust boundary', () => {
    const writer = new PacketWriter(),
      reader = new PacketReader(),
      snapshot = new PlayerSnapshot();
    snapshot.state.eyeHeight = NaN;
    expect(() => writer.begin(FpsPacketKind.Snapshot).snapshot(snapshot)).toThrow();
    snapshot.state.eyeHeight = 1.62;
    const bytes = writer.begin(FpsPacketKind.Snapshot).snapshot(snapshot).finish().slice();
    new DataView(bytes.buffer).setFloat32(16 + 62, Infinity, true);
    expect(() => reader.reset(bytes).snapshot(new PlayerSnapshot())).toThrow('snapshot');
  });
  it('never overwrites pending inputs and handles monotonic acknowledgements', () => {
    const ring = new InputRingBuffer(),
      input = new PlayerInput();
    for (let n = 0; n < 128; n++) {
      input.sequenceNumber = n;
      ring.push(input);
    }
    expect(ring.length).toBe(128);
    input.sequenceNumber = 128;
    expect(() => ring.push(input)).toThrow('overflow');
    ring.acknowledge(63);
    ring.push(input);
    expect(ring.length).toBe(65);
    expect(ring.at(0).sequenceNumber).toBe(64);
    expect(ring.at(64).sequenceNumber).toBe(128);
    expect(() => ring.push(input)).toThrow('increase');
    ring.acknowledge(128);
    expect(ring.length).toBe(0);
    ring.clear();
    input.sequenceNumber = 0;
    ring.push(input);
    expect(ring.at(0)).not.toBe(input);
  });
  it('leases independent transport buffers until each send has completed', () => {
    const pool = new PacketBufferPool(2, 128),
      a = pool.acquire(),
      b = pool.acquire(),
      input = new PlayerInput();
    const first = a.begin(FpsPacketKind.Inputs).input(input).finish();
    input.sequenceNumber = 2;
    b.begin(FpsPacketKind.Inputs).input(input).finish();
    expect(new DataView(first.buffer).getUint32(16, true)).toBe(0);
    expect(() => pool.acquire()).toThrow('backpressure');
    pool.release(a);
    expect(pool.acquire()).toBe(a);
    pool.release(a);
    expect(() => pool.release(a)).toThrow('released');
  });
});

it('preserves the valid extreme fixed-point velocity at both encode/decode boundaries', () => {
  const writer = new PacketWriter(),
    reader = new PacketReader(),
    source = new PlayerSnapshot(),
    out = new PlayerSnapshot();
  source.state.velocity.set(MAX_FPS_VELOCITY, -MAX_FPS_VELOCITY, 0);
  reader.reset(writer.begin(FpsPacketKind.Snapshot).snapshot(source).finish()).snapshot(out);
  expect(out.state.velocity).toEqual(source.state.velocity);
  source.state.velocity.x = MAX_FPS_VELOCITY + 0.001;
  expect(() => writer.begin(FpsPacketKind.Snapshot).snapshot(source)).toThrow('snapshot');
});
