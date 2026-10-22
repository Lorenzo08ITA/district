import { GameEngine, GameMap, Mulberry32 } from '@district/rts-engine';
import { CommandKind, encodeCommands, decodeCommands } from '@district/rts-shared';
const map = new GameMap(128, 96),
  random = new Mulberry32(20261021);
for (let i = 0; i < map.length; i++) map.setElevation(i, random.nextInt(128));
const engine = new GameEngine({
  map,
  seed: 42,
  players: [
    { id: 1, name: 'Alba', spawnTile: map.index(12, 12), spawnRadius: 2 },
    { id: 2, name: 'Vespro', spawnTile: map.index(115, 83), spawnRadius: 2 },
  ],
});
const wire = encodeCommands([
  {
    kind: CommandKind.Attack,
    playerId: 1,
    sequence: 1,
    executeTick: 1,
    targetTile: map.index(15, 12),
    allocationBps: 6000,
  },
  {
    kind: CommandKind.Attack,
    playerId: 2,
    sequence: 1,
    executeTick: 1,
    targetTile: map.index(112, 83),
    allocationBps: 6000,
  },
]);
for (const command of decodeCommands(wire)) engine.enqueue(command);
for (let i = 0; i < 200 && engine.winnerId === null; i++) engine.tick();
const restored = GameEngine.fromSnapshot(engine.snapshot());
if (restored.stateHash() !== engine.stateHash()) throw new Error('Snapshot checksum mismatch');
console.log(
  JSON.stringify(
    {
      tick: engine.currentTick,
      elapsedMs: engine.elapsedMs,
      stateHash: engine.stateHash(),
      commandPacketBytes: wire.byteLength,
      players: engine
        .getPlayers()
        .map(({ id, name, troops, maxTroops, gold, landSize }) => ({
          id,
          name,
          troops,
          maxTroops,
          gold,
          landSize,
        })),
    },
    null,
    2,
  ),
);
