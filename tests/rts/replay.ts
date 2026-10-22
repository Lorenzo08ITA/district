import { GameEngine, GameMap, Mulberry32 } from '@district/rts-engine';
import { CommandKind } from '@district/rts-shared';
export function runReplay() {
  const map = new GameMap(64, 48);
  const random = new Mulberry32(20261021);
  for (let i = 0; i < map.length; i++) map.setElevation(i, random.nextInt(180));
  const engine = new GameEngine({
    map,
    seed: 73,
    players: [
      { id: 1, name: 'Alba', spawnTile: map.index(8, 8), spawnRadius: 2 },
      { id: 2, name: 'Vespro', spawnTile: map.index(55, 39), spawnRadius: 2 },
    ],
  });
  // Deliberately enqueue the second player first; execution order is canonical.
  engine.enqueue({
    kind: CommandKind.Attack,
    playerId: 2,
    sequence: 1,
    executeTick: 1,
    targetTile: map.index(52, 39),
    allocationBps: 6000,
  });
  engine.enqueue({
    kind: CommandKind.Attack,
    playerId: 1,
    sequence: 1,
    executeTick: 1,
    targetTile: map.index(11, 8),
    allocationBps: 6000,
  });
  const hashes: number[] = [];
  for (let tick = 0; tick < 180; tick++) {
    engine.tick();
    if (tick % 15 === 0) hashes.push(engine.stateHash());
  }
  const resumed = GameEngine.fromSnapshot(engine.snapshot());
  for (let tick = 0; tick < 20; tick++) {
    engine.tick();
    resumed.tick();
  }
  return {
    hashes,
    finalHash: engine.stateHash(),
    resumedHash: resumed.stateHash(),
    land: engine.getPlayers().map((p) => p.landSize),
    troops: engine.getPlayers().map((p) => p.troops),
  };
}
