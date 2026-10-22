import { BALANCE } from '@district/rts-shared';
import type { GameMap } from './GameMap.js';
import type { MutablePlayer } from './state.js';
export interface AttackSnapshot {
  readonly id: number;
  readonly attackerId: number;
  readonly targetOwnerId: number;
  readonly targetTile: number;
  readonly troops: number;
  readonly committed: number;
  readonly captured: number;
  readonly createdTick: number;
  readonly frontier: Uint32Array;
}
export interface AttackHost {
  readonly map: GameMap;
  readonly currentTick: number;
  player(id: number): MutablePlayer | undefined;
  tileCost(index: number): number;
  capture(index: number, attackerId: number): void;
}
/** Frontier membership stores tile indices only, never tile objects. */
export class AttackExecution {
  private readonly frontier = new Set<number>();
  private tiles = new Uint32Array(16);
  private costs = new Float64Array(16);
  private distances = new Float64Array(16);
  private heapSize = 0;
  troops: number;
  captured = 0;
  constructor(
    readonly id: number,
    readonly attackerId: number,
    readonly targetOwnerId: number,
    readonly targetTile: number,
    readonly committed: number,
    readonly createdTick: number,
  ) {
    this.troops = committed;
  }
  seed(map: GameMap): void {
    for (const tile of map.borderTiles(this.attackerId)) this.addNeighbors(map, tile);
  }
  addNeighbors(map: GameMap, tile: number): void {
    for (let direction = 0; direction < 4; direction++) {
      const candidate = map.neighbor(tile, direction);
      if (candidate >= 0 && map.ownerId[candidate] === this.targetOwnerId && map.isLand(candidate))
        this.frontier.add(candidate);
    }
  }
  step(host: AttackHost): boolean {
    const player = host.player(this.attackerId);
    if (!player || player.eliminated || player.alliances.has(this.targetOwnerId)) return true;
    this.rebuild(host);
    let work = BALANCE.attackWorkPerTick;
    while (this.heapSize > 0) {
      const tile = this.tiles[0]!;
      if (!this.candidate(host, tile)) {
        this.pop();
        this.frontier.delete(tile);
        continue;
      }
      const protectedTile = this.targetOwnerId !== 0 && host.map.defenseCoverage[tile]! > 0;
      const workCost = protectedTile ? BALANCE.defenseWorkMultiplier : 1;
      if (work < workCost) break;
      const cost = host.tileCost(tile);
      if (cost > this.troops) return true;
      this.pop();
      this.frontier.delete(tile);
      this.troops -= cost;
      work -= workCost;
      host.capture(tile, this.attackerId);
      this.captured++;
    }
    return this.frontier.size === 0 || this.troops === 0;
  }
  snapshot(): AttackSnapshot {
    return {
      id: this.id,
      attackerId: this.attackerId,
      targetOwnerId: this.targetOwnerId,
      targetTile: this.targetTile,
      troops: this.troops,
      committed: this.committed,
      captured: this.captured,
      createdTick: this.createdTick,
      frontier: Uint32Array.from(this.frontier).sort(),
    };
  }
  restore(state: AttackSnapshot): void {
    this.troops = state.troops;
    this.captured = state.captured;
    for (const tile of state.frontier) this.frontier.add(tile);
  }
  private candidate(host: AttackHost, tile: number): boolean {
    const map = host.map;
    return (
      map.contaminationUntil[tile]! <= host.currentTick &&
      map.ownerId[tile] === this.targetOwnerId &&
      map.isLand(tile) &&
      map.adjacentTo(tile, this.attackerId)
    );
  }
  private rebuild(host: AttackHost): void {
    const required = this.frontier.size;
    if (required > this.tiles.length) {
      const capacity = Math.max(required, this.tiles.length * 2);
      this.tiles = new Uint32Array(capacity);
      this.costs = new Float64Array(capacity);
      this.distances = new Float64Array(capacity);
    }
    this.heapSize = 0;
    const [cx, cy] = host.map.centroid(this.attackerId);
    for (const tile of this.frontier) {
      if (!this.candidate(host, tile)) {
        this.frontier.delete(tile);
        continue;
      }
      const index = this.heapSize++;
      this.tiles[index] = tile;
      this.costs[index] = host.tileCost(tile);
      const dx = (tile % host.map.width) - cx,
        dy = Math.floor(tile / host.map.width) - cy;
      this.distances[index] = dx * dx + dy * dy;
    }
    for (let index = Math.floor(this.heapSize / 2) - 1; index >= 0; index--) this.down(index);
  }
  private before(a: number, b: number): boolean {
    return (
      this.costs[a]! < this.costs[b]! ||
      (this.costs[a] === this.costs[b] &&
        (this.distances[a]! < this.distances[b]! ||
          (this.distances[a] === this.distances[b] && this.tiles[a]! < this.tiles[b]!)))
    );
  }
  private swap(a: number, b: number): void {
    const tile = this.tiles[a]!,
      cost = this.costs[a]!,
      distance = this.distances[a]!;
    this.tiles[a] = this.tiles[b]!;
    this.costs[a] = this.costs[b]!;
    this.distances[a] = this.distances[b]!;
    this.tiles[b] = tile;
    this.costs[b] = cost;
    this.distances[b] = distance;
  }
  private down(index: number): void {
    for (;;) {
      const left = index * 2 + 1;
      if (left >= this.heapSize) return;
      const right = left + 1;
      const child = right < this.heapSize && this.before(right, left) ? right : left;
      if (!this.before(child, index)) return;
      this.swap(index, child);
      index = child;
    }
  }
  private pop(): void {
    this.heapSize--;
    if (this.heapSize > 0) {
      this.tiles[0] = this.tiles[this.heapSize]!;
      this.costs[0] = this.costs[this.heapSize]!;
      this.distances[0] = this.distances[this.heapSize]!;
      this.down(0);
    }
  }
}
