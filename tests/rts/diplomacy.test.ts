import { describe, it, expect } from 'vitest';
import { GameEngine, type LegacyEngineSnapshot } from '@district/rts-engine';
import { BuildingKind, CommandKind, UnitKind } from '@district/rts-shared';
import { fixture, send, advance, building } from './world-fixture';
describe('diplomazia e bot', () => {
  it('richiesta, accettazione reciproca e blocco degli attacchi', () => {
    const e = fixture();
    expect(send(e, { kind: CommandKind.AcceptAlliance, otherPlayerId: 1 }, 2)).toBe(
      'NO_ALLIANCE_REQUEST',
    );
    expect(send(e, { kind: CommandKind.RequestAlliance, otherPlayerId: 2 })).toBeNull();
    expect(send(e, { kind: CommandKind.AcceptAlliance, otherPlayerId: 1 }, 2)).toBeNull();
    expect(e.getPlayer(1)?.alliances.has(2)).toBe(true);
    expect(e.getPlayer(2)?.alliances.has(1)).toBe(true);
    expect(
      send(e, { kind: CommandKind.Attack, targetTile: e.map.index(64, 10), allocationBps: 5000 }),
    ).toBe('ALLIED_TARGET');
  });
  it('tradimento rompe entrambi i lati e applica la penalità', () => {
    const e = fixture();
    send(e, { kind: CommandKind.RequestAlliance, otherPlayerId: 2 });
    send(e, { kind: CommandKind.AcceptAlliance, otherPlayerId: 1 }, 2);
    const gold = e.getPlayer(1)!.gold;
    send(e, { kind: CommandKind.BreakAlliance, otherPlayerId: 2 });
    expect(e.getPlayer(1)!.gold).toBe(gold - Math.floor(gold * 0.05));
    expect(e.getPlayer(1)!.alliances.has(2)).toBe(false);
    expect(e.getPlayer(2)!.alliances.has(1)).toBe(false);
  });
  it('le richieste scadute non si possono accettare', () => {
    const e = fixture();
    send(e, { kind: CommandKind.RequestAlliance, otherPlayerId: 2 });
    advance(e, 300);
    expect(send(e, { kind: CommandKind.AcceptAlliance, otherPlayerId: 1 }, 2)).toBe(
      'NO_ALLIANCE_REQUEST',
    );
  });
  it('bot costruiscono economia, poi espandono territorio con replay deterministico', () => {
    const a = fixture(false, [1, 2]),
      b = fixture(false, [1, 2]);
    const initial = a.map.landSize(1);
    for (let t = 0; t < 150; t++) {
      a.tick();
      b.tick();
    }
    expect(a.getWorldSnapshot().buildings.some((v) => v.kind === BuildingKind.City)).toBe(true);
    expect(a.getWorldSnapshot().buildings.some((v) => v.kind === BuildingKind.Factory)).toBe(true);
    expect(a.map.landSize(1)).toBeGreaterThan(initial);
    expect(a.stateHash()).toBe(b.stateHash());
  });
  it('bot e diplomazia sopravvivono agli snapshot', () => {
    const e = fixture(false, [1]);
    advance(e, 60);
    send(e, { kind: CommandKind.RequestAlliance, otherPlayerId: 1 }, 2);
    const resumed = GameEngine.fromSnapshot(e.snapshot());
    for (let t = 0; t < 100; t++) {
      e.tick();
      resumed.tick();
    }
    expect(resumed.stateHash()).toBe(e.stateHash());
    expect(e.getPlayer(1)!.alliances.has(2)).toBe(true);
  });
  it('commercio alleato paga entrambe le nazioni', () => {
    const e = fixture();
    send(e, { kind: CommandKind.RequestAlliance, otherPlayerId: 2 });
    send(e, { kind: CommandKind.AcceptAlliance, otherPlayerId: 1 }, 2);
    send(e, { kind: CommandKind.Build, tile: e.map.index(64, 20), building: BuildingKind.City }, 2);
    send(e, { kind: CommandKind.Build, tile: e.map.index(30, 20), building: BuildingKind.Factory });
    const one = e.getPlayer(1)!.gold,
      two = e.getPlayer(2)!.gold;
    advance(e, 1500);
    expect(e.getPlayer(1)!.gold).toBeGreaterThan(one);
    expect(e.getPlayer(2)!.gold).toBeGreaterThan(two);
  });
});
describe('invarianti snapshot v2 e migrazione', () => {
  it('rifiuta ID duplicati, edifici orfani e munizioni create', () => {
    const e = fixture();
    send(e, { kind: CommandKind.Build, tile: 300, building: BuildingKind.MissileSilo });
    const snapshot = e.snapshot();
    expect(() =>
      GameEngine.fromSnapshot({
        ...snapshot,
        world: {
          ...snapshot.world,
          buildings: [snapshot.world.buildings[0]!, snapshot.world.buildings[0]!],
        },
      }),
    ).toThrow();
    expect(() =>
      GameEngine.fromSnapshot({ ...snapshot, world: { ...snapshot.world, buildings: [] } }),
    ).toThrow();
    expect(() =>
      GameEngine.fromSnapshot({
        ...snapshot,
        world: {
          ...snapshot.world,
          buildings: snapshot.world.buildings.map((b) => ({ ...b, ammunition: 5 })),
        },
      }),
    ).toThrow();
  });
  it('riprende uno snapshot legacy senza nuove entità', () => {
    const e = fixture();
    advance(e, 5);
    const { world: removed, version: oldVersion, ...state } = e.snapshot();
    expect(removed.buildings).toHaveLength(0);
    expect(oldVersion).toBe(2);
    const legacy = { ...state, version: 1 } as LegacyEngineSnapshot;
    const resumed = GameEngine.fromSnapshot(legacy);
    expect(resumed.stateHash()).toBe(e.stateHash());
  });
  it('letture mondo non permettono di modificare unità e set attivi', () => {
    const e = fixture();
    send(e, { kind: CommandKind.Build, tile: 300, building: BuildingKind.City });
    send(e, { kind: CommandKind.Build, tile: 310, building: BuildingKind.Factory });
    advance(e, 80);
    const hash = e.stateHash(),
      snapshot = e.getWorldSnapshot();
    snapshot.buildings[0]!.hp = 1;
    const train = snapshot.units.find((u) => u.kind === UnitKind.Train);
    if (train?.kind === UnitKind.Train) train.visitedStationIds.add(9999);
    expect(e.stateHash()).toBe(hash);
    expect(building(e, BuildingKind.City).hp).toBeGreaterThan(1);
  });
});
