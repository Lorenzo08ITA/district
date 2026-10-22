import { describe, it, expect } from 'vitest';
import {
  CommandKind,
  BuildingKind,
  WeaponKind,
  encodeCommands,
  decodeCommands,
  encodeTileDelta,
  decodeTileDelta,
  ProtocolError,
  type GameCommand,
  type TileDelta,
} from '@district/rts-shared';
const base = { playerId: 1, sequence: 1, executeTick: 5 };
const commands: GameCommand[] = [
  { ...base, kind: CommandKind.ProduceWarship, portId: 3, patrolTile: 250 },
  { ...base, kind: CommandKind.Attack, targetTile: 4000000, allocationBps: 7500 },
  { ...base, kind: CommandKind.CancelAttack, attackId: 5 },
  { ...base, kind: CommandKind.Build, tile: 900, building: BuildingKind.City },
  { ...base, kind: CommandKind.Upgrade, buildingId: 1 },
  { ...base, kind: CommandKind.Transport, targetTile: 1000, allocationBps: 2000 },
  { ...base, kind: CommandKind.Patrol, shipId: 1, targetTile: 3000 },
  { ...base, kind: CommandKind.LaunchNuke, siloId: 2, targetTile: 1400, weapon: WeaponKind.Mirv },
  { ...base, kind: CommandKind.RequestAlliance, otherPlayerId: 2 },
  { ...base, kind: CommandKind.AcceptAlliance, otherPlayerId: 2 },
  { ...base, kind: CommandKind.BreakAlliance, otherPlayerId: 2 },
];
const delta = (): TileDelta => ({
  tick: 50,
  stateHash: 123,
  indices: new Uint32Array([0, 300, 3999999]),
  terrain: new Uint8Array([3, 4, 5]),
  elevation: new Uint8Array([0, 128, 255]),
  owners: new Uint16Array([0, 1, 64]),
  borders: new Uint8Array([0, 15, 7]),
  buildings: new Uint32Array([0, 1, 4294967295]),
  coverage: new Uint8Array([0, 1, 255]),
  contaminationUntil: new Uint32Array([0, 500, 600]),
});
describe('protocollo binario little-endian', () => {
  it('roundtrip di tutti i comandi e vettore golden', () => {
    expect(decodeCommands(encodeCommands(commands))).toEqual(commands);
    const packet = encodeCommands([{ ...base, kind: CommandKind.CancelAttack, attackId: 7 }]);
    expect(Buffer.from(packet).toString('hex')).toBe(
      '525453320200010014000000010000001400020001000000010000000500000007000000',
    );
  });
  it('rispetta offset e lunghezza di Buffer e Uint8Array', () => {
    const packet = new Uint8Array(encodeCommands(commands)),
      wrapped = Buffer.alloc(packet.length + 20, 255);
    wrapped.set(packet, 7);
    expect(decodeCommands(wrapped.subarray(7, 7 + packet.length))).toEqual(commands);
  });
  it('rifiuta troncamenti a qualsiasi offset', () => {
    const packet = new Uint8Array(encodeCommands(commands));
    for (let i = 0; i < packet.length; i++)
      expect(() => decodeCommands(packet.subarray(0, i))).toThrow(ProtocolError);
  });
  it('rifiuta NaN, extra, tipo sconosciuto, versione e byte riservati', () => {
    expect(() =>
      encodeCommands([{ ...commands[0]!, allocationBps: NaN } as GameCommand]),
    ).toThrow();
    expect(() =>
      encodeCommands([{ ...commands[0]!, extra: true } as unknown as GameCommand]),
    ).toThrow();
    for (const [offset, value] of [
      [4, 99],
      [7, 1],
      [18, 255],
      [19, 1],
      [22, 1],
      [38, 1],
    ]) {
      const packet = new Uint8Array(
        encodeCommands([commands.find((c) => c.kind === CommandKind.Attack)!]),
      );
      packet[offset!] = value!;
      expect(() => decodeCommands(packet)).toThrow(ProtocolError);
    }
  });
  it('roundtrip delta senza condivisione dei buffer', () => {
    const input = delta();
    const encoded = encodeTileDelta(input),
      decoded = decodeTileDelta(encoded);
    expect(decoded).toEqual(input);
    input.owners[0] = 5;
    expect(decoded.owners[0]).toBe(0);
  });
  it('rifiuta delta duplicati, array discordanti e troncati', () => {
    const d = delta();
    d.indices[1] = 0;
    expect(() => encodeTileDelta(d)).toThrow();
    expect(() => encodeTileDelta({ ...delta(), owners: new Uint16Array(1) })).toThrow();
    const packet = new Uint8Array(encodeTileDelta(delta()));
    expect(() => decodeTileDelta(packet.subarray(0, -1))).toThrow();
  });
  it('pacchetti vuoti validi e proprietà casuali su 200 comandi', () => {
    expect(decodeCommands(encodeCommands([]))).toEqual([]);
    expect(
      decodeTileDelta(
        encodeTileDelta({
          ...delta(),
          contaminationUntil: new Uint32Array(),
          indices: new Uint32Array(),
          terrain: new Uint8Array(),
          elevation: new Uint8Array(),
          owners: new Uint16Array(),
          borders: new Uint8Array(),
          buildings: new Uint32Array(),
          coverage: new Uint8Array(),
        }),
      ).indices.length,
    ).toBe(0);
    const values = Array.from({ length: 200 }, (_, i) => ({
      ...base,
      kind: CommandKind.Attack as const,
      sequence: i,
      targetTile: i * 17777,
      allocationBps: 1000 + i * 40,
    }));
    expect(decodeCommands(encodeCommands(values))).toEqual(values);
  });
});
