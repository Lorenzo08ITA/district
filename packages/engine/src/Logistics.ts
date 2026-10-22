import {
  BALANCE,
  WORLD_BALANCE,
  BuildingKind,
  UnitKind,
  type BuildingState,
  type RailConnection,
} from '@district/rts-shared';
import { distanceMilli } from './Pathfinder.js';
import type { WorldSystem } from './WorldSystem.js';
export function connectStation(world: WorldSystem, station: BuildingState): void {
  const others = [...world.buildings.values()]
    .filter(
      (b) =>
        b.id !== station.id &&
        world.isStation(b) &&
        (b.kind === BuildingKind.Factory || station.kind === BuildingKind.Factory) &&
        world.friendly(station.ownerId, b.ownerId) &&
        distanceMilli(world.map.width, b.tile, station.tile) <= BALANCE.factoryStationRadius * 1000,
    )
    .sort(
      (a, b) =>
        distanceMilli(world.map.width, a.tile, station.tile) -
          distanceMilli(world.map.width, b.tile, station.tile) || a.id - b.id,
    );
  let remaining = WORLD_BALANCE.pathNodeBudget;
  for (const b of others) {
    if (remaining < 1 || world.rails.size >= WORLD_BALANCE.maxRails) break;
    if (
      [...world.rails.values()].some(
        (r) =>
          (r.fromBuildingId === station.id && r.toBuildingId === b.id) ||
          (r.fromBuildingId === b.id && r.toBuildingId === station.id),
      )
    )
      continue;
    const result = world.findPath(station.tile, b.tile, {
      mode: 'land',
      maxNodes: remaining,
      allowed: (t) =>
        world.friendly(station.ownerId, world.map.ownerId[t]!) &&
        world.map.contaminationUntil[t]! <= world.tick,
    });
    remaining -= result.expanded;
    if (result.status === 'budget-exceeded') {
      world.emit('pathLimited', station.id, station.ownerId, station.tile);
      break;
    }
    if (
      result.status === 'found' &&
      [...world.rails.values()].reduce((sum, r) => sum + r.tiles.length, 0) + result.path.length <=
        WORLD_BALANCE.maxRailTiles
    ) {
      const id = world.allocateId();
      world.rails.set(id, {
        id,
        fromBuildingId: station.id,
        toBuildingId: b.id,
        tiles: result.path,
      });
    }
  }
}
function railPath(
  world: WorldSystem,
  origin: number,
  destination: number,
  owner: number,
): Uint32Array | null {
  const adjacency = new Map<number, RailConnection[]>();
  for (const rail of world.rails.values())
    for (const id of [rail.fromBuildingId, rail.toBuildingId]) {
      const edges = adjacency.get(id) ?? [];
      edges.push(rail);
      adjacency.set(id, edges);
    }
  const queue = [origin],
    parents = new Map<number, { station: number; rail: number }>();
  const visited = new Set([origin]);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const station = queue[cursor]!;
    if (station === destination) break;
    for (const rail of adjacency.get(station) ?? []) {
      const next =
        rail.fromBuildingId === station
          ? rail.toBuildingId
          : rail.toBuildingId === station
            ? rail.fromBuildingId
            : 0;
      if (!next || visited.has(next)) continue;
      const b = world.buildings.get(next);
      if (!b || !world.friendly(owner, b.ownerId)) continue;
      let valid = true;
      for (const tile of rail.tiles)
        if (
          !world.friendly(owner, world.map.ownerId[tile]!) ||
          !world.map.isLand(tile) ||
          world.map.contaminationUntil[tile]! > world.tick
        ) {
          valid = false;
          break;
        }
      if (!valid) continue;
      visited.add(next);
      parents.set(next, { station, rail: rail.id });
      queue.push(next);
    }
  }
  if (!visited.has(destination)) return null;
  const segments: Uint32Array[] = [];
  let count = 1;
  for (let current = destination; current !== origin;) {
    const p = parents.get(current)!,
      rail = world.rails.get(p.rail)!;
    const path = rail.fromBuildingId === p.station ? rail.tiles : rail.tiles.slice().reverse();
    segments.push(path);
    count += path.length - 1;
    current = p.station;
    if (count > WORLD_BALANCE.pathNodeBudget) return null;
  }
  const path = new Uint32Array(count);
  let offset = 0;
  for (const segment of segments.reverse()) {
    path.set(segment.subarray(offset ? 1 : 0), offset);
    offset += segment.length - (offset ? 1 : 0);
  }
  return path;
}
function spawnTrain(world: WorldSystem, factory: BuildingState): void {
  if (!world.canAllocateUnit(factory.ownerId)) return;
  const stations = [...world.buildings.values()]
    .filter(
      (b) =>
        b.id !== factory.id && world.isStation(b) && world.friendly(factory.ownerId, b.ownerId),
    )
    .sort((a, b) => a.id - b.id);
  if (!stations.length) return;
  const first = world.host.rng.nextInt(stations.length);
  for (let n = 0; n < stations.length; n++) {
    const destination = stations[(first + n) % stations.length]!,
      path = railPath(world, factory.id, destination.id, factory.ownerId);
    if (!path) continue;
    if (!world.canAllocateUnit(factory.ownerId, path.length)) return;
    const id = world.allocateId();
    world.units.set(id, {
      id,
      kind: UnitKind.Train,
      ownerId: factory.ownerId,
      hp: 100,
      ...world.motion(path),
      originBuildingId: factory.id,
      destinationBuildingId: destination.id,
      visitedStationIds: new Set(),
    });
    world.emit('spawned', id, factory.ownerId, factory.tile);
    return;
  }
}
function spawnTrade(world: WorldSystem, port: BuildingState): void {
  if (!world.canAllocateUnit(port.ownerId)) return;
  const destinations = [...world.buildings.values()]
    .filter(
      (b) =>
        b.kind === BuildingKind.Port && b.id !== port.id && world.friendly(port.ownerId, b.ownerId),
    )
    .sort((a, b) => a.id - b.id);
  if (!destinations.length) return;
  const first = world.host.rng.nextInt(destinations.length);
  let remaining = WORLD_BALANCE.pathNodeBudget;
  for (let n = 0; n < destinations.length && remaining > 0; n++) {
    const destination = destinations[(first + n) % destinations.length]!,
      result = world.seaRoute(port.tile, destination.tile);
    remaining -= result.expanded;
    if (result.status === 'budget-exceeded') return;
    if (result.status !== 'found') continue;
    if (!world.canAllocateUnit(port.ownerId, result.path.length)) return;
    let distance = 0;
    for (let i = 1; i < result.path.length; i++)
      distance += distanceMilli(world.map.width, result.path[i - 1]!, result.path[i]!);
    const id = world.allocateId();
    world.units.set(id, {
      id,
      kind: UnitKind.TradeShip,
      ownerId: port.ownerId,
      hp: 500,
      ...world.motion(result.path),
      originPortId: port.id,
      destinationPortId: destination.id,
      cargoGold: Math.floor((distance * WORLD_BALANCE.tradeGoldPerTile) / 1000),
      distanceTravelled: 0,
    });
    world.emit('spawned', id, port.ownerId, port.tile);
    return;
  }
}
function visitStation(
  world: WorldSystem,
  unit: Extract<import('./world-types.js').WorldUnit, { kind: UnitKind.Train }>,
): void {
  const b = world.buildings.get(world.map.buildingId[unit.tile]!);
  if (
    !b ||
    unit.visitedStationIds.has(b.id) ||
    !world.friendly(unit.ownerId, b.ownerId) ||
    (b.kind !== BuildingKind.City && b.kind !== BuildingKind.Port)
  )
    return;
  unit.visitedStationIds.add(b.id);
  const bonus =
    b.ownerId !== unit.ownerId && b.ownerId !== 0 ? WORLD_BALANCE.alliedTradeBonusBps : 10000;
  world.credit(
    unit.ownerId,
    Math.floor((WORLD_BALANCE.stationTrainGold * b.level * bonus) / 10000),
    unit.id,
  );
  world.credit(
    b.ownerId,
    Math.floor((WORLD_BALANCE.stationOwnerGold * b.level * bonus) / 10000),
    unit.id,
  );
}
export function tickLogistics(world: WorldSystem): void {
  const factories = new Map<number, number>();
  for (const b of world.buildings.values())
    if (b.kind === BuildingKind.Factory)
      factories.set(b.ownerId, (factories.get(b.ownerId) ?? 0) + 1);
  for (const b of world.buildings.values()) {
    if (!world.host.player(b.ownerId) || world.host.player(b.ownerId)!.eliminated) continue;
    if (b.kind === BuildingKind.Factory)
      for (let attempt = 0; attempt < b.level; attempt++)
        if (
          world.host.rng.nextInt(
            ((factories.get(b.ownerId) ?? 0) + 10) * BALANCE.factoryProbabilityDivisor,
          ) === 0
        )
          spawnTrain(world, b);
    if (b.kind === BuildingKind.Port && b.cooldownTicks === 0) {
      b.cooldownTicks = Math.max(10, Math.floor(WORLD_BALANCE.tradeIntervalTicks / b.level));
      spawnTrade(world, b);
    }
  }
  for (const unit of [...world.units.values()]) {
    if (unit.createdTick === world.tick) continue;
    if (unit.kind === UnitKind.Train) {
      const status = world.move(unit, WORLD_BALANCE.trainSpeedMilli);
      visitStation(world, unit);
      if (status !== 'moving') {
        if (status === 'arrived') world.emit('arrived', unit.id, unit.ownerId, unit.tile);
        world.units.delete(unit.id);
      }
    }
    if (unit.kind === UnitKind.TradeShip) {
      let destination = world.buildings.get(unit.destinationPortId);
      if (!destination || !world.friendly(unit.ownerId, destination.ownerId)) {
        if (world.tick % 10 !== 0) continue;
        destination = undefined;
        const ports = [...world.buildings.values()]
          .filter((b) => b.kind === BuildingKind.Port && world.friendly(unit.ownerId, b.ownerId))
          .sort(
            (a, b) =>
              distanceMilli(world.map.width, unit.tile, a.tile) -
                distanceMilli(world.map.width, unit.tile, b.tile) || a.id - b.id,
          );
        for (const port of ports) {
          const route = world.routeFromWater(unit.tile, port.tile);
          if (route.status === 'found' && world.routeFits(route.path.length, unit.id)) {
            const created = unit.createdTick;
            Object.assign(unit, world.motion(route.path));
            unit.createdTick = created;
            unit.destinationPortId = port.id;
            destination = port;
            break;
          }
        }
        if (!destination) continue;
      }
      const oldX = unit.xMilli,
        oldY = unit.yMilli,
        status = world.move(unit, WORLD_BALANCE.shipSpeedMilli);
      unit.distanceTravelled += Math.abs(oldX - unit.xMilli) + Math.abs(oldY - unit.yMilli);
      if (status === 'blocked') {
        world.removeUnit(unit.id);
        continue;
      }
      if (status === 'arrived') {
        const bonus =
          destination.ownerId !== unit.ownerId && destination.ownerId !== 0
            ? WORLD_BALANCE.alliedTradeBonusBps
            : 10000;
        world.credit(unit.ownerId, Math.floor((unit.cargoGold * bonus) / 10000), unit.id);
        if (destination.ownerId !== unit.ownerId)
          world.credit(destination.ownerId, Math.floor(unit.cargoGold / 4), unit.id);
        world.emit('arrived', unit.id, unit.ownerId, unit.tile);
        world.units.delete(unit.id);
      }
    }
  }
}
