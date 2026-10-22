import { WorldBuilder } from './bvh.js';
import { JumpPads } from './kinematics.js';
import { Vec3, RayHit } from './math.js';
export const ARENA_NAMES = ['nexus', 'sandstorm', 'bastion', 'cedar', 'depot'] as const;
export type ArenaName = (typeof ARENA_NAMES)[number];
export const ARENA_LABELS: Record<ArenaName, string> = {
  depot: 'Depot · magazzini industriali',
  nexus: 'Nexus · laboratorio alpino',
  sandstorm: 'Sandstorm · avamposto desertico',
  bastion: 'Bastione · costa mediterranea',
  cedar: 'Cedar · quartiere tattico',
};
export type GameMode = 'ffa' | 'tdm' | 'ctf' | 'hardpoint';
export const MAX_FPS_PLAYERS = 12;
export interface Arena {
  name: ArenaName;
  surfaces: Float64Array;
  spawns: Float64Array;
  waypoints: Float64Array;
  hardpoints: Float64Array;
  flags: Float64Array;
  world: ReturnType<WorldBuilder['build']>;
  pads: JumpPads;
}
/** Every visible solid and ramp is authored once for both collision and rendering. */
export function createArena(name: ArenaName): Arena {
  if (!ARENA_NAMES.includes(name)) throw new RangeError('Unknown arena');
  const data: number[] = [],
    geometry = new WorldBuilder();
  function box(x: number, y: number, z: number, X: number, Y: number, Z: number, material = 0) {
    data.push(x, y, z, X, Y, Z, 0, material);
    geometry.box(x, y, z, X, Y, Z);
  }
  function ramp(
    x: number,
    z: number,
    X: number,
    Z: number,
    lo: number,
    hi: number,
    reverse = false,
  ) {
    data.push(x, lo, z, X, hi, Z, reverse ? 2 : 1, 0);
    if (reverse) geometry.quad(x, hi, z, x, lo, Z, X, lo, Z, X, hi, z);
    else geometry.ramp(x, z, X, Z, lo, hi);
  }
  const town = name === 'bastion' || name === 'cedar';
  if (name === 'depot') {
    box(-43, -1, -33, 43, 0, 33, 13);
    box(-44, 0, -34, -42, 8, 34, 0);
    box(42, 0, -34, 44, 8, 34, 0);
    box(-44, 0, -34, 44, 8, -32, 0);
    box(-44, 0, 32, 44, 8, 34, 0);
    for (const side of [-1, 1]) {
      const x = side < 0 ? -38 : 16,
        X = side < 0 ? -16 : 38;
      box(x, 0, -16, X, 6.5, -15.6, 4);
      box(x, 0, 15.6, X, 6.5, 16, 4);
      const outside = side < 0 ? x : X - 0.4;
      box(outside, 0, -16, outside + 0.4, 6.5, 16, 4);
      const inside = side < 0 ? X - 0.4 : x;
      for (const z of [-16, -3, 10]) box(inside, 0, z, inside + 0.4, 6.5, z + 6, 4);
      box(x, 6.5, -16, X, 6.75, 16, 0);
      box(x, 3.05, -15.6, X, 3.2, -6, 2);
      ramp(side < 0 ? -38 : 35, -29, side < 0 ? -35 : 38, -6, 0, 3.2);
      box(x + 3, 0, 5, x + 7, 1.1, 9, 11);
      box(x + 10, 0, -13, x + 14, 1.4, -9, 11);
    }
    box(-16, 3.05, -8, 16, 3.2, -5, 2);
    box(-5, 0, -1.5, 5, 2.6, 2, 3);
    box(-10, 0, 10, -6, 1.25, 16, 5);
    box(6, 0, 10, 10, 1.25, 16, 5);
    box(-4, 0, -22, 4, 1.1, -18, 11);
  } else if (town) {
    box(-43, -1, -33, 43, 0, 33, 1);
    box(-43, 0, -33, -42.5, 3, 33, 8);
    box(42.5, 0, -33, 43, 3, 33, 8);
    box(-43, 0, -33, 43, 3, -32.5, 8);
    box(-43, 0, 32.5, 43, 3, 33, 8);
    function house(cx: number, material: number) {
      const x = cx - 7,
        X = cx + 7,
        z = -8,
        Z = 8;
      box(x, 0, z, X, 0.12, Z, 7);
      box(x, 3.05, z, X, 3.2, Z, 11);
      for (const level of [0, 3.2]) {
        for (const wall of [z, Z - 0.3]) {
          box(x, level, wall, cx - 1.25, level + 1.1, wall + 0.3, material);
          box(cx + 1.25, level, wall, X, level + 1.1, wall + 0.3, material);
          box(x, level + 1.1, wall, x + 1.2, level + 2.4, wall + 0.3, material);
          box(cx - 2.6, level + 1.1, wall, cx - 1.25, level + 2.4, wall + 0.3, material);
          box(cx + 1.25, level + 1.1, wall, cx + 2.6, level + 2.4, wall + 0.3, material);
          box(X - 1.2, level + 1.1, wall, X, level + 2.4, wall + 0.3, material);
          box(x, level + 2.4, wall, X, level + 3.05, wall + 0.3, material);
        }
        box(x, level, z, x + 0.3, level + 3.05, Z, material);
        box(X - 0.3, level, z, X, level + 3.05, Z, material);
      }
      box(x, 3.05, 8, X, 3.2, 11, 11);
      const stairX = cx < 0 ? x - 3 : X;
      ramp(stairX, -10, stairX + 3, 9, 0, 3.2);
      box(stairX, 3.05, 9, stairX + 3, 3.2, 11, 11);
      if (name === 'cedar') {
        ramp(x - 0.4, -8.5, X + 0.4, 0, 6.25, 8);
        ramp(x - 0.4, 0, X + 0.4, 8.5, 6.25, 8, true);
      } else {
        box(x - 0.35, 6.25, -8.35, X + 0.35, 6.45, 8.35, 6);
        box(x, 6.45, z, x + 0.25, 7, Z, 4);
        box(X - 0.25, 6.45, z, X, 7, Z, 4);
      }
    }
    house(-24, name === 'cedar' ? 5 : 4);
    house(24, name === 'cedar' ? 10 : 4);
    if (name === 'cedar') {
      box(-6, 0.001, -32, 6, 0.018, 32, 13);
      box(-2.6, 0, -4, 2.6, 2.65, 5, 9);
      box(-1.2, 0, -20, 1.2, 1.3, -15, 10);
      for (const side of [-1, 1]) {
        box(side < 0 ? -17 : 10, 0, 17, side < 0 ? -10 : 17, 0.8, 21, 7);
        box(side < 0 ? -40 : 36, 0, -14, side < 0 ? -36 : 40, 1.3, -10, 11);
      }
    } else {
      box(-10, 3.15, -2, 10, 3.45, 2, 7);
      ramp(-10, -15, -6, -2, 0, 3.45);
      ramp(6, 2, 10, 15, 0, 3.45, true);
      box(-1.8, 0, -12, 1.8, 1.1, -8.4, 7);
      for (const side of [-1, 1])
        for (const z of [-19, 17]) {
          const x = side * 12;
          box(x - 2, 0, z - 1, x + 2, 1.1, z + 1, 11);
          box(x - 2.3, 2.5, z - 1.5, x + 2.3, 2.6, z + 1.5, 6);
        }
    }
  } else {
    if (name === 'nexus') box(-43, -1, -33, 43, 0, 33, 1);
    else {
      box(-43, -1, -33, -5, 0, 33, 1);
      box(5, -1, -33, 43, 0, 33, 1);
      box(-5, -1, -33, 5, 0, -22, 1);
      box(-5, -1, 22, 5, 0, 33, 1);
      box(-5, -4, -22, 5, -3, 22, 1);
      ramp(-5, 12, 5, 22, -3, 0);
      ramp(-5, -22, 5, -12, -3, 0, true);
      box(-5, -1.6, -8, 5, 0.8, 8, 3);
    }
    box(-44, 0, -34, -42, 8, 34, 2);
    box(42, 0, -34, 44, 8, 34, 2);
    box(-44, 0, -34, 44, 8, -32, 2);
    box(-44, 0, 32, 44, 8, 34, 2);
    for (const side of [-1, 1]) {
      for (const z of [-15, 8]) {
        const x = side * 23;
        box(x - 2, 0, z - 2, x + 2, 1.05, z + 2, name === 'nexus' ? 0 : 3);
        box(x + side * 5 - 1, 0, z + 5, x + side * 5 + 1, 2.4, z + 7, 2);
      }
      box(side < 0 ? -15 : 12, 0, -10, side < 0 ? -12 : 15, 4, -2, 0);
      box(side < 0 ? -15 : 12, 0, 2, side < 0 ? -12 : 15, 4, 10, 0);
      const x = side < 0 ? -35 : 29;
      ramp(x, -9, x + 6, 9, 0, 3.6);
      box(x, 3.25, 9, x + 6, 3.6, 15, 1);
    }
    if (name === 'nexus') {
      box(-12, 3.25, -2, 12, 3.6, 2, 1);
      ramp(-12, -15, -6, -2, 0, 3.6);
      ramp(6, 2, 12, 15, 0, 3.6, true);
      box(-2, 0, -17, 2, 1.1, -14, 2);
      box(-2, 0, 14, 2, 1.1, 17, 2);
    } else {
      box(-27, 0, -3, -19, 2.4, 1, 3);
      box(19, 0, -1, 27, 2.4, 3, 3);
    }
    // Radar towers use the same sixteen-sided frustum as the visual mesh.
    for (const side of [-1, 1])
      for (const z of [-28, 28])
        for (let n = 0; n < 16; n++) {
          const a = (n * Math.PI) / 8,
            b = ((n + 1) * Math.PI) / 8,
            cx = side * 39;
          geometry.quad(
            cx + Math.sin(a) * 2.2,
            0,
            z + Math.cos(a) * 2.2,
            cx + Math.sin(a) * 1.5,
            7,
            z + Math.cos(a) * 1.5,
            cx + Math.sin(b) * 1.5,
            7,
            z + Math.cos(b) * 1.5,
            cx + Math.sin(b) * 2.2,
            0,
            z + Math.cos(b) * 2.2,
          );
          geometry.triangle(
            cx,
            7,
            z,
            cx + Math.sin(a) * 1.5,
            7,
            z + Math.cos(a) * 1.5,
            cx + Math.sin(b) * 1.5,
            7,
            z + Math.cos(b) * 1.5,
          );
        }
  }
  const spawns: number[] = [];
  for (const z of [-27, 27])
    for (const x of town ? [-36, -8, 8, 36] : [-31, -12, 12, 31]) spawns.push(x, 0.01, z);
  const waypoints: number[] = [];
  for (const z of [-26, -19, -8, 0, 8, 19, 26])
    for (const x of [-36, -24, -8, 0, 8, 24, 36]) {
      if (name === 'sandstorm' && x === 0 && Math.abs(z) < 19) waypoints.push(x, -2.99, z);
      else waypoints.push(x, 0.01, z);
    }
  const pads = new JumpPads(
    town || name === 'depot'
      ? []
      : [-38, -0.05, -22, -34, 0.3, -18, 0, 14, 14, 34, -0.05, 18, 38, 0.3, 22, 0, 14, -14],
  );
  return {
    name,
    surfaces: new Float64Array(data),
    spawns: new Float64Array(spawns),
    waypoints: new Float64Array(waypoints),
    hardpoints: new Float64Array(
      name === 'cedar'
        ? [-24, 3.2, 0, 24, 3.2, 0, 0, 0, 12]
        : [-24, 0, 0, 24, 0, 0, 0, name === 'sandstorm' ? -3 : 0, 18],
    ),
    flags: new Float64Array([0, 0.01, 27, 0, 0.01, -27]),
    world: geometry.build(),
    pads,
  };
}
export class SpawnSelector {
  private eye = new Vec3();
  private direction = new Vec3();
  private hit = new RayHit();
  choose(
    out: Vec3,
    arena: Arena,
    positions: Float64Array,
    alive: Uint8Array,
    teams: Uint8Array,
    team: number,
    teamMode: boolean,
    random: number,
  ): Vec3 {
    let best = -Infinity,
      bestIndex = 0;
    const count = arena.spawns.length / 3,
      start = (random >>> 0) % count;
    for (let n = 0; n < count; n++) {
      const index = (start + n) % count,
        o = index * 3,
        x = arena.spawns[o]!,
        y = arena.spawns[o + 1]!,
        z = arena.spawns[o + 2]!;
      if (teamMode && ((team === 0 && z < 0) || (team === 1 && z > 0))) continue;
      out.set(x, y, z);
      if (!arena.world.fits(out, 1.8, 0.32)) continue;
      let score = 0,
        nearest = 10000;
      for (let p = 0; p < alive.length; p++) {
        if (!alive[p] || (teamMode && teams[p] === team)) continue;
        const j = p * 3,
          dx = positions[j]! - x,
          dy = positions[j + 1]! + 1.6 - y - 1.6,
          dz = positions[j + 2]! - z,
          d = Math.hypot(dx, dy, dz);
        nearest = Math.min(nearest, d);
        this.eye.set(x, y + 1.6, z);
        this.direction.set(dx, dy, dz).normalize();
        if (d < 70 && !arena.world.raycast(this.hit, this.eye, this.direction, d - 0.2))
          score -= 200;
      }
      score += nearest;
      if (score > best) {
        best = score;
        bestIndex = index;
      }
    }
    const index = bestIndex * 3;
    return out.set(arena.spawns[index]!, arena.spawns[index + 1]!, arena.spawns[index + 2]!);
  }
}
