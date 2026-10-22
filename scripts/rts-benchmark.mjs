import { performance } from 'node:perf_hooks';
import { GameEngine, GameMap } from '@district/rts-engine';
import { CommandKind } from '@district/rts-shared';
const started = performance.now();
const map = new GameMap(2000, 2000);
const engine = new GameEngine({
  map,
  seed: 1,
  players: [
    { id: 1, name: 'North', spawnTile: map.index(200, 200), spawnRadius: 4, initialTroops: 200000 },
    {
      id: 2,
      name: 'South',
      spawnTile: map.index(1800, 1800),
      spawnRadius: 4,
      initialTroops: 200000,
    },
  ],
});
const initializationMs = performance.now() - started;
// Initial full-map transfer is measured separately from steady-state deltas.
const first = performance.now();
const initialTiles = map.consumeDirtyTiles().length;
const initialDeltaMs = performance.now() - first;
engine.enqueue({
  kind: CommandKind.Attack,
  playerId: 1,
  sequence: 1,
  executeTick: 1,
  targetTile: map.index(205, 200),
  allocationBps: 9000,
});
engine.enqueue({
  kind: CommandKind.Attack,
  playerId: 2,
  sequence: 1,
  executeTick: 1,
  targetTile: map.index(1795, 1800),
  allocationBps: 9000,
});
const times = [];
let changed = 0;
for (let tick = 0; tick < 300; tick++) {
  const start = performance.now();
  const result = engine.tick();
  times.push(performance.now() - start);
  changed += result.dirtyTiles.length;
}
times.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      map: [2000, 2000],
      players: 2,
      ticks: 300,
      initializationMs,
      initialDeltaMs,
      initialTiles,
      averageTickMs: times.reduce((a, b) => a + b, 0) / times.length,
      p95TickMs: times[Math.floor(times.length * 0.95)],
      maxTickMs: times[times.length - 1],
      dirtyTileUpdates: changed,
      arrayBufferMiB: process.memoryUsage().arrayBuffers / 1024 / 1024,
      note: 'Synthetic two-player neutral expansion; not a server load/capacity test.',
    },
    null,
    2,
  ),
);
