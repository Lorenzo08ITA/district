import { describe, it, expect } from 'vitest';
import { encodeWire, decodeWire, WireKind, CommandKind } from '@district/rts-shared';
import { GameEngine, createScenario } from '@district/rts-engine';
import { Camera } from '../../packages/client/src/Camera';
describe('application wire and camera', () => {
  it('round-trips complete snapshots, sets and binary views without changing replay', () => {
    const engine = createScenario(189, ['A', 'B', 'C'], [2, 3], 'strait');
    for (let n = 0; n < 30; n++) engine.tick();
    const bytes = encodeWire(WireKind.Snapshot, engine.snapshot());
    const padded = new Uint8Array(bytes.byteLength + 7);
    padded.set(new Uint8Array(bytes), 7);
    const decoded = decodeWire(padded.subarray(7));
    const restored = GameEngine.fromSnapshot(decoded.value as ReturnType<GameEngine['snapshot']>);
    expect(restored.stateHash()).toBe(engine.stateHash());
    for (let n = 0; n < 30; n++) {
      engine.tick();
      restored.tick();
    }
    expect(restored.stateHash()).toBe(engine.stateHash());
  });
  it('rejects malformed sizes, versions, extra bytes and unsafe metadata', () => {
    const bytes = encodeWire(WireKind.Control, { type: 'hello' });
    expect(() => decodeWire(bytes.slice(0, 14))).toThrow();
    const bad = bytes.slice(0);
    new DataView(bad).setUint16(4, 99, true);
    expect(() => decodeWire(bad)).toThrow();
    expect(() => decodeWire(new Uint8Array([...new Uint8Array(bytes), 0]))).toThrow();
    expect(() =>
      decodeWire(encodeWire(WireKind.Control, JSON.parse('{"__proto__":{}}'))),
    ).toThrow();
  });
  it('rejects reused binary references before amplification', () => {
    const source = encodeWire(WireKind.Snapshot, [
      new Uint32Array([1, 2]),
      { $buffer: 0, type: 2, length: 2 },
    ]);
    expect(() => decodeWire(source)).toThrow('Repeated');
  });
  it('keeps the world point under the cursor fixed when zooming', () => {
    const camera = new Camera();
    camera.fit(192, 128, 1000, 700);
    const before = camera.screenToWorld(137, 231);
    camera.zoomAt(137, 231, 2.3);
    expect(camera.screenToWorld(137, 231)[0]).toBeCloseTo(before[0], 10);
    expect(camera.screenToWorld(137, 231)[1]).toBeCloseTo(before[1], 10);
    camera.pan(50, -20);
    expect(camera.screenToWorld(137, 231)[0]).toBeCloseTo(before[0] - 50 / camera.zoom);
  });
  it('creates repeatable, disjoint spawn areas on each layout', () => {
    for (const layout of ['continents', 'archipelago', 'strait'] as const) {
      const engine = createScenario(7, ['One', 'Two', 'Three', 'Four'], [2, 3, 4], layout);
      expect(engine.getPlayers().every((p) => p.landSize > 0)).toBe(true);
      expect(engine.stateHash()).toBe(
        createScenario(7, ['One', 'Two', 'Three', 'Four'], [2, 3, 4], layout).stateHash(),
      );
      const tile = engine.map.borderTiles(1)[0]!;
      const neighbour = [tile - 1, tile + 1, tile - engine.map.width, tile + engine.map.width].find(
        (t) =>
          t >= 0 && t < engine.map.length && engine.map.ownerId[t] === 0 && engine.map.isLand(t),
      );
      if (neighbour !== undefined) {
        engine.enqueue({
          kind: CommandKind.Attack,
          playerId: 1,
          sequence: 0,
          executeTick: 1,
          targetTile: neighbour,
          allocationBps: 3000,
        });
        for (let n = 0; n < 5; n++) engine.tick();
        expect(engine.getPlayer(1)!.landSize).toBeGreaterThan(1);
      }
    }
  });
});

import { TerritoryLabels } from '../../packages/client/src/territoryLabels';
it('keeps labels inside the largest owned island rather than in the sea', () => {
  const owners = new Uint16Array(100);
  owners[11] = owners[12] = owners[21] = owners[22] = owners[88] = 1;
  const labels = new TerritoryLabels(10, 10);
  labels.refresh(owners);
  const point = labels.get(1, [9, 9]);
  expect([11, 12, 21, 22]).toContain(point[1] * 10 + point[0]);
  expect(labels.get(2, [4, 5])).toEqual([4, 5]);
});
