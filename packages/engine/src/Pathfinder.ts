import type { GameMap } from './GameMap.js';
export type PathMode = 'land' | 'water';
export interface PathOptions {
  readonly mode: PathMode;
  readonly allowed?: (tile: number) => boolean;
  readonly maxNodes?: number;
  readonly smooth?: boolean;
}
export interface PathResult {
  readonly status: 'found' | 'unreachable' | 'budget-exceeded';
  readonly path: Uint32Array;
  readonly expanded: number;
}
/** Reusable stamped buffers: no per-tile objects, no full-map clearing per search. */
export class Pathfinder {
  private readonly parent: Int32Array;
  private readonly cost: Uint32Array;
  private readonly stamp: Uint32Array;
  private readonly position: Int32Array;
  private heap = new Uint32Array(128);
  private size = 0;
  private generation = 0;
  private target = 0;
  constructor(readonly map: GameMap) {
    this.parent = new Int32Array(map.length);
    this.cost = new Uint32Array(map.length);
    this.stamp = new Uint32Array(map.length);
    this.position = new Int32Array(map.length);
  }
  passable(tile: number, options: PathOptions): boolean {
    return (
      tile >= 0 &&
      tile < this.map.length &&
      (options.mode === 'land' ? this.map.isLand(tile) : !this.map.isLand(tile)) &&
      (!options.allowed || options.allowed(tile))
    );
  }
  find(start: number, target: number, options: PathOptions): PathResult {
    this.map.assertTile(start);
    this.map.assertTile(target);
    const maxNodes = options.maxNodes ?? 200_000;
    if (!Number.isSafeInteger(maxNodes) || maxNodes < 1)
      throw new RangeError('Invalid path budget');
    if (!this.passable(start, options) || !this.passable(target, options))
      return { status: 'unreachable', path: new Uint32Array(), expanded: 0 };
    if (++this.generation === 0xffff_ffff) {
      this.stamp.fill(0);
      this.generation = 1;
    }
    this.target = target;
    this.size = 0;
    this.visit(start, -1, 0);
    let expanded = 0;
    while (this.size) {
      if (expanded >= maxNodes)
        return { status: 'budget-exceeded', path: new Uint32Array(), expanded };
      const tile = this.pop();
      expanded++;
      if (tile === target) {
        let count = 1;
        for (let t = target; t !== start; t = this.parent[t]!) count++;
        const path = new Uint32Array(count);
        let t = target;
        for (let i = count - 1; i >= 0; i--) {
          path[i] = t;
          t = this.parent[t]!;
        }
        return {
          status: 'found',
          path: options.smooth ? this.smooth(path, options) : path,
          expanded,
        };
      }
      for (let direction = 0; direction < 4; direction++) {
        const n = this.map.neighbor(tile, direction);
        if (!this.passable(n, options)) continue;
        const cost =
          this.cost[tile]! +
          10 +
          (options.mode === 'land' ? Math.floor(this.map.elevation[n]! / 32) : 0);
        if (this.stamp[n] !== this.generation) this.visit(n, tile, cost);
        else if (this.position[n]! >= 0 && cost < this.cost[n]!) {
          this.cost[n] = cost;
          this.parent[n] = tile;
          this.up(this.position[n]!);
        }
      }
    }
    return { status: 'unreachable', path: new Uint32Array(), expanded };
  }
  /** Supercover with corner checks prevents smoothing through narrow land diagonals. */
  lineOfSight(start: number, end: number, options: PathOptions): boolean {
    this.map.assertTile(start);
    this.map.assertTile(end);
    let x = start % this.map.width,
      y = Math.floor(start / this.map.width);
    const tx = end % this.map.width,
      ty = Math.floor(end / this.map.width);
    const dx = Math.abs(tx - x),
      dy = Math.abs(ty - y),
      sx = Math.sign(tx - x),
      sy = Math.sign(ty - y);
    let ix = 0,
      iy = 0;
    if (!this.passable(start, options)) return false;
    while (ix < dx || iy < dy) {
      const a = (1 + 2 * ix) * dy,
        b = (1 + 2 * iy) * dx;
      if (a === b) {
        if (
          !this.passable(y * this.map.width + x + sx, options) ||
          !this.passable((y + sy) * this.map.width + x, options)
        )
          return false;
        x += sx;
        y += sy;
        ix++;
        iy++;
      } else if (a < b) {
        x += sx;
        ix++;
      } else {
        y += sy;
        iy++;
      }
      if (!this.passable(y * this.map.width + x, options)) return false;
    }
    return true;
  }
  private smooth(path: Uint32Array, options: PathOptions): Uint32Array {
    if (path.length < 3) return path;
    const result: number[] = [path[0]!];
    let anchor = 0;
    while (anchor < path.length - 1) {
      let furthest = path.length - 1;
      while (furthest > anchor + 1 && !this.lineOfSight(path[anchor]!, path[furthest]!, options))
        furthest = Math.floor((anchor + furthest) / 2);
      result.push(path[furthest]!);
      anchor = furthest;
    }
    return Uint32Array.from(result);
  }
  private score(tile: number): number {
    return (
      this.cost[tile]! +
      (Math.abs((tile % this.map.width) - (this.target % this.map.width)) +
        Math.abs(Math.floor(tile / this.map.width) - Math.floor(this.target / this.map.width))) *
        10
    );
  }
  private before(a: number, b: number): boolean {
    const sa = this.score(a),
      sb = this.score(b);
    return (
      sa < sb ||
      (sa === sb && (this.cost[a]! > this.cost[b]! || (this.cost[a] === this.cost[b] && a < b)))
    );
  }
  private visit(tile: number, parent: number, cost: number): void {
    this.stamp[tile] = this.generation;
    this.parent[tile] = parent;
    this.cost[tile] = cost;
    if (this.size === this.heap.length) {
      const next = new Uint32Array(this.heap.length * 2);
      next.set(this.heap);
      this.heap = next;
    }
    this.heap[this.size] = tile;
    this.position[tile] = this.size;
    this.up(this.size++);
  }
  private swap(a: number, b: number): void {
    const tile = this.heap[a]!;
    this.heap[a] = this.heap[b]!;
    this.heap[b] = tile;
    this.position[this.heap[a]!] = a;
    this.position[tile] = b;
  }
  private up(index: number): void {
    while (index > 0) {
      const p = (index - 1) >>> 1;
      if (!this.before(this.heap[index]!, this.heap[p]!)) break;
      this.swap(index, p);
      index = p;
    }
  }
  private pop(): number {
    const tile = this.heap[0]!;
    this.position[tile] = -2;
    this.size--;
    if (this.size) {
      this.heap[0] = this.heap[this.size]!;
      this.position[this.heap[0]!] = 0;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        if (left >= this.size) break;
        const right = left + 1,
          child =
            right < this.size && this.before(this.heap[right]!, this.heap[left]!) ? right : left;
        if (!this.before(this.heap[child]!, this.heap[i]!)) break;
        this.swap(i, child);
        i = child;
      }
    }
    return tile;
  }
}
export function integerSqrt(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Invalid squared distance');
  let low = 0,
    high = Math.min(value, 100_000_000) + 1;
  while (low + 1 < high) {
    const mid = Math.floor((low + high) / 2);
    if (mid * mid <= value) low = mid;
    else high = mid;
  }
  return low;
}
export function distanceMilli(width: number, a: number, b: number): number {
  const dx = (a % width) - (b % width),
    dy = Math.floor(a / width) - Math.floor(b / width);
  return integerSqrt((dx * dx + dy * dy) * 1_000_000);
}
