import { describe, it, expect } from 'vitest';
import { GameEngine } from '@district/rts-engine';
import { BALANCE, BUILDING_RULES, BuildingKind, UnitKind, CommandKind } from '@district/rts-shared';
import { fixture, send, advance, building } from './world-fixture';
describe('strutture e infrastrutture', () => {
  it('città, upgrade e cap truppe sono coerenti', () => {
    const e = fixture(),
      tile = e.map.index(12, 12),
      gold = e.getPlayer(1)!.gold,
      cap = e.getPlayer(1)!.maxTroops;
    expect(send(e, { kind: CommandKind.Build, tile, building: BuildingKind.City })).toBeNull();
    expect(e.getPlayer(1)!.gold).toBe(gold - BUILDING_RULES[BuildingKind.City].gold);
    expect(e.getPlayer(1)!.maxTroops).toBe(cap + 250000);
    const city = building(e, BuildingKind.City);
    expect(send(e, { kind: CommandKind.Upgrade, buildingId: city.id })).toBeNull();
    expect(e.getPlayer(1)!.maxTroops).toBe(cap + 500000);
    expect(e.map.buildingId[tile]).toBe(city.id);
  });
  it('rifiuti non consumano oro: nemico, casella occupata, porto interno', () => {
    const e = fixture(),
      gold = e.getPlayer(1)!.gold;
    expect(
      send(e, { kind: CommandKind.Build, tile: e.map.index(70, 5), building: BuildingKind.City }),
    ).toBe('NOT_OWNER');
    expect(
      send(e, { kind: CommandKind.Build, tile: e.map.index(2, 2), building: BuildingKind.Port }),
    ).toBe('NOT_COASTAL');
    expect(e.getPlayer(1)!.gold).toBe(gold);
    send(e, { kind: CommandKind.Build, tile: e.map.index(2, 2), building: BuildingKind.City });
    const paid = e.getPlayer(1)!.gold;
    expect(
      send(e, { kind: CommandKind.Build, tile: e.map.index(2, 2), building: BuildingKind.Factory }),
    ).toBe('OCCUPIED');
    expect(e.getPlayer(1)!.gold).toBe(paid);
  });
  it('difese: raggio 30, copertura del proprietario, prezzi e nessun upgrade', () => {
    const e = fixture(),
      tile = e.map.index(20, 20),
      gold = e.getPlayer(1)!.gold;
    send(e, { kind: CommandKind.Build, tile, building: BuildingKind.DefensePost });
    expect(e.map.defenseCoverage[e.map.index(21, 21)]).toBe(1);
    expect(e.map.defenseCoverage[e.map.index(20, 51)]).toBe(0);
    expect(e.map.defenseCoverage[e.map.index(33, 20)]).toBe(0);
    expect(
      send(e, { kind: CommandKind.Upgrade, buildingId: building(e, BuildingKind.DefensePost).id }),
    ).toBe('MAX_LEVEL');
    send(e, { kind: CommandKind.Build, tile: tile + 1, building: BuildingKind.DefensePost });
    expect(gold - e.getPlayer(1)!.gold).toBe(150000);
    expect(e.map.defenseCoverage[tile]).toBe(2);
  });
  it('catturare una città sposta cap e proprietà', () => {
    const e = fixture(),
      tile = e.map.index(20, 20);
    send(e, { kind: CommandKind.Build, tile, building: BuildingKind.City });
    const id = building(e, BuildingKind.City).id;
    e.capture(tile, 2);
    e.tick();
    expect(e.getWorldSnapshot().buildings.find((b) => b.id === id)?.ownerId).toBe(2);
    expect(e.getPlayer(1)?.cityLevels).toBe(0);
    expect(e.getPlayer(2)?.cityLevels).toBe(1);
  });
  it('ferrovie collegano factory/stazioni e treni pagano le visite', () => {
    const e = fixture();
    send(e, { kind: CommandKind.Build, tile: e.map.index(5, 5), building: BuildingKind.City });
    send(e, { kind: CommandKind.Build, tile: e.map.index(12, 5), building: BuildingKind.Factory });
    const state = e.getWorldSnapshot();
    expect(state.rails.length).toBe(1);
    expect(state.rails[0]!.tiles.every((t) => e.map.isLand(t))).toBe(true);
    const initial = e.getPlayer(1)!.gold;
    advance(e, 1500);
    expect(e.getPlayer(1)!.gold).toBeGreaterThan(initial);
    expect(e.getWorldSnapshot().nextEntityId).toBeGreaterThan(state.nextEntityId);
  });
  it('le fabbriche con lo stesso seed generano gli stessi treni', () => {
    const a = fixture(),
      b = fixture();
    for (const e of [a, b]) {
      send(e, { kind: CommandKind.Build, tile: 400, building: BuildingKind.City });
      send(e, { kind: CommandKind.Build, tile: 408, building: BuildingKind.Factory });
    }
    for (let t = 0; t < 400; t++) {
      a.tick();
      b.tick();
    }
    expect(a.stateHash()).toBe(b.stateHash());
    expect(a.getWorldSnapshot()).toEqual(b.getWorldSnapshot());
  });
  it('snapshot strutture, binari e treni riprende senza differenze', () => {
    const e = fixture();
    send(e, { kind: CommandKind.Build, tile: 400, building: BuildingKind.City });
    send(e, { kind: CommandKind.Build, tile: 410, building: BuildingKind.Factory });
    advance(e, 200);
    const restored = GameEngine.fromSnapshot(e.snapshot());
    expect(restored.stateHash()).toBe(e.stateHash());
    for (let i = 0; i < 150; i++) {
      e.tick();
      restored.tick();
    }
    expect(restored.stateHash()).toBe(e.stateHash());
  });
  it('porti generano commercio periodico e profitto in base alla rotta', () => {
    const e = fixture(true);
    send(e, { kind: CommandKind.Build, tile: e.map.index(31, 10), building: BuildingKind.Port });
    send(e, { kind: CommandKind.Build, tile: e.map.index(31, 45), building: BuildingKind.Port });
    const before = e.getPlayer(1)!.gold;
    advance(e, 250);
    expect(e.getPlayer(1)!.gold).toBeGreaterThan(before);
    expect(e.getWorldSnapshot().units.some((u) => u.kind === UnitKind.TradeShip)).toBe(true);
  });
  it('prezzo Defense Post satura a 250000', () => {
    const e = fixture();
    const before = e.getPlayer(1)!.gold;
    for (let i = 0; i < 6; i++)
      send(e, {
        kind: CommandKind.Build,
        tile: e.map.index(4 + i, 4),
        building: BuildingKind.DefensePost,
      });
    expect(before - e.getPlayer(1)!.gold).toBe(50000 + 100000 + 150000 + 200000 + 250000 + 250000);
    expect(BALANCE.defenseMaxGold).toBe(250000);
  });
});

it('cattura Defense Post ricostruisce copertura e snapshot', () => {
  const e = fixture(),
    tile = e.map.index(30, 30);
  send(e, { kind: CommandKind.Build, tile, building: BuildingKind.DefensePost });
  expect(e.map.defenseCoverage[tile - 1]).toBe(1);
  e.capture(tile, 2);
  e.tick();
  expect(e.map.defenseCoverage[tile - 1]).toBe(0);
  expect(e.map.defenseCoverage[tile]).toBe(1);
  const resumed = GameEngine.fromSnapshot(e.snapshot());
  expect(resumed.stateHash()).toBe(e.stateHash());
});
it('snapshot conserva truppe oltre il cap di base ma entro quello delle città', () => {
  const e = fixture(),
    tile = e.map.index(20, 20);
  send(e, { kind: CommandKind.Build, tile, building: BuildingKind.City });
  const snapshot = e.snapshot(),
    troops = e.map.landSize(1) * 5000 + 100000;
  const resumed = GameEngine.fromSnapshot({
    ...snapshot,
    players: snapshot.players.map((p) => (p.id === 1 ? { ...p, troops } : p)),
  });
  expect(resumed.getPlayer(1)?.troops).toBe(troops);
  expect(resumed.getPlayer(1)?.maxTroops).toBe(e.getPlayer(1)?.maxTroops);
});
