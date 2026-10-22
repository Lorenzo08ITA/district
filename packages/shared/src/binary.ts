import {
  MAX_COMMANDS_PER_PACKET,
  MAX_DELTA_TILES,
  MAX_PACKET_BYTES,
  MAX_PLAYERS,
  PROTOCOL_MAGIC,
  PROTOCOL_VERSION,
  UINT32_MAX,
} from './constants.js';
import { commandSchema, type GameCommand } from './commands.js';
import { CommandKind, PacketKind, TerrainType, type TileDelta } from './types.js';

const HEADER_BYTES = 16;
const COMMAND_HEADER_BYTES = 16;
const TILE_BYTES = 20;
export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}
export type BinaryInput = ArrayBuffer | Uint8Array;
function viewOf(input: BinaryInput): DataView {
  return input instanceof Uint8Array
    ? new DataView(input.buffer, input.byteOffset, input.byteLength)
    : new DataView(input);
}
function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new ProtocolError(message);
}
function header(kind: PacketKind, count: number, payloadBytes: number): DataView {
  check(count <= 0xffff && count >= 0, 'Invalid record count');
  check(payloadBytes + HEADER_BYTES <= MAX_PACKET_BYTES, 'Packet too large');
  const view = new DataView(new ArrayBuffer(HEADER_BYTES + payloadBytes));
  view.setUint32(0, PROTOCOL_MAGIC, true);
  view.setUint16(4, PROTOCOL_VERSION, true);
  view.setUint8(6, kind);
  view.setUint32(8, payloadBytes, true);
  view.setUint16(12, count, true);
  return view;
}
function readHeader(input: BinaryInput, kind: PacketKind): { view: DataView; count: number } {
  const view = viewOf(input);
  check(
    view.byteLength >= HEADER_BYTES && view.byteLength <= MAX_PACKET_BYTES,
    'Invalid packet length',
  );
  check(view.getUint32(0, true) === PROTOCOL_MAGIC, 'Invalid magic');
  check(view.getUint16(4, true) === PROTOCOL_VERSION, 'Unsupported protocol version');
  check(view.getUint8(6) === kind, 'Unexpected packet kind');
  check(view.getUint8(7) === 0 && view.getUint16(14, true) === 0, 'Nonzero reserved header');
  check(view.getUint32(8, true) === view.byteLength - HEADER_BYTES, 'Payload length mismatch');
  return { view, count: view.getUint16(12, true) };
}
function payloadSize(kind: CommandKind): number {
  switch (kind) {
    case CommandKind.Attack:
    case CommandKind.Build:
    case CommandKind.Transport:
    case CommandKind.Patrol:
    case CommandKind.ProduceWarship:
      return 8;
    case CommandKind.LaunchNuke:
      return 12;
    case CommandKind.CancelAttack:
    case CommandKind.Upgrade:
    case CommandKind.RequestAlliance:
    case CommandKind.AcceptAlliance:
    case CommandKind.BreakAlliance:
      return 4;
    default:
      throw new ProtocolError('Unknown command kind');
  }
}
export function encodeCommands(input: readonly GameCommand[]): ArrayBuffer {
  check(input.length <= MAX_COMMANDS_PER_PACKET, 'Too many commands');
  const commands = input.map((command) => {
    const parsed = commandSchema.safeParse(command);
    check(parsed.success, 'Invalid command');
    return parsed.data;
  });
  const size = commands.reduce(
    (sum, command) => sum + COMMAND_HEADER_BYTES + payloadSize(command.kind),
    0,
  );
  const view = header(PacketKind.Commands, commands.length, size);
  let offset = HEADER_BYTES;
  for (const command of commands) {
    const recordBytes = COMMAND_HEADER_BYTES + payloadSize(command.kind);
    view.setUint16(offset, recordBytes, true);
    view.setUint8(offset + 2, command.kind);
    view.setUint16(offset + 4, command.playerId, true);
    view.setUint32(offset + 8, command.sequence, true);
    view.setUint32(offset + 12, command.executeTick, true);
    const p = offset + COMMAND_HEADER_BYTES;
    switch (command.kind) {
      case CommandKind.Attack:
      case CommandKind.Transport:
        view.setUint32(p, command.targetTile, true);
        view.setUint16(p + 4, command.allocationBps, true);
        break;
      case CommandKind.CancelAttack:
        view.setUint32(p, command.attackId, true);
        break;
      case CommandKind.Build:
        view.setUint32(p, command.tile, true);
        view.setUint8(p + 4, command.building);
        break;
      case CommandKind.Upgrade:
        view.setUint32(p, command.buildingId, true);
        break;
      case CommandKind.ProduceWarship:
        view.setUint32(p, command.portId, true);
        view.setUint32(p + 4, command.patrolTile, true);
        break;
      case CommandKind.Patrol:
        view.setUint32(p, command.shipId, true);
        view.setUint32(p + 4, command.targetTile, true);
        break;
      case CommandKind.LaunchNuke:
        view.setUint32(p, command.siloId, true);
        view.setUint32(p + 4, command.targetTile, true);
        view.setUint8(p + 8, command.weapon);
        break;
      case CommandKind.RequestAlliance:
      case CommandKind.AcceptAlliance:
      case CommandKind.BreakAlliance:
        view.setUint16(p, command.otherPlayerId, true);
        break;
    }
    offset += recordBytes;
  }
  return view.buffer as ArrayBuffer;
}
export function decodeCommands(input: BinaryInput): GameCommand[] {
  const { view, count } = readHeader(input, PacketKind.Commands);
  check(count <= MAX_COMMANDS_PER_PACKET, 'Too many commands');
  const commands: GameCommand[] = [];
  let offset = HEADER_BYTES;
  for (let i = 0; i < count; i++) {
    check(offset + COMMAND_HEADER_BYTES <= view.byteLength, 'Truncated command header');
    const kind = view.getUint8(offset + 2) as CommandKind;
    const recordBytes = COMMAND_HEADER_BYTES + payloadSize(kind);
    check(
      view.getUint16(offset, true) === recordBytes && offset + recordBytes <= view.byteLength,
      'Invalid command length',
    );
    check(
      view.getUint8(offset + 3) === 0 && view.getUint16(offset + 6, true) === 0,
      'Nonzero reserved command header',
    );
    const base = {
      kind,
      playerId: view.getUint16(offset + 4, true),
      sequence: view.getUint32(offset + 8, true),
      executeTick: view.getUint32(offset + 12, true),
    };
    const p = offset + COMMAND_HEADER_BYTES;
    let payload: Record<string, number>;
    switch (kind) {
      case CommandKind.Attack:
      case CommandKind.Transport:
        check(view.getUint16(p + 6, true) === 0, 'Nonzero reserved allocation');
        payload = {
          targetTile: view.getUint32(p, true),
          allocationBps: view.getUint16(p + 4, true),
        };
        break;
      case CommandKind.CancelAttack:
        payload = { attackId: view.getUint32(p, true) };
        break;
      case CommandKind.Build:
        check(
          view.getUint8(p + 5) === 0 && view.getUint16(p + 6, true) === 0,
          'Nonzero reserved building',
        );
        payload = { tile: view.getUint32(p, true), building: view.getUint8(p + 4) };
        break;
      case CommandKind.Upgrade:
        payload = { buildingId: view.getUint32(p, true) };
        break;
      case CommandKind.ProduceWarship:
        payload = { portId: view.getUint32(p, true), patrolTile: view.getUint32(p + 4, true) };
        break;
      case CommandKind.Patrol:
        payload = { shipId: view.getUint32(p, true), targetTile: view.getUint32(p + 4, true) };
        break;
      case CommandKind.LaunchNuke:
        check(
          view.getUint8(p + 9) === 0 && view.getUint16(p + 10, true) === 0,
          'Nonzero reserved weapon',
        );
        payload = {
          siloId: view.getUint32(p, true),
          targetTile: view.getUint32(p + 4, true),
          weapon: view.getUint8(p + 8),
        };
        break;
      case CommandKind.RequestAlliance:
      case CommandKind.AcceptAlliance:
      case CommandKind.BreakAlliance:
        check(view.getUint16(p + 2, true) === 0, 'Nonzero reserved alliance');
        payload = { otherPlayerId: view.getUint16(p, true) };
        break;
      default:
        throw new ProtocolError('Unknown command kind');
    }
    const parsed = commandSchema.safeParse({ ...base, ...payload });
    check(parsed.success, 'Invalid command payload');
    commands.push(parsed.data);
    offset += recordBytes;
  }
  check(offset === view.byteLength, 'Trailing command bytes');
  return commands;
}
function checkUint32(value: number, field: string): void {
  check(Number.isInteger(value) && value >= 0 && value <= UINT32_MAX, `Invalid ${field}`);
}
export function encodeTileDelta(delta: TileDelta): ArrayBuffer {
  const count = delta.indices.length;
  check(count <= MAX_DELTA_TILES, 'Too many delta tiles; split the frame');
  checkUint32(delta.tick, 'tick');
  checkUint32(delta.stateHash, 'state hash');
  for (const field of [
    delta.terrain,
    delta.elevation,
    delta.owners,
    delta.borders,
    delta.buildings,
    delta.coverage,
  ])
    check(field.length === count, 'Delta array length mismatch');
  if (delta.contaminationUntil)
    check(delta.contaminationUntil.length === count, 'Contamination length mismatch');
  const view = header(PacketKind.TileDelta, count, 8 + count * TILE_BYTES);
  view.setUint32(16, delta.tick, true);
  view.setUint32(20, delta.stateHash, true);
  let previous = -1;
  for (let i = 0; i < count; i++) {
    const index = delta.indices[i]!,
      p = 24 + i * TILE_BYTES;
    check(index > previous, 'Delta indices must be unique and ascending');
    previous = index;
    check(
      delta.terrain[i]! <= TerrainType.Mountains &&
        delta.owners[i]! <= MAX_PLAYERS &&
        delta.borders[i]! <= 15,
      'Invalid tile value',
    );
    view.setUint32(p, index, true);
    view.setUint16(p + 4, delta.owners[i]!, true);
    view.setUint8(p + 6, delta.borders[i]!);
    view.setUint8(p + 7, delta.coverage[i]!);
    view.setUint32(p + 8, delta.buildings[i]!, true);
    view.setUint8(p + 12, delta.terrain[i]!);
    view.setUint8(p + 13, delta.elevation[i]!);
    view.setUint32(p + 16, delta.contaminationUntil?.[i] ?? 0, true);
  }
  return view.buffer as ArrayBuffer;
}
export function decodeTileDelta(input: BinaryInput): TileDelta {
  const { view, count } = readHeader(input, PacketKind.TileDelta);
  check(
    count <= MAX_DELTA_TILES && view.byteLength === 24 + count * TILE_BYTES,
    'Invalid delta length',
  );
  const delta: TileDelta = {
    tick: view.getUint32(16, true),
    stateHash: view.getUint32(20, true),
    indices: new Uint32Array(count),
    contaminationUntil: new Uint32Array(count),
    terrain: new Uint8Array(count),
    elevation: new Uint8Array(count),
    owners: new Uint16Array(count),
    borders: new Uint8Array(count),
    buildings: new Uint32Array(count),
    coverage: new Uint8Array(count),
  };
  let previous = -1;
  for (let i = 0; i < count; i++) {
    const p = 24 + i * TILE_BYTES,
      index = view.getUint32(p, true);
    check(index > previous, 'Delta indices must be unique and ascending');
    previous = index;
    check(view.getUint16(p + 14, true) === 0, 'Nonzero reserved tile');
    const owner = view.getUint16(p + 4, true),
      border = view.getUint8(p + 6),
      terrain = view.getUint8(p + 12);
    check(
      owner <= MAX_PLAYERS && border <= 15 && terrain <= TerrainType.Mountains,
      'Invalid tile value',
    );
    delta.contaminationUntil![i] = view.getUint32(p + 16, true);
    delta.indices[i] = index;
    delta.owners[i] = owner;
    delta.borders[i] = border;
    delta.coverage[i] = view.getUint8(p + 7);
    delta.buildings[i] = view.getUint32(p + 8, true);
    delta.terrain[i] = terrain;
    delta.elevation[i] = view.getUint8(p + 13);
  }
  return delta;
}
