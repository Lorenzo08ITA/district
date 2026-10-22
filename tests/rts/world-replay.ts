import { GameEngine } from '@district/rts-engine';
import { BuildingKind, CommandKind, WeaponKind } from '@district/rts-shared';
import { fixture, send, building } from './world-fixture';
export function runWorldReplay() {
  const engine = fixture(true);
  for (const [owner, x, y, kind] of [
    [1, 10, 20, BuildingKind.City],
    [1, 15, 20, BuildingKind.Factory],
    [1, 31, 20, BuildingKind.Port],
    [1, 31, 45, BuildingKind.Port],
    [1, 10, 10, BuildingKind.MissileSilo],
    [2, 75, 30, BuildingKind.City],
    [2, 70, 25, BuildingKind.SamLauncher],
    [2, 64, 20, BuildingKind.Port],
  ] as const)
    send(engine, { kind: CommandKind.Build, tile: engine.map.index(x, y), building: kind }, owner);
  send(engine, {
    kind: CommandKind.ProduceWarship,
    portId: building(engine, BuildingKind.Port).id,
    patrolTile: engine.map.index(47, 20),
  });
  send(
    engine,
    {
      kind: CommandKind.ProduceWarship,
      portId: building(engine, BuildingKind.Port, 2).id,
      patrolTile: engine.map.index(49, 20),
    },
    2,
  );
  send(engine, {
    kind: CommandKind.Transport,
    targetTile: engine.map.index(64, 40),
    allocationBps: 2000,
  });
  send(engine, {
    kind: CommandKind.LaunchNuke,
    siloId: building(engine, BuildingKind.MissileSilo).id,
    targetTile: engine.map.index(75, 30),
    weapon: WeaponKind.Mirv,
  });
  let restored = GameEngine.fromSnapshot(engine.snapshot());
  const hashes: number[] = [];
  for (let tick = 0; tick < 140; tick++) {
    engine.tick();
    restored.tick();
    if (tick === 10) restored = GameEngine.fromSnapshot(restored.snapshot());
    if (tick % 20 === 0) {
      if (engine.stateHash() !== restored.stateHash()) throw new Error('World replay divergence');
      hashes.push(engine.stateHash());
    }
  }
  return {
    hashes,
    finalHash: engine.stateHash(),
    resumedHash: restored.stateHash(),
    players: engine
      .getPlayers()
      .map((p) => ({ id: p.id, gold: p.gold, troops: p.troops, land: p.landSize })),
    buildings: engine.getWorldSnapshot().buildings.length,
    mirvLaunches: engine.getWorldSnapshot().mirvLaunches,
    contaminated: engine.map.contaminationUntil.filter((t) => t > engine.currentTick).length,
  };
}
