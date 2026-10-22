import { describe, it, expect } from 'vitest';
import { BALANCE, BorderMask, CommandKind, TerrainType } from '@district/rts-shared';
import { GameEngine, GameMap, Mulberry32, growTroops } from '@district/rts-engine';
import { runReplay } from './replay';
function setup() {
  const map = new GameMap(32, 32);
  return new GameEngine({
    map,
    seed: 42,
    players: [
      { id: 1, name: 'Uno', spawnTile: map.index(3, 3) },
      { id: 2, name: 'Due', spawnTile: map.index(28, 28) },
    ],
  });
}
function attack(engine: GameEngine, overrides: Record<string, number> = {}) {
  return engine.enqueue({
    kind: CommandKind.Attack,
    playerId: 1,
    sequence: 1,
    executeTick: 1,
    targetTile: engine.map.index(5, 3),
    allocationBps: 5000,
    ...overrides,
  });
}
describe('PRNG deterministico', () => {
  it('stesso seed, stessi uint32 e ripresa stato', () => {
    const a = new Mulberry32(0),
      b = new Mulberry32(0);
    const values = Array.from({ length: 1000 }, () => a.nextUint32());
    expect(values).toEqual(Array.from({ length: 1000 }, () => b.nextUint32()));
    const saved = a.getState();
    const next = a.nextUint32();
    a.setState(saved);
    expect(a.nextUint32()).toBe(next);
    expect(new Mulberry32(1).nextUint32()).not.toBe(values[0]);
  });
  it('interi limitati e input non validi', () => {
    const rng = new Mulberry32(33);
    for (let i = 0; i < 10000; i++) {
      const value = rng.nextInt(7);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(7);
    }
    expect(() => rng.nextInt(0)).toThrow();
    expect(() => new Mulberry32(-1)).toThrow();
  });
});
describe('GameMap data-oriented', () => {
  it('typed array, coordinate e nessun wrap tra righe', () => {
    const map = new GameMap(5, 4);
    expect(map.ownerId).toBeInstanceOf(Uint16Array);
    expect(map.buildingId).toBeInstanceOf(Uint32Array);
    expect(map.neighbor(4, 1)).toBe(-1);
    expect(map.neighbor(5, 3)).toBe(-1);
    expect(map.index(4, 3)).toBe(19);
    expect(() => map.index(5, 0)).toThrow();
    expect(() => new GameMap(4096, 4096)).toThrow();
  });
  it('confini, contatori e centroide aggiornati localmente', () => {
    const map = new GameMap(7, 7);
    map.consumeDirtyTiles();
    const tile = map.index(3, 3);
    map.setOwner(tile, 1);
    expect(map.landSize(1)).toBe(1);
    expect(map.landSize(0)).toBe(48);
    expect(map.centroid(1)).toEqual([3, 3]);
    expect(map.isBorder[tile]).toBe(15);
    const dirty = map.consumeDirtyTiles();
    expect(dirty.length).toBeLessThanOrEqual(5);
    expect(dirty).toContain(tile);
    map.setOwner(tile + 1, 1);
    expect(map.isBorder[tile]! & BorderMask.East).toBe(0);
    expect(map.centroid(1)).toEqual([3.5, 3]);
  });
  it('indice frontiera senza duplicati dopo trasferimenti ripetuti', () => {
    const map = new GameMap(10, 10),
      rng = new Mulberry32(98);
    for (let i = 0; i < 500; i++) map.setOwner(rng.nextInt(100), rng.nextInt(4));
    for (let owner = 1; owner <= 3; owner++) {
      const expected = Array.from(map.ownerId, (_, i) => i).filter(
        (i) => map.ownerId[i] === owner && map.isBorder[i] !== 0,
      );
      expect([...map.borderTiles(owner)].sort((a, b) => a - b)).toEqual(expected);
      expect(map.landSize(owner)).toBe(
        expected.length +
          Array.from(map.ownerId, (_, i) => i).filter(
            (i) => map.ownerId[i] === owner && map.isBorder[i] === 0,
          ).length,
      );
    }
  });
  it('acqua non conquistabile e dirty senza duplicati', () => {
    const map = new GameMap(5, 5),
      i = 12;
    map.setOwner(i, 1);
    map.setDefenseCoverage(i, 2);
    map.setTerrain(i, TerrainType.DeepWater);
    expect(map.landSize(1)).toBe(0);
    expect(map.totalLandTiles).toBe(24);
    expect(map.defenseCoverage[i]).toBe(0);
    expect(() => map.setOwner(i, 1)).toThrow();
    map.setTerrain(i, TerrainType.Coast);
    expect(map.totalLandTiles).toBe(25);
    map.consumeDirtyTiles();
    map.setElevation(6, 10);
    map.setElevation(6, 11);
    expect([...map.consumeDirtyTiles()]).toEqual([6]);
  });
  it('snapshot non condivide buffer e ricalcola indici', () => {
    const a = new GameMap(8, 8);
    a.setOwner(20, 2);
    const data = a.snapshot();
    const b = new GameMap(data.width, data.height, data);
    b.setOwner(20, 1);
    expect(a.ownerId[20]).toBe(2);
    expect(b.landSize(2)).toBe(0);
    expect(b.landSize(1)).toBe(1);
  });
  it('rifiuta dati malformati e proprietà su acqua', () => {
    const map = new GameMap(4, 4),
      data = map.snapshot();
    data.terrainType[3] = TerrainType.DeepWater;
    data.ownerId[3] = 1;
    expect(() => new GameMap(4, 4, data)).toThrow();
    expect(() => new GameMap(5, 5, map.snapshot())).toThrow();
  });
});
describe('crescita logistica intera', () => {
  it('massima a metà cap, rallenta vicino al limite', () => {
    const cap = 1000000;
    expect(growTroops(500000, cap) - 500000).toBeGreaterThan(growTroops(10000, cap) - 10000);
    expect(growTroops(500000, cap) - 500000).toBeGreaterThan(growTroops(990000, cap) - 990000);
    expect(growTroops(cap, cap)).toBe(cap);
    expect(growTroops(0, cap)).toBe(1);
    expect(growTroops(100, 0)).toBe(0);
  });
  it('risorse grandi senza overflow né frazioni', () => {
    expect(Number.isSafeInteger(growTroops(499999999999, 1000000000000))).toBe(true);
    expect(() => growTroops(NaN, 5)).toThrow();
    const e = setup();
    expect(e.getPlayer(1)?.maxTroops).toBe(5 * BALANCE.baseTroopsPerTile);
    e.tick();
    expect(e.elapsedMs).toBe(100);
    expect(e.getPlayer(1)!.troops).toBeGreaterThan(20000);
  });
  it('cap città conta i livelli e nessuna crescita senza terra', () => {
    const map = new GameMap(20, 20);
    const e = new GameEngine({
      map,
      seed: 1,
      players: [
        { id: 1, name: 'A', spawnTile: 100, cityLevels: 2 },
        { id: 2, name: 'B' },
      ],
    });
    expect(e.getPlayer(1)?.maxTroops).toBe(e.getPlayer(1)!.landSize * 5000 + 500000);
    e.tick();
    expect(e.getPlayer(2)?.troops).toBe(0);
    expect(e.getPlayer(2)?.eliminated).toBe(true);
  });
});
describe('AttackExecution', () => {
  it('alloca truppe, espande e consuma costi senza crearne', () => {
    const e = setup();
    expect(attack(e)).toEqual({ accepted: true });
    const first = e.tick();
    expect(first.events.some((v) => v.kind === 'attackStarted')).toBe(true);
    let state = e.getAttacks()[0]!;
    expect(state.committed - state.troops).toBe(state.captured * 100);
    expect(state.captured).toBeGreaterThan(0);
    for (let i = 0; i < 100 && e.activeAttackCount; i++) e.tick();
    expect(e.activeAttackCount).toBe(0);
    expect(e.getPlayer(1)!.landSize).toBeGreaterThan(5);
  });
  it('solo adiacenti, niente target propri, acqua o attacchi alleati', () => {
    for (const [target, reason] of [
      [1000, 'NOT_ADJACENT'],
      [99, 'OWN_TERRITORY'],
    ] as const) {
      const e = setup();
      attack(e, { targetTile: target });
      expect(e.tick().events).toContainEqual({
        kind: 'commandRejected',
        playerId: 1,
        sequence: 1,
        reason,
      });
    }
    const e = setup();
    e.map.setTerrain(e.map.index(5, 3), TerrainType.DeepWater);
    attack(e);
    expect(e.tick().events).toContainEqual({
      kind: 'commandRejected',
      playerId: 1,
      sequence: 1,
      reason: 'INVALID_TILE',
    });
  });
  it('annullamento rimborsa solo l’attaccante proprietario', () => {
    const e = setup();
    attack(e);
    e.tick();
    const a = e.getAttacks()[0]!;
    e.enqueue({
      kind: CommandKind.CancelAttack,
      playerId: 2,
      sequence: 1,
      executeTick: 2,
      attackId: a.id,
    });
    expect(
      e.tick().events.some((v) => v.kind === 'commandRejected' && v.reason === 'UNKNOWN_ATTACK'),
    ).toBe(true);
    e.enqueue({
      kind: CommandKind.CancelAttack,
      playerId: 1,
      sequence: 2,
      executeTick: 3,
      attackId: a.id,
    });
    const result = e.tick();
    expect(e.activeAttackCount).toBe(0);
    expect(result.events.some((v) => v.kind === 'attackEnded' && v.refunded > 0)).toBe(true);
  });
  it('limita attacchi simultanei e importi insufficienti', () => {
    const e = setup();
    for (let i = 0; i < 5; i++) attack(e, { sequence: i + 1, allocationBps: 1000 });
    const result = e.tick();
    expect(e.activeAttackCount).toBe(4);
    expect(
      result.events.some((v) => v.kind === 'commandRejected' && v.reason === 'ATTACK_LIMIT'),
    ).toBe(true);
    const empty = new GameEngine({
      map: new GameMap(20, 20),
      seed: 1,
      players: [{ id: 1, name: 'A', spawnTile: 100, initialTroops: 0 }],
    });
    empty.enqueue({
      kind: CommandKind.Attack,
      playerId: 1,
      sequence: 0,
      executeTick: 1,
      targetTile: 102,
      allocationBps: 10000,
    });
    expect(
      empty
        .tick()
        .events.some((v) => v.kind === 'commandRejected' && v.reason === 'INSUFFICIENT_TROOPS'),
    ).toBe(true);
  });
  function front(protectedTiles: boolean, allied = false) {
    const map = new GameMap(30, 30);
    for (let y = 0; y < 30; y++)
      for (let x = 0; x < 20; x++) {
        map.setOwner(map.index(x, y), x < 10 ? 1 : 2);
        if (protectedTiles && x >= 10) map.setDefenseCoverage(map.index(x, y), 1);
      }
    return new GameEngine({
      map,
      seed: 1,
      players: [
        { id: 1, name: 'A', initialTroops: 1000000, ...(allied ? { alliances: [2] } : {}) },
        { id: 2, name: 'B', initialTroops: 0, ...(allied ? { alliances: [1] } : {}) },
      ],
    });
  }
  it('Defense Post: costo 5× e velocità 3× più lenta', () => {
    const a = front(false),
      b = front(true);
    expect(b.tileCost(460)).toBe(a.tileCost(460) * 5);
    for (const e of [a, b])
      e.enqueue({
        kind: CommandKind.Attack,
        playerId: 1,
        sequence: 1,
        executeTick: 1,
        targetTile: 460,
        allocationBps: 5000,
      });
    a.tick();
    b.tick();
    expect(a.getAttacks()[0]?.captured).toBe(12);
    expect(b.getAttacks()[0]?.captured).toBe(4);
  });
  it('alleanze reciproche impediscono attacchi', () => {
    const e = front(false, true);
    e.enqueue({
      kind: CommandKind.Attack,
      playerId: 1,
      sequence: 1,
      executeTick: 1,
      targetTile: 460,
      allocationBps: 5000,
    });
    expect(
      e.tick().events.some((v) => v.kind === 'commandRejected' && v.reason === 'ALLIED_TARGET'),
    ).toBe(true);
  });
  it('preferisce tile economici sul fronte', () => {
    const e = setup();
    const expensive = e.map.index(5, 3);
    e.map.setElevation(expensive, 255);
    attack(e);
    e.tick();
    expect(e.map.ownerId[expensive]).toBe(1);
    const a = e.getAttacks()[0]!;
    expect(a.committed - a.troops).toBe(a.captured * 100 + 100);
  });
});
describe('tick, validazione e determinismo', () => {
  it('rifiuta duplicati, passato e futuro remoto; accetta comandi edifici', () => {
    const e = setup();
    expect(attack(e).accepted).toBe(true);
    expect(attack(e)).toEqual({ accepted: false, reason: 'DUPLICATE_SEQUENCE' });
    expect(attack(e, { executeTick: 0, sequence: 2 })).toEqual({
      accepted: false,
      reason: 'STALE_TICK',
    });
    expect(attack(e, { executeTick: 100, sequence: 2 })).toEqual({
      accepted: false,
      reason: 'TICK_TOO_FAR',
    });
    expect(
      e.enqueue({
        kind: CommandKind.Build,
        playerId: 1,
        sequence: 2,
        executeTick: 1,
        tile: 99,
        building: 1,
      }),
    ).toEqual({ accepted: true });
  });
  it('isola stato letto e limiti della coda', () => {
    const e = setup();
    const player = e.getPlayer(1)!;
    (player.alliances as Set<number>).add(2);
    expect(e.getPlayer(1)?.alliances.has(2)).toBe(false);
    for (let i = 0; i < 64; i++)
      expect(attack(e, { sequence: i, executeTick: 10 }).accepted).toBe(true);
    expect(attack(e, { sequence: 65 })).toEqual({ accepted: false, reason: 'QUEUE_FULL' });
  });
  it('ordine canonico indipendente dall’arrivo fra giocatori', () => {
    const a = setup(),
      b = setup();
    const c1 = {
        kind: CommandKind.Attack as const,
        playerId: 1,
        sequence: 1,
        executeTick: 1,
        targetTile: 101,
        allocationBps: 5000,
      },
      c2 = { ...c1, playerId: 2, targetTile: 26 + 28 * 32 };
    a.enqueue(c1);
    a.enqueue(c2);
    b.enqueue(c2);
    b.enqueue(c1);
    for (let i = 0; i < 40; i++) {
      a.tick();
      b.tick();
      expect(a.stateHash()).toBe(b.stateHash());
    }
  });
  it('snapshot con attacchi e comandi futuri riproduce i tick successivi', () => {
    const a = setup();
    attack(a);
    a.tick();
    attack(a, { sequence: 2, executeTick: 10 });
    const b = GameEngine.fromSnapshot(a.snapshot());
    expect(b.stateHash()).toBe(a.stateHash());
    for (let i = 0; i < 30; i++) {
      a.tick();
      b.tick();
      expect(a.stateHash()).toBe(b.stateHash());
    }
  });
  it('replay lungo riproducibile e ripresa esatta', () => {
    const first = runReplay(),
      second = runReplay();
    expect(first).toEqual(second);
    expect(first.finalHash).toBe(first.resumedHash);
  });
  it('vittoria all’80% dei soli tile terrestri', () => {
    const map = new GameMap(10, 10);
    for (let i = 0; i < 20; i++) map.setTerrain(i, TerrainType.DeepWater);
    for (let i = 20; i < 84; i++) map.setOwner(i, 1);
    const e = new GameEngine({ map, seed: 1, players: [{ id: 1, name: 'A' }] });
    expect(e.tick().winnerId).toBe(1);
    expect(() => e.tick()).toThrow('finished');
  });
  it('configurazioni non valide non alterano gli spawn', () => {
    const map = new GameMap(10, 10);
    expect(
      () =>
        new GameEngine({
          map,
          seed: 1,
          players: [
            { id: 1, name: 'A', spawnTile: 44 },
            { id: 2, name: 'B', spawnTile: 44 },
          ],
        }),
    ).toThrow();
    expect(map.landSize(1)).toBe(0);
    expect(map.landSize(2)).toBe(0);
  });
  it('snapshot corrotti rifiutati', () => {
    const e = setup();
    attack(e);
    e.tick();
    const s = e.snapshot();
    expect(() => GameEngine.fromSnapshot({ ...s, version: 99 as 2 })).toThrow();
    expect(() =>
      GameEngine.fromSnapshot({ ...s, attacks: s.attacks.map((a) => ({ ...a, troops: -1 })) }),
    ).toThrow();
  });
});

it('snapshot non espone i comandi vivi della simulazione', () => {
  const engine = setup();
  attack(engine, { executeTick: 10 });
  const before = engine.stateHash(),
    snapshot = engine.snapshot();
  const command = snapshot.commands[0];
  if (command?.kind === CommandKind.Attack) command.targetTile = 0;
  expect(engine.stateHash()).toBe(before);
});

it('configurare bot inesistenti non altera la mappa di spawn', () => {
  const map = new GameMap(10, 10);
  expect(
    () =>
      new GameEngine({ map, seed: 1, players: [{ id: 1, name: 'A', spawnTile: 44 }], bots: [2] }),
  ).toThrow('bot');
  expect(map.landSize(1)).toBe(0);
});
