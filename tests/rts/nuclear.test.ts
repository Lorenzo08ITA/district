import { describe, it, expect } from 'vitest';
import { GameEngine, GameMap, nuclearPrice } from '@district/rts-engine';
import { BALANCE, BuildingKind, CommandKind, WeaponKind } from '@district/rts-shared';
import { fixture, send, advance, building, queue } from './world-fixture';
function prepare(sam = false) {
  const e = fixture();
  send(e, {
    kind: CommandKind.Build,
    tile: e.map.index(10, 10),
    building: BuildingKind.MissileSilo,
  });
  send(e, { kind: CommandKind.Build, tile: e.map.index(76, 30), building: BuildingKind.City }, 2);
  if (sam)
    send(
      e,
      { kind: CommandKind.Build, tile: e.map.index(70, 25), building: BuildingKind.SamLauncher },
      2,
    );
  return e;
}
describe('nucleare e SAM', () => {
  it('atomica neutralizza, distrugge, danneggia anello esterno e contamina', () => {
    const e = prepare();
    send(e, { kind: CommandKind.Build, tile: e.map.index(95, 30), building: BuildingKind.City }, 2);
    const inner = e.map.index(76, 30),
      outer = building(e, BuildingKind.City, 2);
    const outerId = e.getWorldSnapshot().buildings.find((b) => b.tile === e.map.index(95, 30))!.id;
    const before = e.getPlayer(1)!.gold;
    expect(
      send(e, {
        kind: CommandKind.LaunchNuke,
        siloId: building(e, BuildingKind.MissileSilo).id,
        targetTile: inner,
        weapon: WeaponKind.Atom,
      }),
    ).toBeNull();
    expect(before - e.getPlayer(1)!.gold).toBe(BALANCE.atomGold);
    advance(e, 25);
    expect(e.map.ownerId[inner]).toBe(0);
    expect(e.map.buildingId[inner]).toBe(0);
    expect(e.map.contaminationUntil[inner]).toBeGreaterThan(e.currentTick);
    expect(e.getWorldSnapshot().buildings.find((b) => b.id === outerId)!.hp).toBeLessThan(outer.hp);
  });
  it('SAM intercetta prima dell’impatto e rispetta la ricarica', () => {
    const e = prepare(true),
      target = e.map.index(76, 30);
    send(e, {
      kind: CommandKind.LaunchNuke,
      siloId: building(e, BuildingKind.MissileSilo).id,
      targetTile: target,
      weapon: WeaponKind.Atom,
    });
    const events = [];
    for (let i = 0; i < 25; i++) events.push(...e.tick().events);
    expect(events.some((v) => v.kind === 'world' && v.action === 'intercepted')).toBe(true);
    expect(e.map.ownerId[target]).toBe(2);
    expect(building(e, BuildingKind.SamLauncher, 2).cooldownTicks).toBeGreaterThan(0);
    expect(building(e, BuildingKind.MissileSilo).ammunition).toBe(1);
  });
  it('un SAM non ferma due testate simultanee durante cooldown', () => {
    const e = prepare(true);
    send(e, {
      kind: CommandKind.Build,
      tile: e.map.index(11, 10),
      building: BuildingKind.MissileSilo,
    });
    for (const silo of e
      .getWorldSnapshot()
      .buildings.filter((b) => b.kind === BuildingKind.MissileSilo))
      queue(e, {
        kind: CommandKind.LaunchNuke,
        siloId: silo.id,
        targetTile: e.map.index(76, 30),
        weapon: WeaponKind.Atom,
      });
    e.tick();
    const events = [];
    for (let i = 0; i < 25; i++) events.push(...e.tick().events);
    expect(events.filter((v) => v.kind === 'world' && v.action === 'intercepted')).toHaveLength(1);
    expect(events.some((v) => v.kind === 'world' && v.action === 'detonated')).toBe(true);
  });
  it('MIRV sale al bordo e divide in 350 testate indipendenti', () => {
    const e = prepare();
    const before = e.getPlayer(1)!.gold;
    send(e, {
      kind: CommandKind.LaunchNuke,
      siloId: building(e, BuildingKind.MissileSilo).id,
      targetTile: e.map.index(76, 30),
      weapon: WeaponKind.Mirv,
    });
    expect(before - e.getPlayer(1)!.gold).toBe(25000000);
    advance(e, 8);
    const state = e.getWorldSnapshot();
    expect(state.mirvLaunches).toBe(1);
    expect(state.missiles).toHaveLength(350);
    expect(state.missiles.every((m) => m.parentId !== null && m.weapon === WeaponKind.Atom)).toBe(
      true,
    );
    expect(new Set(state.missiles.map((m) => m.targetTile)).size).toBe(350);
    expect(nuclearPrice(WeaponKind.Mirv, state.mirvLaunches)).toBe(40000000);
  });
  it('snapshot con MIRV riprende PRNG, testate e contaminazione', () => {
    const e = prepare();
    send(e, {
      kind: CommandKind.LaunchNuke,
      siloId: building(e, BuildingKind.MissileSilo).id,
      targetTile: e.map.index(76, 30),
      weapon: WeaponKind.Mirv,
    });
    advance(e, 8);
    const restored = GameEngine.fromSnapshot(e.snapshot());
    for (let i = 0; i < 30; i++) {
      e.tick();
      restored.tick();
    }
    expect(restored.stateHash()).toBe(e.stateHash());
    expect(restored.map.ownerId).toEqual(e.map.ownerId);
    expect(restored.map.contaminationUntil).toEqual(e.map.contaminationUntil);
  });
  it('bomba H ha area maggiore e nessuna testata colpisce alleati deliberatamente', () => {
    const e = prepare();
    send(e, {
      kind: CommandKind.LaunchNuke,
      siloId: building(e, BuildingKind.MissileSilo).id,
      targetTile: e.map.index(76, 30),
      weapon: WeaponKind.Hydrogen,
    });
    advance(e, 30);
    expect(e.map.ownerId[e.map.index(64, 60)]).toBe(0);
    expect(e.getPlayer(2)!.troops).toBe(0);
  });
  it('munizioni e upgrade contano simultaneità sui voli lunghi', () => {
    const map = new GameMap(2000, 100),
      e = new GameEngine({
        map,
        seed: 1,
        players: [
          { id: 1, name: 'A', spawnTile: map.index(10, 30), initialGold: 100000000 },
          { id: 2, name: 'B', spawnTile: map.index(1900, 30), initialGold: 100000000 },
        ],
      });
    send(e, {
      kind: CommandKind.Build,
      tile: map.index(10, 30),
      building: BuildingKind.MissileSilo,
    });
    const silo = building(e, BuildingKind.MissileSilo),
      launch = {
        kind: CommandKind.LaunchNuke as const,
        siloId: silo.id,
        targetTile: map.index(1900, 30),
        weapon: WeaponKind.Atom,
      };
    send(e, launch);
    expect(send(e, launch)).toBe('COOLDOWN');
    advance(e, 90);
    expect(send(e, launch)).toBe('NO_AMMUNITION');
    send(e, { kind: CommandKind.Upgrade, buildingId: silo.id });
    expect(send(e, launch)).toBeNull();
    expect(e.getWorldSnapshot().missiles).toHaveLength(2);
  });
  it('contaminazione scade e segnala i tile da aggiornare', () => {
    const e = prepare(),
      target = e.map.index(76, 30);
    send(e, {
      kind: CommandKind.LaunchNuke,
      siloId: building(e, BuildingKind.MissileSilo).id,
      targetTile: target,
      weapon: WeaponKind.Atom,
    });
    advance(e, 25);
    const expiry = e.map.contaminationUntil[target]!;
    while (e.currentTick < expiry - 1) e.tick();
    const result = e.tick();
    expect(e.map.contaminationUntil[target]).toBe(0);
    expect(result.dirtyTiles).toContain(target);
  });
});

it('un’alleanza ferma testate in volo contro il nuovo alleato', () => {
  const e = prepare();
  send(e, {
    kind: CommandKind.LaunchNuke,
    siloId: building(e, BuildingKind.MissileSilo).id,
    targetTile: e.map.index(76, 30),
    weapon: WeaponKind.Atom,
  });
  send(e, { kind: CommandKind.RequestAlliance, otherPlayerId: 2 });
  send(e, { kind: CommandKind.AcceptAlliance, otherPlayerId: 1 }, 2);
  advance(e, 20);
  expect(e.getWorldSnapshot().missiles).toHaveLength(0);
  expect(e.map.ownerId[e.map.index(76, 30)]).toBe(2);
});
it('collaterali nucleari non danneggiano territori alleati', () => {
  const e = prepare();
  send(e, { kind: CommandKind.RequestAlliance, otherPlayerId: 2 });
  send(e, { kind: CommandKind.AcceptAlliance, otherPlayerId: 1 }, 2);
  send(e, {
    kind: CommandKind.LaunchNuke,
    siloId: building(e, BuildingKind.MissileSilo).id,
    targetTile: e.map.index(60, 30),
    weapon: WeaponKind.Atom,
  });
  advance(e, 25);
  expect(e.map.ownerId[e.map.index(64, 30)]).toBe(2);
  expect(building(e, BuildingKind.City, 2).hp).toBe(2000);
});

it('nuke converte rilievi colpiti in pianura a elevazione zero', () => {
  const e = prepare(),
    tile = e.map.index(76, 30);
  e.map.setTerrain(tile, 5);
  e.map.setElevation(tile, 240);
  send(e, {
    kind: CommandKind.LaunchNuke,
    siloId: building(e, BuildingKind.MissileSilo).id,
    targetTile: tile,
    weapon: WeaponKind.Atom,
  });
  advance(e, 25);
  expect(e.map.terrainType[tile]).toBe(3);
  expect(e.map.elevation[tile]).toBe(0);
});
