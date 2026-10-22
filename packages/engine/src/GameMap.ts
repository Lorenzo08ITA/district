import {
  MAX_MAP_SIDE,
  MAX_MAP_TILES,
  MAX_PLAYERS,
  TerrainType,
  isLand,
} from '@district/rts-shared';
import { assertInteger } from './prng.js';
import { Uint32List } from './collections.js';
export interface GameMapData {
  readonly terrainType: Uint8Array;
  readonly elevation: Uint8Array;
  readonly ownerId: Uint16Array;
  readonly buildingId: Uint32Array;
  readonly defenseCoverage: Uint8Array;
  readonly contaminationUntil?: Uint32Array;
}
export interface MapSnapshot extends GameMapData {
  readonly width: number;
  readonly height: number;
}
/** Tile arrays are readable by renderers; mutate through methods to preserve indexes. */
export class GameMap implements GameMapData {
  readonly length: number;
  readonly terrainType: Uint8Array;
  readonly elevation: Uint8Array;
  readonly ownerId: Uint16Array;
  readonly isBorder: Uint8Array;
  readonly buildingId: Uint32Array;
  readonly defenseCoverage: Uint8Array;
  readonly contaminationUntil: Uint32Array;
  private readonly dirtyFlags: Uint8Array;
  private readonly dirtyIndices: Uint32Array;
  private dirtyCount = 0;
  private readonly borderPositions: Int32Array;
  private readonly borders = Array.from({ length: MAX_PLAYERS + 1 }, () => new Uint32List());
  private readonly counts = new Uint32Array(MAX_PLAYERS + 1);
  private readonly sumsX = new Float64Array(MAX_PLAYERS + 1);
  private readonly sumsY = new Float64Array(MAX_PLAYERS + 1);
  private landCount = 0;
  constructor(
    readonly width: number,
    readonly height: number,
    data?: GameMapData,
  ) {
    assertInteger(width, 1, MAX_MAP_SIDE, 'map width');
    assertInteger(height, 1, MAX_MAP_SIDE, 'map height');
    this.length = width * height;
    assertInteger(this.length, 1, MAX_MAP_TILES, 'map tile count');
    if (data) {
      for (const array of [
        data.terrainType,
        data.elevation,
        data.ownerId,
        data.buildingId,
        data.defenseCoverage,
      ])
        if (array.length !== this.length) throw new RangeError('Map array length mismatch');
      if (
        !(data.terrainType instanceof Uint8Array) ||
        !(data.elevation instanceof Uint8Array) ||
        !(data.ownerId instanceof Uint16Array) ||
        !(data.buildingId instanceof Uint32Array) ||
        !(data.defenseCoverage instanceof Uint8Array)
      )
        throw new TypeError('Invalid map TypedArray types');
    }
    this.terrainType = data
      ? data.terrainType.slice()
      : new Uint8Array(this.length).fill(TerrainType.Plains);
    this.elevation = data ? data.elevation.slice() : new Uint8Array(this.length);
    this.ownerId = data ? data.ownerId.slice() : new Uint16Array(this.length);
    this.buildingId = data ? data.buildingId.slice() : new Uint32Array(this.length);
    this.defenseCoverage = data ? data.defenseCoverage.slice() : new Uint8Array(this.length);
    if (
      data?.contaminationUntil &&
      (!(data.contaminationUntil instanceof Uint32Array) ||
        data.contaminationUntil.length !== this.length)
    )
      throw new RangeError('Invalid contamination buffer');
    this.contaminationUntil = data?.contaminationUntil?.slice() ?? new Uint32Array(this.length);
    this.isBorder = new Uint8Array(this.length);
    this.dirtyFlags = new Uint8Array(this.length);
    this.dirtyIndices = new Uint32Array(this.length);
    this.borderPositions = new Int32Array(this.length).fill(-1);
    for (let i = 0; i < this.length; i++) {
      const terrain = this.terrainType[i]!,
        owner = this.ownerId[i]!;
      if (terrain > TerrainType.Mountains || owner > MAX_PLAYERS)
        throw new RangeError('Invalid terrain or owner');
      if (
        !isLand(terrain) &&
        (owner !== 0 || this.buildingId[i] !== 0 || this.defenseCoverage[i] !== 0)
      )
        throw new RangeError('Water cannot contain land ownership or buildings');
      if (isLand(terrain)) {
        this.landCount++;
        this.adjustCount(owner, i, 1);
      }
    }
    for (let i = 0; i < this.length; i++) {
      this.refreshBorder(i);
      this.markDirty(i);
    }
  }
  get totalLandTiles(): number {
    return this.landCount;
  }
  assertTile(index: number): void {
    assertInteger(index, 0, this.length - 1, 'tile index');
  }
  index(x: number, y: number): number {
    assertInteger(x, 0, this.width - 1, 'x');
    assertInteger(y, 0, this.height - 1, 'y');
    return y * this.width + x;
  }
  x(index: number): number {
    this.assertTile(index);
    return index % this.width;
  }
  y(index: number): number {
    this.assertTile(index);
    return Math.floor(index / this.width);
  }
  neighbor(index: number, direction: number): number {
    switch (direction) {
      case 0:
        return index >= this.width ? index - this.width : -1;
      case 1:
        return (index % this.width) + 1 < this.width ? index + 1 : -1;
      case 2:
        return index + this.width < this.length ? index + this.width : -1;
      case 3:
        return index % this.width > 0 ? index - 1 : -1;
      default:
        return -1;
    }
  }
  isLand(index: number): boolean {
    this.assertTile(index);
    return isLand(this.terrainType[index]!);
  }
  landSize(owner: number): number {
    assertInteger(owner, 0, MAX_PLAYERS, 'owner');
    return this.counts[owner]!;
  }
  centroid(owner: number): readonly [number, number] {
    const count = this.landSize(owner);
    return count ? [this.sumsX[owner]! / count, this.sumsY[owner]! / count] : [0, 0];
  }
  /** Borrowed dense view, invalidated by the next ownership mutation. */
  borderTiles(owner: number): Uint32Array {
    assertInteger(owner, 1, MAX_PLAYERS, 'owner');
    return this.borders[owner]!.view();
  }
  adjacentTo(index: number, owner: number): boolean {
    for (let direction = 0; direction < 4; direction++) {
      const n = this.neighbor(index, direction);
      if (n >= 0 && this.ownerId[n] === owner && isLand(this.terrainType[n]!)) return true;
    }
    return false;
  }
  setOwner(index: number, owner: number): void {
    this.assertTile(index);
    assertInteger(owner, 0, MAX_PLAYERS, 'owner');
    if (!isLand(this.terrainType[index]!)) throw new RangeError('Cannot own water');
    const oldOwner = this.ownerId[index]!;
    if (oldOwner === owner) return;
    this.removeBorder(index, oldOwner);
    this.isBorder[index] = 0;
    this.adjustCount(oldOwner, index, -1);
    this.adjustCount(owner, index, 1);
    this.ownerId[index] = owner;
    this.defenseCoverage[index] = 0;
    this.markDirty(index);
    this.refreshAround(index);
  }
  setTerrain(index: number, terrain: TerrainType): void {
    this.assertTile(index);
    assertInteger(terrain, TerrainType.DeepWater, TerrainType.Mountains, 'terrain');
    const wasLand = isLand(this.terrainType[index]!),
      willBeLand = isLand(terrain);
    if (wasLand && !willBeLand) {
      if (this.ownerId[index] !== 0) this.setOwner(index, 0);
      this.adjustCount(0, index, -1);
      this.landCount--;
      this.buildingId[index] = 0;
      this.defenseCoverage[index] = 0;
    } else if (!wasLand && willBeLand) {
      this.adjustCount(0, index, 1);
      this.landCount++;
    }
    this.terrainType[index] = terrain;
    this.markDirty(index);
    this.refreshAround(index);
  }
  setContamination(index: number, until: number): void {
    this.assertTile(index);
    assertInteger(until, 0, 0xffffffff, 'contamination tick');
    if (this.contaminationUntil[index] !== until) {
      this.contaminationUntil[index] = until;
      this.markDirty(index);
    }
  }
  setElevation(index: number, value: number): void {
    this.assertTile(index);
    assertInteger(value, 0, 255, 'elevation');
    if (this.elevation[index] !== value) {
      this.elevation[index] = value;
      this.markDirty(index);
    }
  }
  setDefenseCoverage(index: number, value: number): void {
    this.assertTile(index);
    assertInteger(value, 0, 255, 'defense coverage');
    if (!isLand(this.terrainType[index]!)) throw new RangeError('Cannot cover water');
    if (this.defenseCoverage[index] !== value) {
      this.defenseCoverage[index] = value;
      this.markDirty(index);
    }
  }
  setBuilding(index: number, id: number): void {
    this.assertTile(index);
    assertInteger(id, 0, 0xffff_ffff, 'building ID');
    if (!isLand(this.terrainType[index]!)) throw new RangeError('Cannot build on water');
    if (this.buildingId[index] !== id) {
      this.buildingId[index] = id;
      this.markDirty(index);
    }
  }
  consumeDirtyTiles(): Uint32Array {
    const result = this.dirtyIndices.slice(0, this.dirtyCount);
    for (let i = 0; i < this.dirtyCount; i++) this.dirtyFlags[this.dirtyIndices[i]!] = 0;
    this.dirtyCount = 0;
    return result;
  }
  snapshot(): MapSnapshot {
    return {
      width: this.width,
      height: this.height,
      terrainType: this.terrainType.slice(),
      elevation: this.elevation.slice(),
      ownerId: this.ownerId.slice(),
      buildingId: this.buildingId.slice(),
      defenseCoverage: this.defenseCoverage.slice(),
      contaminationUntil: this.contaminationUntil.slice(),
    };
  }
  private adjustCount(owner: number, index: number, amount: number): void {
    this.counts[owner] = this.counts[owner]! + amount;
    this.sumsX[owner] = this.sumsX[owner]! + (index % this.width) * amount;
    this.sumsY[owner] = this.sumsY[owner]! + Math.floor(index / this.width) * amount;
  }
  private markDirty(index: number): void {
    if (!this.dirtyFlags[index]) {
      this.dirtyFlags[index] = 1;
      this.dirtyIndices[this.dirtyCount++] = index;
    }
  }
  private removeBorder(index: number, owner: number): void {
    const position = this.borderPositions[index]!;
    if (position < 0 || owner === 0) return;
    const swapped = this.borders[owner]!.removeSwap(position);
    if (swapped !== null) this.borderPositions[swapped] = position;
    this.borderPositions[index] = -1;
  }
  private refreshAround(index: number): void {
    this.refreshBorder(index);
    for (let direction = 0; direction < 4; direction++) {
      const n = this.neighbor(index, direction);
      if (n >= 0) this.refreshBorder(n);
    }
  }
  private refreshBorder(index: number): void {
    const owner = this.ownerId[index]!;
    let mask = 0;
    if (isLand(this.terrainType[index]!)) {
      for (let direction = 0; direction < 4; direction++) {
        const n = this.neighbor(index, direction);
        if (n < 0 || !isLand(this.terrainType[n]!) || this.ownerId[n] !== owner)
          mask |= 1 << direction;
      }
    }
    if (mask !== this.isBorder[index]) {
      this.isBorder[index] = mask;
      this.markDirty(index);
    }
    if (owner > 0 && mask !== 0 && this.borderPositions[index] === -1)
      this.borderPositions[index] = this.borders[owner]!.push(index);
    else if (mask === 0) this.removeBorder(index, owner);
  }
}
