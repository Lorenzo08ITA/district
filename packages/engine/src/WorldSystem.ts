import {
  BALANCE,
  BUILDING_RULES,
  WORLD_BALANCE,
  BuildingKind,
  CommandKind,
  MAX_RESOURCE,
  UINT32_MAX,
  UnitKind,
  type BuildingState,
  type CommandRejection,
  type EngineEvent,
  type GameCommand,
  type RailConnection,
} from '@district/rts-shared';
import { Pathfinder, distanceMilli, type PathOptions } from './Pathfinder.js';
import { tickLogistics, connectStation } from './Logistics.js';
import { executeNaval, tickNaval } from './Naval.js';
import { launchNuke, tickNuclear } from './Nuclear.js';
import { executeDiplomacy, tickBots } from './Diplomacy.js';
import { restoreWorld } from './world-snapshot.js';
import type {
  AllianceRequest,
  NavalProjectile,
  WorldHost,
  WorldInterceptor,
  WorldMissile,
  WorldSnapshot,
  WorldUnit,
} from './world-types.js';
import type { StateHasher } from './hash.js';
export class WorldSystem {
  readonly buildings = new Map<number, BuildingState>();
  readonly rails = new Map<number, RailConnection>();
  readonly units = new Map<number, WorldUnit>();
  readonly missiles = new Map<number, WorldMissile>();
  readonly interceptors = new Map<number, WorldInterceptor>();
  readonly projectiles = new Map<number, NavalProjectile>();
  readonly baseCityLevels = new Map<number, number>();
  readonly defenseBuilt = new Map<number, number>();
  readonly allianceRequests = new Map<string, AllianceRequest>();
  readonly bots = new Set<number>();
  private readonly defenseBuckets = new Map<number, Set<number>>();
  private readonly dirtyCoverage = new Set<number>();
  private readonly expiry = new Map<number, number[]>();
  private pathfinder: Pathfinder | undefined;
  private pathNodesRemaining: number = WORLD_BALANCE.pathNodeBudget;
  nextEntityId = 1;
  mirvLaunches = 0;
  events: EngineEvent[] = [];
  constructor(
    readonly host: WorldHost,
    bots: readonly number[] = [],
  ) {
    for (const id of host.playerIds()) this.baseCityLevels.set(id, host.player(id)!.cityLevels);
    for (const id of bots) {
      if (!host.player(id)) throw new RangeError('Unknown bot');
      this.bots.add(id);
    }
  }
  get map() {
    return this.host.map;
  }
  get tick() {
    return this.host.currentTick;
  }
  get paths(): Pathfinder {
    return (this.pathfinder ??= new Pathfinder(this.map));
  }
  findPath(start: number, target: number, options: PathOptions): ReturnType<Pathfinder['find']> {
    if (this.pathNodesRemaining < 1)
      return { status: 'budget-exceeded', path: new Uint32Array(), expanded: 0 };
    const result = this.paths.find(start, target, {
      ...options,
      maxNodes: Math.min(options.maxNodes ?? WORLD_BALANCE.pathNodeBudget, this.pathNodesRemaining),
    });
    this.pathNodesRemaining -= result.expanded;
    return result;
  }
  allocateId(): number {
    if (this.nextEntityId >= UINT32_MAX) throw new RangeError('Entity ID space exhausted');
    return this.nextEntityId++;
  }
  canAllocateUnit(owner: number, pathLength = 0): boolean {
    return (
      this.routeFits(pathLength) &&
      this.units.size < WORLD_BALANCE.maxUnits &&
      [...this.units.values()].filter((u) => u.ownerId === owner).length <
        WORLD_BALANCE.maxUnitsPerPlayer &&
      this.nextEntityId < UINT32_MAX
    );
  }
  routeFits(length: number, replacingId = 0): boolean {
    let total = length;
    for (const unit of this.units.values()) if (unit.id !== replacingId) total += unit.path.length;
    return total <= WORLD_BALANCE.maxUnitPathTiles;
  }
  friendly(a: number, b: number): boolean {
    return a === b || b === 0 || !!this.host.player(a)?.alliances.has(b);
  }
  emit(
    action: Extract<EngineEvent, { kind: 'world' }>['action'],
    entityId: number,
    playerId: number,
    tile: number,
  ): void {
    this.events.push({ kind: 'world', action, entityId, playerId, tile });
  }
  credit(playerId: number, amount: number, sourceId: number): void {
    const p = this.host.player(playerId);
    if (!p || !Number.isSafeInteger(amount) || amount <= 0) return;
    const actual = Math.min(amount, MAX_RESOURCE - p.gold);
    p.gold += actual;
    if (actual) this.events.push({ kind: 'income', playerId, amount: actual, sourceId });
  }
  beginTick(events: EngineEvent[]): void {
    this.events = events;
    this.pathNodesRemaining = WORLD_BALANCE.pathNodeBudget;
    for (const b of this.buildings.values()) if (b.cooldownTicks > 0) b.cooldownTicks--;
    for (const [tick, tiles] of this.expiry)
      if (tick <= this.tick) {
        for (const tile of tiles)
          if (this.map.contaminationUntil[tile]! <= this.tick) this.map.setContamination(tile, 0);
        this.expiry.delete(tick);
      }
    for (const [key, request] of this.allianceRequests)
      if (request.expiresTick <= this.tick) this.allianceRequests.delete(key);
  }
  execute(command: GameCommand): CommandRejection | null {
    switch (command.kind) {
      case CommandKind.Build:
        return this.build(command.playerId, command.tile, command.building);
      case CommandKind.Upgrade:
        return this.upgrade(command.playerId, command.buildingId);
      case CommandKind.Transport:
      case CommandKind.ProduceWarship:
      case CommandKind.Patrol:
        return executeNaval(this, command);
      case CommandKind.LaunchNuke:
        return launchNuke(this, command);
      case CommandKind.RequestAlliance:
      case CommandKind.AcceptAlliance:
      case CommandKind.BreakAlliance:
        return executeDiplomacy(this, command);
      default:
        return 'UNSUPPORTED_COMMAND';
    }
  }
  advance(): void {
    this.flushCoverage();
    tickLogistics(this);
    tickNaval(this);
    tickNuclear(this);
    this.flushCoverage();
    tickBots(this);
  }
  buildCost(owner: number, kind: BuildingKind): number {
    if (kind === BuildingKind.DefensePost)
      return Math.min(
        BALANCE.defenseMaxGold,
        BALANCE.defenseBaseGold +
          (this.defenseBuilt.get(owner) ?? 0) * BALANCE.defenseGoldIncrement,
      );
    const count = [...this.buildings.values()].filter(
      (b) => b.ownerId === owner && b.kind === kind,
    ).length;
    return BUILDING_RULES[kind].gold * (count + 1);
  }
  build(owner: number, tile: number, kind: BuildingKind): CommandRejection | null {
    if (tile >= this.map.length || !this.map.isLand(tile)) return 'INVALID_TILE';
    if (this.map.ownerId[tile] !== owner) return 'NOT_OWNER';
    if (this.map.buildingId[tile] !== 0) return 'OCCUPIED';
    if (this.map.contaminationUntil[tile]! > this.tick) return 'CONTAMINATED';
    if (kind === BuildingKind.Port && !this.isCoast(tile)) return 'NOT_COASTAL';
    if (
      this.buildings.size >= WORLD_BALANCE.maxBuildings ||
      [...this.buildings.values()].filter((b) => b.ownerId === owner).length >=
        WORLD_BALANCE.maxBuildingsPerPlayer ||
      this.nextEntityId >= UINT32_MAX
    )
      return 'ENTITY_LIMIT';
    if (kind === BuildingKind.City && this.host.player(owner)!.cityLevels >= 1_000_000)
      return 'MAX_LEVEL';
    const p = this.host.player(owner)!,
      cost = this.buildCost(owner, kind);
    if (p.gold < cost) return 'INSUFFICIENT_GOLD';
    p.gold -= cost;
    const b: BuildingState = {
      id: this.allocateId(),
      kind,
      ownerId: owner,
      tile,
      level: 1,
      hp: BUILDING_RULES[kind].hp,
      cooldownTicks: kind === BuildingKind.Port ? WORLD_BALANCE.tradeIntervalTicks : 0,
      ammunition: kind === BuildingKind.MissileSilo ? 1 : 0,
    };
    this.buildings.set(b.id, b);
    this.map.setBuilding(tile, b.id);
    if (kind === BuildingKind.City) this.updateCities();
    if (kind === BuildingKind.DefensePost) {
      this.defenseBuilt.set(owner, (this.defenseBuilt.get(owner) ?? 0) + 1);
      this.indexDefense(b);
      this.queueCoverage(tile);
      this.flushCoverage();
    }
    if (this.isStation(b)) connectStation(this, b);
    this.emit('built', b.id, owner, tile);
    return null;
  }
  upgrade(owner: number, id: number): CommandRejection | null {
    const b = this.buildings.get(id);
    if (!b) return 'UNKNOWN_BUILDING';
    if (b.ownerId !== owner) return 'NOT_OWNER';
    if (b.kind === BuildingKind.City && this.host.player(owner)!.cityLevels >= 1_000_000)
      return 'MAX_LEVEL';
    if (b.level >= BUILDING_RULES[b.kind].maxLevel) return 'MAX_LEVEL';
    const p = this.host.player(owner)!,
      cost = BUILDING_RULES[b.kind].gold * (b.level + 1) ** 2;
    if (p.gold < cost) return 'INSUFFICIENT_GOLD';
    p.gold -= cost;
    b.level++;
    b.hp += BUILDING_RULES[b.kind].hp;
    if (b.kind === BuildingKind.MissileSilo) b.ammunition++;
    if (b.kind === BuildingKind.City) this.updateCities();
    this.emit('upgraded', b.id, owner, b.tile);
    return null;
  }
  destroyBuilding(id: number): void {
    const b = this.buildings.get(id);
    if (!b) return;
    this.buildings.delete(id);
    this.map.setBuilding(b.tile, 0);
    for (const [railId, rail] of this.rails)
      if (rail.fromBuildingId === id || rail.toBuildingId === id) this.rails.delete(railId);
    if (b.kind === BuildingKind.DefensePost) {
      this.unindexDefense(b);
      this.queueCoverage(b.tile);
    }
    if (b.kind === BuildingKind.City) this.updateCities();
    this.emit('destroyed', id, b.ownerId, b.tile);
  }
  onOwnerChanged(tile: number, owner: number): void {
    const b = this.buildings.get(this.map.buildingId[tile]!);
    if (b && b.ownerId !== owner) {
      b.ownerId = owner;
      if (b.kind === BuildingKind.City) this.updateCities();
      if (b.kind === BuildingKind.DefensePost) this.queueCoverage(tile);
      this.emit('captured', b.id, owner, tile);
    }
    this.refreshCoverageAt(tile);
  }
  updateCities(): void {
    for (const id of this.host.playerIds()) {
      let levels = this.baseCityLevels.get(id) ?? 0;
      for (const b of this.buildings.values())
        if (b.ownerId === id && b.kind === BuildingKind.City) levels += b.level;
      this.host.player(id)!.cityLevels = levels;
    }
  }
  isStation(b: BuildingState): boolean {
    return (
      b.kind === BuildingKind.City ||
      b.kind === BuildingKind.Factory ||
      b.kind === BuildingKind.Port
    );
  }
  isCoast(tile: number): boolean {
    if (!this.map.isLand(tile)) return false;
    for (let d = 0; d < 4; d++) {
      const n = this.map.neighbor(tile, d);
      if (n >= 0 && !this.map.isLand(n)) return true;
    }
    return false;
  }
  waterNeighbors(tile: number): number[] {
    const result: number[] = [];
    for (let d = 0; d < 4; d++) {
      const n = this.map.neighbor(tile, d);
      if (n >= 0 && !this.map.isLand(n)) result.push(n);
    }
    return result;
  }
  seaRoute(fromCoast: number, toCoast: number): ReturnType<Pathfinder['find']> {
    let remaining = WORLD_BALANCE.pathNodeBudget,
      expanded = 0;
    for (const start of this.waterNeighbors(fromCoast))
      for (const end of this.waterNeighbors(toCoast)) {
        if (remaining < 1) return { status: 'budget-exceeded', path: new Uint32Array(), expanded };
        const result = this.findPath(start, end, {
          mode: 'water',
          smooth: true,
          maxNodes: remaining,
        });
        remaining -= result.expanded;
        expanded += result.expanded;
        if (result.status === 'found' || result.status === 'budget-exceeded')
          return { ...result, expanded };
      }
    return {
      status: remaining < 1 ? 'budget-exceeded' : 'unreachable',
      path: new Uint32Array(),
      expanded,
    };
  }
  routeFromWater(start: number, toCoast: number): ReturnType<Pathfinder['find']> {
    let remaining = WORLD_BALANCE.pathNodeBudget,
      expanded = 0;
    for (const end of this.waterNeighbors(toCoast)) {
      if (remaining < 1) break;
      const r = this.findPath(start, end, { mode: 'water', smooth: true, maxNodes: remaining });
      remaining -= r.expanded;
      expanded += r.expanded;
      if (r.status === 'found' || r.status === 'budget-exceeded') return { ...r, expanded };
    }
    return {
      status: remaining < 1 ? 'budget-exceeded' : 'unreachable',
      path: new Uint32Array(),
      expanded,
    };
  }
  transportCount(owner: number): number {
    return [...this.units.values()].filter(
      (u) => u.ownerId === owner && u.kind === UnitKind.TransportShip,
    ).length;
  }
  motion(path: Uint32Array) {
    const tile = path[0]!;
    return {
      tile,
      path,
      pathCursor: 0,
      progressBps: 0,
      segmentProgressMilli: 0,
      xMilli: (tile % this.map.width) * 1000,
      yMilli: Math.floor(tile / this.map.width) * 1000,
      createdTick: this.tick,
    };
  }
  /** One budget of integer distance per tick, including multiple short rail edges. */
  move(unit: WorldUnit, speed: number): 'moving' | 'arrived' | 'blocked' {
    let remaining = speed;
    while (unit.pathCursor + 1 < unit.path.length) {
      const a = unit.path[unit.pathCursor]!,
        b = unit.path[unit.pathCursor + 1]!;
      if (
        unit.kind === UnitKind.Train
          ? !this.map.isLand(b) ||
            !this.friendly(unit.ownerId, this.map.ownerId[b]!) ||
            this.map.contaminationUntil[b]! > this.tick
          : this.map.isLand(b)
      )
        return 'blocked';
      const length = Math.max(1, distanceMilli(this.map.width, a, b)),
        step = Math.min(remaining, length - unit.segmentProgressMilli);
      unit.segmentProgressMilli += step;
      remaining -= step;
      unit.progressBps = Math.min(9999, Math.floor((unit.segmentProgressMilli * 10000) / length));
      const ax = (a % this.map.width) * 1000,
        ay = Math.floor(a / this.map.width) * 1000,
        bx = (b % this.map.width) * 1000,
        by = Math.floor(b / this.map.width) * 1000;
      unit.xMilli = ax + Math.trunc(((bx - ax) * unit.segmentProgressMilli) / length);
      unit.yMilli = ay + Math.trunc(((by - ay) * unit.segmentProgressMilli) / length);
      unit.tile =
        Math.floor((unit.yMilli + 500) / 1000) * this.map.width +
        Math.floor((unit.xMilli + 500) / 1000);
      if (unit.segmentProgressMilli < length) return 'moving';
      unit.pathCursor++;
      unit.segmentProgressMilli = 0;
      unit.progressBps = 0;
      unit.tile = b;
      if (remaining === 0) break;
    }
    return unit.pathCursor + 1 >= unit.path.length ? 'arrived' : 'moving';
  }
  removeUnit(id: number): void {
    const unit = this.units.get(id);
    if (!unit) return;
    this.units.delete(id);
    this.emit('destroyed', id, unit.ownerId, unit.tile);
  }
  contaminate(tile: number): void {
    const until = Math.min(UINT32_MAX, this.tick + WORLD_BALANCE.contaminationTicks);
    this.map.setContamination(tile, until);
    const bucket = this.expiry.get(until) ?? [];
    bucket.push(tile);
    this.expiry.set(until, bucket);
  }
  flushCoverage(): void {
    for (const tile of this.dirtyCoverage) this.refreshCoverageAt(tile);
    this.dirtyCoverage.clear();
  }
  refreshCoverageAt(tile: number): void {
    if (!this.map.isLand(tile)) return;
    const owner = this.map.ownerId[tile]!;
    let count = 0;
    const x = tile % this.map.width,
      y = Math.floor(tile / this.map.width),
      cx = Math.floor(x / 32),
      cy = Math.floor(y / 32);
    if (owner > 0)
      for (let by = cy - 1; by <= cy + 1; by++)
        for (let bx = cx - 1; bx <= cx + 1; bx++)
          for (const id of this.defenseBuckets.get(by * 129 + bx) ?? []) {
            const b = this.buildings.get(id)!;
            const dx = (b.tile % this.map.width) - x,
              dy = Math.floor(b.tile / this.map.width) - y;
            if (b.ownerId === owner && dx * dx + dy * dy <= BALANCE.defenseRadius ** 2) count++;
          }
    this.map.setDefenseCoverage(tile, Math.min(255, count));
  }
  rebuildDerived(): void {
    this.defenseBuckets.clear();
    this.expiry.clear();
    this.dirtyCoverage.clear();
    for (const b of this.buildings.values())
      if (b.kind === BuildingKind.DefensePost) this.indexDefense(b);
    for (let tile = 0; tile < this.map.length; tile++) {
      const until = this.map.contaminationUntil[tile]!;
      if (until > this.tick) {
        const bucket = this.expiry.get(until) ?? [];
        bucket.push(tile);
        this.expiry.set(until, bucket);
      }
    }
    this.updateCities();
  }
  snapshot(): WorldSnapshot {
    return structuredClone({
      version: 1,
      nextEntityId: this.nextEntityId,
      mirvLaunches: this.mirvLaunches,
      buildings: [...this.buildings.values()].sort((a, b) => a.id - b.id),
      rails: [...this.rails.values()].sort((a, b) => a.id - b.id),
      units: [...this.units.values()].sort((a, b) => a.id - b.id),
      missiles: [...this.missiles.values()].sort((a, b) => a.id - b.id),
      interceptors: [...this.interceptors.values()].sort((a, b) => a.id - b.id),
      projectiles: [...this.projectiles.values()].sort((a, b) => a.id - b.id),
      baseCityLevels: [...this.baseCityLevels].sort((a, b) => a[0] - b[0]),
      defenseBuilt: [...this.defenseBuilt].sort((a, b) => a[0] - b[0]),
      allianceRequests: [...this.allianceRequests.values()].sort(
        (a, b) => a.from - b.from || a.to - b.to,
      ),
      bots: [...this.bots].sort((a, b) => a - b),
    }) as WorldSnapshot;
  }
  restore(snapshot: WorldSnapshot): void {
    restoreWorld(this, snapshot);
  }
  hash(hash: StateHasher): void {
    hash.text(
      JSON.stringify(this.snapshot(), (_key, value: unknown) =>
        value instanceof Set
          ? [...value].sort((a, b) => Number(a) - Number(b))
          : ArrayBuffer.isView(value)
            ? Array.from(value as unknown as ArrayLike<number>)
            : value && typeof value === 'object' && !Array.isArray(value)
              ? Object.fromEntries(
                  Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
                )
              : value,
      ),
    );
  }
  private indexDefense(b: BuildingState): void {
    const key =
      Math.floor(Math.floor(b.tile / this.map.width) / 32) * 129 +
      Math.floor((b.tile % this.map.width) / 32);
    const bucket = this.defenseBuckets.get(key) ?? new Set();
    bucket.add(b.id);
    this.defenseBuckets.set(key, bucket);
  }
  private unindexDefense(b: BuildingState): void {
    const key =
      Math.floor(Math.floor(b.tile / this.map.width) / 32) * 129 +
      Math.floor((b.tile % this.map.width) / 32);
    this.defenseBuckets.get(key)?.delete(b.id);
  }
  private queueCoverage(tile: number): void {
    const cx = tile % this.map.width,
      cy = Math.floor(tile / this.map.width),
      r = BALANCE.defenseRadius;
    for (let y = Math.max(0, cy - r); y <= Math.min(this.map.height - 1, cy + r); y++)
      for (let x = Math.max(0, cx - r); x <= Math.min(this.map.width - 1, cx + r); x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.dirtyCoverage.add(y * this.map.width + x);
  }
}
