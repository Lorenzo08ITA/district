import { describe, it, expect } from 'vitest';
import { GameMap, Pathfinder } from '@district/rts-engine';
import { TerrainType } from '@district/rts-shared';
describe('A* e smoothing', () => {
  it('trova il percorso minimo senza attraversare acqua', () => {
    const map = new GameMap(16, 16);
    for (let y = 0; y < 15; y++) map.setTerrain(map.index(7, y), TerrainType.DeepWater);
    const pf = new Pathfinder(map),
      r = pf.find(map.index(2, 2), map.index(12, 2), { mode: 'land' });
    expect(r.status).toBe('found');
    expect(r.path.every((t) => map.isLand(t))).toBe(true);
    expect(r.path).toContain(map.index(7, 15));
    for (let i = 1; i < r.path.length; i++)
      expect([0, 1, 2, 3].some((d) => map.neighbor(r.path[i - 1]!, d) === r.path[i])).toBe(true);
  });
  it('budget esplicito, nodi vietati e riuso dei buffer', () => {
    const map = new GameMap(20, 20),
      pf = new Pathfinder(map);
    expect(pf.find(0, 399, { mode: 'land', maxNodes: 1 }).status).toBe('budget-exceeded');
    expect(pf.find(0, 399, { mode: 'land' }).status).toBe('found');
    expect(pf.find(0, 399, { mode: 'water' }).status).toBe('unreachable');
    expect(pf.find(5, 5, { mode: 'land' }).path).toEqual(new Uint32Array([5]));
    expect(pf.find(0, 399, { mode: 'land', allowed: (t) => t < 200 }).status).toBe('unreachable');
  });
  it('non taglia angoli terrestri fra caselle acqua diagonali', () => {
    const map = new GameMap(8, 8);
    for (let i = 0; i < 64; i++) map.setTerrain(i, TerrainType.DeepWater);
    map.setTerrain(map.index(3, 2), TerrainType.Plains);
    map.setTerrain(map.index(2, 3), TerrainType.Plains);
    const pf = new Pathfinder(map);
    expect(pf.lineOfSight(map.index(2, 2), map.index(3, 3), { mode: 'water' })).toBe(false);
    const r = pf.find(map.index(1, 1), map.index(6, 6), { mode: 'water', smooth: true });
    expect(r.status).toBe('found');
    for (let i = 1; i < r.path.length; i++)
      expect(pf.lineOfSight(r.path[i - 1]!, r.path[i]!, { mode: 'water' })).toBe(true);
  });
  it('riduce una rotta in mare aperto ai soli estremi', () => {
    const map = new GameMap(30, 30);
    for (let i = 0; i < 900; i++) map.setTerrain(i, TerrainType.DeepWater);
    const pf = new Pathfinder(map),
      r = pf.find(0, 899, { mode: 'water', smooth: true });
    expect(r.path).toEqual(new Uint32Array([0, 899]));
  });
  it('preferisce dislivelli meno costosi', () => {
    const map = new GameMap(12, 3);
    for (let x = 1; x < 11; x++) map.setElevation(map.index(x, 1), 255);
    const pf = new Pathfinder(map),
      r = pf.find(map.index(0, 1), map.index(11, 1), { mode: 'land' });
    expect(r.path.some((t) => Math.floor(t / map.width) !== 1)).toBe(true);
  });
});
