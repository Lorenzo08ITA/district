export type Input = {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  fire: boolean;
  target?: number;
  score?: number;
  px?: number;
  pz?: number;
  size?: number;
};
export type Actor = {
  id: string;
  name: string;
  x: number;
  z: number;
  yaw: number;
  hp: number;
  score: number;
  kills: number;
  deaths: number;
  cooldown: number;
  size: number;
  input: Input;
};
export const walls = [
  { x: 0, z: 0, w: 5, d: 3 },
  { x: -9, z: 6, w: 3, d: 7 },
  { x: 9, z: -6, w: 3, d: 7 },
  { x: 8, z: 10, w: 6, d: 2 },
  { x: -8, z: -10, w: 6, d: 2 },
];
export const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
export const blocked = (x: number, z: number, r = 0.5) =>
  Math.abs(x) > 19 - r ||
  Math.abs(z) > 19 - r ||
  walls.some((w) => Math.abs(x - w.x) < w.w / 2 + r && Math.abs(z - w.z) < w.d / 2 + r);
export function createActor(id: string, name: string, index: number): Actor {
  return {
    id,
    name,
    x: index % 2 ? -15 : 15,
    z: ((index % 5) - 2) * 6,
    yaw: 0,
    hp: 100,
    score: 0,
    kills: 0,
    deaths: 0,
    cooldown: 0,
    size: 10,
    input: { x: 0, z: 0, yaw: 0, pitch: 0, fire: false },
  };
}
export function rayBlocked(x: number, z: number, dx: number, dz: number, distance: number) {
  for (let t = 0; t < distance; t += 0.2) if (blocked(x + dx * t, z + dz * t, 0)) return true;
  return false;
}
export function stepShooter(actors: Actor[], dt: number) {
  for (const p of actors) {
    p.cooldown = Math.max(0, p.cooldown - dt);
    p.yaw = p.input.yaw;
    const length = Math.max(1, Math.hypot(p.input.x, p.input.z));
    const dx = ((Math.cos(p.yaw) * p.input.x - Math.sin(p.yaw) * p.input.z) / length) * 7 * dt;
    const dz = ((-Math.sin(p.yaw) * p.input.x - Math.cos(p.yaw) * p.input.z) / length) * 7 * dt;
    if (!blocked(p.x + dx, p.z)) p.x += dx;
    if (!blocked(p.x, p.z + dz)) p.z += dz;
    if (p.input.fire && p.cooldown === 0) {
      p.cooldown = 0.18;
      const sx = -Math.sin(p.yaw),
        sz = -Math.cos(p.yaw);
      let hit: Actor | undefined;
      let nearest = 40;
      for (const q of actors) {
        if (q === p) continue;
        const vx = q.x - p.x,
          vz = q.z - p.z;
        const t = vx * sx + vz * sz;
        const side = Math.abs(vx * sz - vz * sx);
        if (
          t > 0 &&
          t < nearest &&
          side < 0.65 &&
          Math.abs(Math.tan(p.input.pitch) * t) < 1.2 &&
          !rayBlocked(p.x, p.z, sx, sz, t)
        ) {
          nearest = t;
          hit = q;
        }
      }
      if (hit) {
        hit.hp -= 25;
        if (hit.hp <= 0) {
          p.kills++;
          p.score += 100;
          hit.deaths++;
          hit.hp = 100;
          hit.x = hit.deaths % 2 ? 15 : -15;
          hit.z = ((hit.deaths % 5) - 2) * 6;
        }
      }
    }
  }
}
export const GRID = 24;
export type Territory = {
  owners: number[];
  armies: number[];
  capitals: number[];
  alive: boolean[];
  tick: number;
};
export function createTerritory(count: number): Territory {
  const capitals = [25, 550, 46, 529, 277, 298, 133, 442].slice(0, count);
  const owners = Array(576).fill(-1),
    armies = Array(576).fill(0);
  for (let i = 0; i < 576; i++) if ((i * 73) % 101 < 12) owners[i] = -2;
  capitals.forEach((p, i) => {
    owners[p] = i;
    armies[p] = 24;
  });
  return { owners, armies, capitals, alive: capitals.map(() => true), tick: 0 };
}
export function neighbors(i: number) {
  return [i % 24 > 0 ? i - 1 : -1, i % 24 < 23 ? i + 1 : -1, i - 24, i + 24].filter(
    (v) => v >= 0 && v < 576,
  );
}
export function conquer(s: Territory, player: number, target: number) {
  if (!s.alive[player] || s.owners[target] === -2 || s.owners[target] === player) return false;
  const source = neighbors(target)
    .filter((i) => s.owners[i] === player)
    .sort((a, b) => s.armies[b] - s.armies[a])[0];
  if (source === undefined || s.armies[source] < 3) return false;
  const troops = Math.floor(s.armies[source] * 0.6);
  s.armies[source] -= troops;
  if (troops > s.armies[target]) {
    const defender = s.owners[target];
    s.owners[target] = player;
    s.armies[target] = troops - s.armies[target];
    if (defender >= 0 && s.capitals[defender] === target) {
      s.alive[defender] = false;
      s.owners.forEach((o, i) => {
        if (o === defender) {
          s.owners[i] = player;
          s.armies[i] = Math.max(1, s.armies[i]);
        }
      });
    }
  } else s.armies[target] -= troops;
  return true;
}
export function stepTerritory(s: Territory) {
  s.tick++;
  if (s.tick % 15 === 0)
    s.owners.forEach((o, i) => {
      if (o >= 0) s.armies[i] = Math.min(999, s.armies[i] + (s.capitals[o] === i ? 4 : 1));
    });
}
export function botTerritory(s: Territory, player: number) {
  const targets = s.owners
    .map((o, i) =>
      o !== player && o !== -2 && neighbors(i).some((n) => s.owners[n] === player) ? i : -1,
    )
    .filter((i) => i >= 0);
  targets.sort((a, b) => s.armies[a] - s.armies[b]);
  for (const t of targets) if (conquer(s, player, t)) break;
}
