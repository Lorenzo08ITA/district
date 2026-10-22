import { z } from 'zod';
import {
  BALANCE,
  BUILDING_RULES,
  WORLD_BALANCE,
  BuildingKind,
  UnitKind,
  WeaponKind,
  MAX_RESOURCE,
  UINT32_MAX,
} from '@district/rts-shared';
import { distanceMilli } from './Pathfinder.js';
import type { WorldSystem } from './WorldSystem.js';
import type { WorldSnapshot } from './world-types.js';
export function restoreWorld(world: WorldSystem, input: WorldSnapshot): void {
  const integer = z.number().int().min(0).max(MAX_RESOURCE),
    id = z
      .number()
      .int()
      .min(1)
      .max(UINT32_MAX - 1),
    player = id.refine((v) => !!world.host.player(v)),
    tile = integer.max(world.map.length - 1),
    tick = integer.max(world.tick);
  const path = z.custom<Uint32Array>(
    (v) =>
      v instanceof Uint32Array &&
      v.length > 0 &&
      v.length <= WORLD_BALANCE.pathNodeBudget &&
      v.every((t) => t < world.map.length),
  );
  const motion = {
    id,
    ownerId: player,
    tile,
    hp: integer.min(1).max(BALANCE.warshipHp),
    path,
    pathCursor: integer,
    progressBps: integer.max(9999),
    segmentProgressMilli: integer.max(10_000_000),
    xMilli: integer.max((world.map.width - 1) * 1000),
    yMilli: integer.max((world.map.height - 1) * 1000),
    createdTick: tick,
  };
  const unit = z.discriminatedUnion('kind', [
    z.strictObject({
      ...motion,
      kind: z.literal(UnitKind.Train),
      originBuildingId: id,
      destinationBuildingId: id,
      visitedStationIds: z.set(id).max(WORLD_BALANCE.maxBuildings),
    }),
    z.strictObject({
      ...motion,
      kind: z.literal(UnitKind.TradeShip),
      originPortId: id,
      destinationPortId: integer.max(UINT32_MAX - 1),
      cargoGold: integer,
      distanceTravelled: integer,
    }),
    z.strictObject({
      ...motion,
      kind: z.literal(UnitKind.TransportShip),
      landingTile: tile,
      troops: integer.min(1),
    }),
    z.strictObject({
      ...motion,
      kind: z.literal(UnitKind.Warship),
      patrolTile: tile,
      targetId: id.nullable(),
      cooldownTicks: integer.max(WORLD_BALANCE.navalCooldownTicks),
      experience: integer,
    }),
  ]);
  const missile = z.strictObject({
    id,
    kind: z.literal(UnitKind.Missile),
    ownerId: player,
    weapon: z.enum(WeaponKind),
    originTile: tile,
    targetTile: tile,
    targetPlayerId: player.nullable(),
    flightTicks: integer.min(1).max(10000),
    elapsedTicks: integer.max(10000),
    phase: z.enum(['ascent', 'descent']),
    parentId: id.nullable(),
    siloId: integer.max(UINT32_MAX - 1),
    apexTile: tile,
    xMilli: motion.xMilli,
    yMilli: motion.yMilli,
    altitudeMilli: integer.max(50000),
    createdTick: tick,
  });
  const data = z
    .strictObject({
      version: z.literal(1),
      nextEntityId: id,
      mirvLaunches: integer.max(UINT32_MAX),
      buildings: z
        .array(
          z.strictObject({
            id,
            kind: z.enum(BuildingKind),
            ownerId: z
              .number()
              .int()
              .min(0)
              .max(64)
              .refine((v) => v === 0 || !!world.host.player(v)),
            tile,
            level: integer.min(1).max(10),
            hp: integer.min(1),
            cooldownTicks: integer.max(100),
            ammunition: integer.max(5),
          }),
        )
        .max(WORLD_BALANCE.maxBuildings),
      rails: z
        .array(z.strictObject({ id, fromBuildingId: id, toBuildingId: id, tiles: path }))
        .max(WORLD_BALANCE.maxRails),
      units: z.array(unit).max(WORLD_BALANCE.maxUnits),
      missiles: z.array(missile).max(WORLD_BALANCE.maxMissiles),
      interceptors: z
        .array(
          z.strictObject({
            id,
            kind: z.literal(UnitKind.Interceptor),
            ownerId: player,
            originTile: tile,
            targetMissileId: id,
            flightTicks: integer.min(1).max(10000),
            elapsedTicks: integer,
            xMilli: motion.xMilli,
            yMilli: motion.yMilli,
            createdTick: tick,
          }),
        )
        .max(WORLD_BALANCE.maxMissiles),
      projectiles: z
        .array(
          z.strictObject({
            id,
            ownerId: player,
            sourceId: id,
            targetId: id,
            xMilli: motion.xMilli,
            yMilli: motion.yMilli,
            expiresTick: integer.max(UINT32_MAX),
          }),
        )
        .max(WORLD_BALANCE.maxProjectiles),
      baseCityLevels: z.array(z.tuple([player, integer.max(1_000_000)])).max(64),
      defenseBuilt: z.array(z.tuple([player, integer.max(UINT32_MAX)])).max(64),
      allianceRequests: z
        .array(z.strictObject({ from: player, to: player, expiresTick: integer.max(UINT32_MAX) }))
        .max(4096),
      bots: z.array(player).max(64),
    })
    .parse(input);
  const identities = new Set<number>();
  for (const collection of [
    data.buildings,
    data.rails,
    data.units,
    data.missiles,
    data.interceptors,
    data.projectiles,
  ])
    for (const entity of collection) {
      if (entity.id >= data.nextEntityId || identities.has(entity.id))
        throw new RangeError('Duplicate or future entity ID');
      identities.add(entity.id);
    }
  const buildings = new Map(data.buildings.map((b) => [b.id, b])),
    buildingTiles = new Set<number>(),
    base = new Map(data.baseCityLevels);
  if (
    base.size !== data.baseCityLevels.length ||
    base.size !== world.host.playerIds().length ||
    new Map(data.defenseBuilt).size !== data.defenseBuilt.length ||
    new Set(data.bots).size !== data.bots.length
  )
    throw new RangeError('Invalid world counters');
  const cities = new Map<number, number>(data.baseCityLevels),
    buildingCounts = new Map<number, number>(),
    unitCounts = new Map<number, number>();
  for (const b of data.buildings) {
    if (
      buildingTiles.has(b.tile) ||
      world.map.buildingId[b.tile] !== b.id ||
      world.map.ownerId[b.tile] !== b.ownerId ||
      !world.map.isLand(b.tile) ||
      b.level > BUILDING_RULES[b.kind].maxLevel ||
      b.hp > BUILDING_RULES[b.kind].hp * b.level ||
      (b.kind === BuildingKind.Port && !world.isCoast(b.tile))
    )
      throw new RangeError('Invalid building placement');
    buildingTiles.add(b.tile);
    buildingCounts.set(b.ownerId, (buildingCounts.get(b.ownerId) ?? 0) + 1);
    if (b.ownerId && b.kind === BuildingKind.City)
      cities.set(b.ownerId, (cities.get(b.ownerId) ?? 0) + b.level);
    if (b.kind === BuildingKind.MissileSilo) {
      const inFlight = data.missiles.filter((m) => m.siloId === b.id).length;
      if (b.ammunition + inFlight !== b.level) throw new RangeError('Invalid silo ammunition');
    } else if (b.ammunition !== 0) throw new RangeError('Invalid ammunition');
  }
  for (let t = 0; t < world.map.length; t++)
    if (world.map.buildingId[t] !== 0 && !buildingTiles.has(t))
      throw new RangeError('Orphan map building');
  for (const id of world.host.playerIds())
    if (cities.get(id)! > 1_000_000 + WORLD_BALANCE.maxBuildings * 10)
      throw new RangeError('City level mismatch');
  for (const count of buildingCounts.values())
    if (count > WORLD_BALANCE.maxBuildings) throw new RangeError('Player building limit exceeded');
  if (
    data.rails.reduce((sum, r) => sum + r.tiles.length, 0) > WORLD_BALANCE.maxRailTiles ||
    data.units.reduce((sum, u) => sum + u.path.length, 0) > WORLD_BALANCE.maxUnitPathTiles
  )
    throw new RangeError('World path storage exceeded');
  const railPairs = new Set<string>();
  for (const rail of data.rails) {
    const from = buildings.get(rail.fromBuildingId),
      to = buildings.get(rail.toBuildingId),
      key = `${Math.min(rail.fromBuildingId, rail.toBuildingId)}:${Math.max(rail.fromBuildingId, rail.toBuildingId)}`;
    if (
      !from ||
      !to ||
      from === to ||
      !world.isStation(from) ||
      !world.isStation(to) ||
      rail.tiles[0] !== from.tile ||
      rail.tiles[rail.tiles.length - 1] !== to.tile ||
      railPairs.has(key)
    )
      throw new RangeError('Invalid rail endpoints');
    railPairs.add(key);
    for (let i = 1; i < rail.tiles.length; i++) {
      const a = rail.tiles[i - 1]!,
        b = rail.tiles[i]!;
      if (
        Math.abs((a % world.map.width) - (b % world.map.width)) +
          Math.abs(Math.floor(a / world.map.width) - Math.floor(b / world.map.width)) !==
        1
      )
        throw new RangeError('Disconnected rail');
    }
  }
  for (const u of data.units) {
    if (u.pathCursor >= u.path.length) throw new RangeError('Invalid path cursor');
    const start = u.path[u.pathCursor]!,
      end = u.path[u.pathCursor + 1],
      distance = end === undefined ? 0 : Math.max(1, distanceMilli(world.map.width, start, end));
    if (
      (end === undefined && u.segmentProgressMilli !== 0) ||
      (end !== undefined && u.segmentProgressMilli >= distance)
    )
      throw new RangeError('Invalid segment progress');
    const x =
        (start % world.map.width) * 1000 +
        (end === undefined
          ? 0
          : Math.trunc(
              (((end % world.map.width) - (start % world.map.width)) *
                1000 *
                u.segmentProgressMilli) /
                distance,
            )),
      y =
        Math.floor(start / world.map.width) * 1000 +
        (end === undefined
          ? 0
          : Math.trunc(
              ((Math.floor(end / world.map.width) - Math.floor(start / world.map.width)) *
                1000 *
                u.segmentProgressMilli) /
                distance,
            ));
    if (
      x !== u.xMilli ||
      y !== u.yMilli ||
      u.tile !== Math.floor((y + 500) / 1000) * world.map.width + Math.floor((x + 500) / 1000) ||
      u.progressBps !==
        (end === undefined ? 0 : Math.floor((u.segmentProgressMilli * 10000) / distance))
    )
      throw new RangeError('Inconsistent unit position');
    if ((u.kind === UnitKind.TradeShip || u.kind === UnitKind.TransportShip) && u.hp > 500)
      throw new RangeError('Invalid civilian ship HP');
    unitCounts.set(u.ownerId, (unitCounts.get(u.ownerId) ?? 0) + 1);
    if (u.kind === UnitKind.Warship && u.hp > BALANCE.warshipHp)
      throw new RangeError('Invalid warship HP');
    if (u.kind === UnitKind.Train && u.hp > 100) throw new RangeError('Invalid train HP');
  }
  for (const count of unitCounts.values())
    if (count > WORLD_BALANCE.maxUnitsPerPlayer) throw new RangeError('Player unit limit exceeded');
  for (const m of data.missiles)
    if (
      (m.parentId !== null && m.parentId >= data.nextEntityId) ||
      m.siloId >= data.nextEntityId ||
      m.elapsedTicks > m.flightTicks ||
      (m.weapon === WeaponKind.Mirv) !== (m.phase === 'ascent') ||
      (m.parentId !== null && m.siloId !== 0)
    )
      throw new RangeError('Invalid missile flight');
  const requestKeys = new Set<string>();
  for (const r of data.allianceRequests) {
    const key = `${r.from}:${r.to}`;
    if (r.from === r.to || r.expiresTick <= world.tick || requestKeys.has(key))
      throw new RangeError('Invalid alliance request');
    requestKeys.add(key);
  }
  const copy = structuredClone(data);
  world.nextEntityId = copy.nextEntityId;
  world.mirvLaunches = copy.mirvLaunches;
  const replace = <T>(target: Map<number, T>, values: readonly (T & { id: number })[]) => {
    target.clear();
    for (const value of values) target.set(value.id, value);
  };
  replace(world.buildings, copy.buildings);
  replace(world.rails, copy.rails);
  replace(world.units, copy.units);
  replace(world.missiles, copy.missiles);
  replace(world.interceptors, copy.interceptors);
  replace(world.projectiles, copy.projectiles);
  world.baseCityLevels.clear();
  for (const pair of copy.baseCityLevels) world.baseCityLevels.set(...pair);
  world.defenseBuilt.clear();
  for (const pair of copy.defenseBuilt) world.defenseBuilt.set(...pair);
  world.allianceRequests.clear();
  for (const request of copy.allianceRequests)
    world.allianceRequests.set(`${request.from}:${request.to}`, request);
  world.bots.clear();
  for (const id of copy.bots) world.bots.add(id);
  world.rebuildDerived();
}
