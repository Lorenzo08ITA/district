import { performance } from 'node:perf_hooks';
import { GameEngine, GameMap } from '@district/rts-engine';
import { BuildingKind, CommandKind, WeaponKind, TerrainType } from '@district/rts-shared';
const large = process.argv.includes('--large'),
  width = large ? 2000 : 96,
  height = large ? 2000 : 64;
const initializationStarted = performance.now(),
  map = new GameMap(width, height),
  left = Math.floor(width / 3) - 1,
  right = width - Math.floor(width / 3),
  midY = Math.floor(height / 2);
for (let y = 0; y < height; y++)
  for (let x = 0; x < width; x++) {
    const tile = map.index(x, y);
    if (x > left && x < right) map.setTerrain(tile, TerrainType.DeepWater);
    else map.setOwner(tile, x <= left ? 1 : 2);
  }
const engine = new GameEngine({
  map,
  seed: 7362,
  players: [
    { id: 1, name: 'Alba', initialGold: 100000000, initialTroops: 500000 },
    { id: 2, name: 'Vespro', initialGold: 100000000, initialTroops: 500000 },
  ],
});
const counters = new Map();
function collect(result) {
  for (const event of result.events) {
    const key = event.kind === 'world' ? event.action : event.kind;
    counters.set(key, (counters.get(key) || 0) + 1);
  }
}
function send(playerId, payload) {
  const result = engine.enqueue({
    ...payload,
    playerId,
    sequence: engine.nextCommandSequence(playerId),
    executeTick: engine.currentTick + 1,
  });
  if (!result.accepted) throw new Error(result.reason);
  const tick = engine.tick();
  for (const event of tick.events)
    if (event.kind === 'commandRejected') throw new Error(event.reason);
  collect(tick);
}
function building(owner, kind) {
  return engine.getWorldSnapshot().buildings.find((b) => b.ownerId === owner && b.kind === kind);
}
for (const [owner, x, y, kind] of [
  [1, left - 20, midY, BuildingKind.City],
  [1, left - 10, midY, BuildingKind.Factory],
  [1, left, midY, BuildingKind.Port],
  [1, left, midY + 15, BuildingKind.Port],
  [1, left - 25, midY - 10, BuildingKind.MissileSilo],
  [2, right + 10, midY, BuildingKind.City],
  [2, right + 5, midY - 5, BuildingKind.SamLauncher],
  [2, right, midY, BuildingKind.Port],
])
  send(owner, { kind: CommandKind.Build, tile: map.index(x, y), building: kind });
send(1, {
  kind: CommandKind.ProduceWarship,
  portId: building(1, BuildingKind.Port).id,
  patrolTile: map.index(Math.floor(width / 2) - 1, midY),
});
send(2, {
  kind: CommandKind.ProduceWarship,
  portId: building(2, BuildingKind.Port).id,
  patrolTile: map.index(Math.floor(width / 2) + 1, midY),
});
send(1, {
  kind: CommandKind.Transport,
  targetTile: map.index(right, midY + 8),
  allocationBps: 2000,
});
send(1, {
  kind: CommandKind.LaunchNuke,
  siloId: building(1, BuildingKind.MissileSilo).id,
  targetTile: map.index(right + 10, midY),
  weapon: WeaponKind.Mirv,
});
const initializationMs = performance.now() - initializationStarted,
  times = [],
  ticks = large ? 600 : 180;
for (let tick = 0; tick < ticks; tick++) {
  const start = performance.now();
  const result = engine.tick();
  times.push(performance.now() - start);
  collect(result);
}
const restored = GameEngine.fromSnapshot(engine.snapshot());
if (restored.stateHash() !== engine.stateHash()) throw new Error('World restore checksum mismatch');
times.sort((a, b) => a - b);
const world = engine.getWorldSnapshot();
console.log(
  JSON.stringify(
    {
      map: [width, height],
      ticks,
      initializationMs,
      averageTickMs: times.reduce((a, b) => a + b, 0) / times.length,
      p95TickMs: times[Math.floor(times.length * 0.95)],
      maxTickMs: times[times.length - 1],
      events: Object.fromEntries(counters),
      remaining: {
        buildings: world.buildings.length,
        units: world.units.length,
        missiles: world.missiles.length,
      },
      players: engine
        .getPlayers()
        .map(({ id, gold, troops, landSize }) => ({ id, gold, troops, landSize })),
      stateHash: engine.stateHash(),
      arrayBufferMiB: process.memoryUsage().arrayBuffers / 1024 / 1024,
      note: 'Synthetic deterministic scenario, not a multiplayer capacity certification.',
    },
    null,
    2,
  ),
);
