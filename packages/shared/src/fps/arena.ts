import { WorldBuilder } from './bvh.js';
import { JumpPads } from './kinematics.js';
import { Vec3, RayHit } from './math.js';
export type ArenaName = 'nexus' | 'sandstorm';
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
  if (name !== 'nexus' && name !== 'sandstorm') throw new RangeError('Unknown arena');
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
  const spawns: number[] = [];
  for (const z of [-27, 27]) for (const x of [-31, -12, 12, 31]) spawns.push(x, 0.01, z);
  const waypoints: number[] = [];
  for (const z of [-26, -19, -8, 0, 8, 19, 26])
    for (const x of [-36, -24, -8, 0, 8, 24, 36]) {
      if (name === 'sandstorm' && x === 0 && Math.abs(z) < 19) waypoints.push(x, -2.99, z);
      else waypoints.push(x, 0.01, z);
    }
  const pads = new JumpPads([
    -38, -0.05, -22, -34, 0.3, -18, 0, 14, 14, 34, -0.05, 18, 38, 0.3, 22, 0, 14, -14,
  ]);
  return {
    name,
    surfaces: new Float64Array(data),
    spawns: new Float64Array(spawns),
    waypoints: new Float64Array(waypoints),
    hardpoints: new Float64Array([-24, 0, 0, 24, 0, 0, 0, name === 'sandstorm' ? -3 : 0, 18]),
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
