import { describe, it, expect } from 'vitest';
import { GameEngine } from '@district/rts-engine';
import { BuildingKind, UnitKind, CommandKind, WORLD_BALANCE } from '@district/rts-shared';
import { fixture, send, advance, building, queue } from './world-fixture';
describe('trasporti e guerra navale', () => {
  it('sbarco dopo navigazione e fronte terrestre sul bersaglio', () => {
    const e = fixture(true),
      target = e.map.index(64, 20);
    expect(
      send(e, { kind: CommandKind.Transport, targetTile: target, allocationBps: 2000 }),
    ).toBeNull();
    const ship = e.getWorldSnapshot().units.find((u) => u.kind === UnitKind.TransportShip)!;
    expect(ship.kind).toBe(UnitKind.TransportShip);
    expect(ship.path.every((t) => !e.map.isLand(t))).toBe(true);
    advance(e, 70);
    expect(e.map.ownerId[target]).toBe(1);
    expect(e.getWorldSnapshot().units.some((u) => u.kind === UnitKind.TransportShip)).toBe(false);
  });
  it('massimo 20%, coste obbligatorie e nessun prelievo se non esiste rotta', () => {
    const e = fixture(true);
    expect(() =>
      queue(e, {
        kind: CommandKind.Transport,
        targetTile: e.map.index(64, 2),
        allocationBps: 3000,
      }),
    ).toThrow();
    expect(
      send(e, { kind: CommandKind.Transport, targetTile: e.map.index(70, 2), allocationBps: 2000 }),
    ).toBe('NOT_COASTAL');
    const land = fixture();
    expect(
      send(land, {
        kind: CommandKind.Transport,
        targetTile: land.map.index(64, 2),
        allocationBps: 2000,
      }),
    ).toBe('NOT_COASTAL');
    expect(e.getWorldSnapshot().units).toHaveLength(0);
  });
  it('produzione autorizzata, HP e pattuglia', () => {
    const e = fixture(true);
    send(e, { kind: CommandKind.Build, tile: e.map.index(31, 10), building: BuildingKind.Port });
    const port = building(e, BuildingKind.Port);
    expect(
      send(
        e,
        { kind: CommandKind.ProduceWarship, portId: port.id, patrolTile: e.map.index(48, 10) },
        2,
      ),
    ).toBe('NOT_OWNER');
    const gold = e.getPlayer(1)!.gold;
    expect(
      send(e, {
        kind: CommandKind.ProduceWarship,
        portId: port.id,
        patrolTile: e.map.index(48, 10),
      }),
    ).toBeNull();
    expect(gold - e.getPlayer(1)!.gold).toBe(WORLD_BALANCE.warshipGold);
    const ship = e.getWorldSnapshot().units.find((u) => u.kind === UnitKind.Warship)!;
    expect(ship.hp).toBe(1000);
    expect(
      send(e, { kind: CommandKind.Patrol, shipId: ship.id, targetTile: e.map.index(49, 12) }),
    ).toBeNull();
    advance(e, 35);
    const moved = e.getWorldSnapshot().units.find((u) => u.id === ship.id)!;
    expect(moved.tile).toBe(e.map.index(49, 12));
  });
  it('warship affonda trasporto: nessuno sbarco o attacco gratuito', () => {
    const e = fixture(true),
      target = e.map.index(64, 20);
    send(e, { kind: CommandKind.Build, tile: e.map.index(64, 20), building: BuildingKind.Port }, 2);
    const port = building(e, BuildingKind.Port, 2);
    send(
      e,
      { kind: CommandKind.ProduceWarship, portId: port.id, patrolTile: e.map.index(48, 20) },
      2,
    );
    advance(e, 35);
    send(e, { kind: CommandKind.Transport, targetTile: target, allocationBps: 2000 });
    const events = [];
    for (let i = 0; i < 85; i++) events.push(...e.tick().events);
    expect(e.map.ownerId[target]).toBe(2);
    expect(e.getWorldSnapshot().units.some((u) => u.kind === UnitKind.TransportShip)).toBe(false);
    expect(events.some((v) => v.kind === 'attackStarted' && v.playerId === 1)).toBe(false);
    expect(
      e.getWorldSnapshot().units.some((u) => u.kind === UnitKind.Warship && u.experience >= 10),
    ).toBe(true);
  });
  it('combattimento tra flotte con proiettili da 250 e veterancy', () => {
    const e = fixture(true);
    send(e, { kind: CommandKind.Build, tile: e.map.index(31, 10), building: BuildingKind.Port });
    send(e, { kind: CommandKind.Build, tile: e.map.index(64, 10), building: BuildingKind.Port }, 2);
    for (let i = 0; i < 2; i++)
      send(e, {
        kind: CommandKind.ProduceWarship,
        portId: building(e, BuildingKind.Port).id,
        patrolTile: e.map.index(47, 10),
      });
    send(
      e,
      {
        kind: CommandKind.ProduceWarship,
        portId: building(e, BuildingKind.Port, 2).id,
        patrolTile: e.map.index(49, 10),
      },
      2,
    );
    advance(e, 100);
    const ships = e.getWorldSnapshot().units.filter((u) => u.kind === UnitKind.Warship);
    expect(ships.filter((u) => u.ownerId === 2)).toHaveLength(0);
    expect(ships.some((u) => u.kind === UnitKind.Warship && u.experience >= 10)).toBe(true);
  });
  it('nave commerciale catturata trasferisce il carico, non lo duplica', () => {
    const e = fixture(true);
    send(e, { kind: CommandKind.Build, tile: e.map.index(31, 10), building: BuildingKind.Port });
    send(e, { kind: CommandKind.Build, tile: e.map.index(31, 45), building: BuildingKind.Port });
    send(e, { kind: CommandKind.Build, tile: e.map.index(64, 20), building: BuildingKind.Port }, 2);
    send(
      e,
      {
        kind: CommandKind.ProduceWarship,
        portId: building(e, BuildingKind.Port, 2).id,
        patrolTile: e.map.index(32, 25),
      },
      2,
    );
    const before = e.getPlayer(2)!.gold;
    let captured = false;
    for (let i = 0; i < 200; i++) {
      const result = e.tick();
      if (
        result.events.some((v) => v.kind === 'world' && v.action === 'captured' && v.playerId === 2)
      ) {
        captured = true;
        break;
      }
    }
    expect(captured).toBe(true);
    expect(
      e
        .getWorldSnapshot()
        .units.some((u) => u.kind === UnitKind.TradeShip && u.ownerId === 2 && u.cargoGold > 0),
    ).toBe(true);
    advance(e, 140);
    expect(e.getPlayer(2)!.gold).toBeGreaterThan(before);
  });
  it('snapshot di flotta e proiettili mantiene il replay', () => {
    const e = fixture(true);
    send(e, { kind: CommandKind.Build, tile: e.map.index(31, 10), building: BuildingKind.Port });
    send(e, { kind: CommandKind.Build, tile: e.map.index(64, 10), building: BuildingKind.Port }, 2);
    send(e, {
      kind: CommandKind.ProduceWarship,
      portId: building(e, BuildingKind.Port).id,
      patrolTile: e.map.index(47, 10),
    });
    send(
      e,
      {
        kind: CommandKind.ProduceWarship,
        portId: building(e, BuildingKind.Port, 2).id,
        patrolTile: e.map.index(49, 10),
      },
      2,
    );
    advance(e, 17);
    const restored = GameEngine.fromSnapshot(e.snapshot());
    for (let i = 0; i < 80; i++) {
      e.tick();
      restored.tick();
    }
    expect(restored.stateHash()).toBe(e.stateHash());
  });
});

it('nessuna rotta marittima: nessuna nave e nessun prelievo', () => {
  const e = fixture(true);
  for (let y = 0; y < e.map.height; y++) e.map.setTerrain(e.map.index(48, y), 3);
  const before = e.getPlayer(1)!.troops,
    cap = e.getPlayer(1)!.maxTroops;
  expect(
    send(e, { kind: CommandKind.Transport, targetTile: e.map.index(64, 20), allocationBps: 2000 }),
  ).toBe('NO_PATH');
  expect(e.getWorldSnapshot().units).toHaveLength(0);
  expect(e.getPlayer(1)!.troops).toBeGreaterThanOrEqual(before);
  expect(e.getPlayer(1)!.troops).toBeLessThanOrEqual(cap);
});

it('rifiuta snapshot con posizione navale incoerente', () => {
  const e = fixture(true);
  send(e, { kind: CommandKind.Build, tile: e.map.index(31, 10), building: BuildingKind.Port });
  send(e, {
    kind: CommandKind.ProduceWarship,
    portId: building(e, BuildingKind.Port).id,
    patrolTile: e.map.index(32, 10),
  });
  const snapshot = e.snapshot();
  expect(() =>
    GameEngine.fromSnapshot({
      ...snapshot,
      world: {
        ...snapshot.world,
        units: snapshot.world.units.map((u) => ({ ...u, xMilli: u.xMilli + 1000 })),
      },
    }),
  ).toThrow('position');
});
