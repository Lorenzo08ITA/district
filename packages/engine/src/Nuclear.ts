import {
  BALANCE,
  WORLD_BALANCE,
  BuildingKind,
  CommandKind,
  UnitKind,
  WeaponKind,
  TerrainType,
  type CommandRejection,
  type GameCommand,
} from '@district/rts-shared';
import { distanceMilli, integerSqrt } from './Pathfinder.js';
import type { WorldSystem } from './WorldSystem.js';
import type { WorldMissile } from './world-types.js';
export function nuclearPrice(weapon: WeaponKind, mirvLaunches: number): number {
  return weapon === WeaponKind.Atom
    ? BALANCE.atomGold
    : weapon === WeaponKind.Hydrogen
      ? BALANCE.hydrogenGold
      : BALANCE.mirvBaseGold + mirvLaunches * BALANCE.mirvGoldIncrement;
}
export function launchNuke(world: WorldSystem, command: GameCommand): CommandRejection | null {
  if (command.kind !== CommandKind.LaunchNuke) return 'UNSUPPORTED_COMMAND';
  const silo = world.buildings.get(command.siloId);
  if (!silo || silo.kind !== BuildingKind.MissileSilo) return 'UNKNOWN_BUILDING';
  if (silo.ownerId !== command.playerId) return 'NOT_OWNER';
  if (command.targetTile >= world.map.length) return 'INVALID_TILE';
  const targetOwner = world.map.ownerId[command.targetTile]!;
  if (targetOwner > 0 && world.friendly(command.playerId, targetOwner))
    return targetOwner === command.playerId ? 'OWN_TERRITORY' : 'ALLIED_TARGET';
  if (command.weapon === WeaponKind.Mirv && targetOwner === 0) return 'INVALID_TARGET';
  if (silo.cooldownTicks > 0) return 'COOLDOWN';
  if (silo.ammunition < 1) return 'NO_AMMUNITION';
  if (world.missiles.size >= WORLD_BALANCE.maxMissiles) return 'ENTITY_LIMIT';
  const p = world.host.player(command.playerId)!,
    cost = nuclearPrice(command.weapon, world.mirvLaunches);
  if (p.gold < cost) return 'INSUFFICIENT_GOLD';
  p.gold -= cost;
  if (command.weapon === WeaponKind.Mirv) world.mirvLaunches++;
  silo.cooldownTicks = BALANCE.siloCooldownTicks;
  silo.ammunition--;
  const apex =
    command.weapon === WeaponKind.Mirv ? silo.tile % world.map.width : command.targetTile;
  const id = world.allocateId(),
    missile: WorldMissile = {
      id,
      kind: UnitKind.Missile,
      ownerId: p.id,
      weapon: command.weapon,
      originTile: silo.tile,
      targetTile: command.targetTile,
      targetPlayerId: targetOwner || null,
      flightTicks: Math.max(
        8,
        Math.ceil(
          distanceMilli(world.map.width, silo.tile, apex) / WORLD_BALANCE.missileSpeedMilli,
        ),
      ),
      elapsedTicks: 0,
      phase: command.weapon === WeaponKind.Mirv ? 'ascent' : 'descent',
      parentId: null,
      siloId: silo.id,
      apexTile: apex,
      xMilli: (silo.tile % world.map.width) * 1000,
      yMilli: Math.floor(silo.tile / world.map.width) * 1000,
      altitudeMilli: 0,
      createdTick: world.tick,
    };
  world.missiles.set(id, missile);
  world.emit('launched', id, p.id, silo.tile);
  return null;
}
function removeMissile(world: WorldSystem, missile: WorldMissile): void {
  world.missiles.delete(missile.id);
  const silo = world.buildings.get(missile.siloId);
  if (silo?.kind === BuildingKind.MissileSilo)
    silo.ammunition = Math.min(silo.level, silo.ammunition + 1);
}
function splitMirv(world: WorldSystem, parent: WorldMissile): void {
  const capacity = Math.min(
      BALANCE.mirvMaxWarheads,
      WORLD_BALANCE.maxMissiles - world.missiles.size + 1,
    ),
    targets: number[] = [];
  let seen = 0;
  for (let tile = 0; tile < world.map.length; tile++)
    if (world.map.ownerId[tile] === parent.targetPlayerId) {
      seen++;
      if (targets.length < capacity) targets.push(tile);
      else {
        const replace = world.host.rng.nextInt(seen);
        if (replace < capacity) targets[replace] = tile;
      }
    }
  removeMissile(world, parent);
  for (const target of targets.sort((a, b) => a - b)) {
    const id = world.allocateId(),
      origin = parent.apexTile;
    const missile: WorldMissile = {
      id,
      kind: UnitKind.Missile,
      ownerId: parent.ownerId,
      weapon: WeaponKind.Atom,
      originTile: origin,
      targetTile: target,
      targetPlayerId: parent.targetPlayerId,
      flightTicks: Math.max(
        8,
        Math.ceil(distanceMilli(world.map.width, origin, target) / WORLD_BALANCE.missileSpeedMilli),
      ),
      elapsedTicks: 0,
      phase: 'descent',
      parentId: parent.id,
      siloId: 0,
      apexTile: target,
      xMilli: (origin % world.map.width) * 1000,
      yMilli: Math.floor(origin / world.map.width) * 1000,
      altitudeMilli: 0,
      createdTick: world.tick,
    };
    world.missiles.set(id, missile);
    world.emit('launched', id, parent.ownerId, origin);
  }
}
function detonate(world: WorldSystem, missile: WorldMissile): void {
  const inner =
    missile.parentId !== null
      ? WORLD_BALANCE.mirvInnerRadius
      : missile.weapon === WeaponKind.Hydrogen
        ? BALANCE.hydrogenInnerRadius
        : BALANCE.atomInnerRadius;
  const outer =
    missile.parentId !== null
      ? WORLD_BALANCE.mirvOuterRadius
      : missile.weapon === WeaponKind.Hydrogen
        ? BALANCE.hydrogenOuterRadius
        : BALANCE.atomOuterRadius;
  const cx = missile.targetTile % world.map.width,
    cy = Math.floor(missile.targetTile / world.map.width),
    loss = new Map<number, { inner: number; outer: number; land: number }>();
  const affected: number[] = [];
  for (let y = Math.max(0, cy - outer); y <= Math.min(world.map.height - 1, cy + outer); y++)
    for (let x = Math.max(0, cx - outer); x <= Math.min(world.map.width - 1, cx + outer); x++) {
      const squared = (x - cx) ** 2 + (y - cy) ** 2;
      if (squared > outer * outer) continue;
      const tile = y * world.map.width + x;
      const owner = world.map.ownerId[tile]!;
      if (owner !== missile.ownerId && owner > 0 && world.friendly(missile.ownerId, owner))
        continue;
      affected.push(tile);
      if (owner) {
        const entry = loss.get(owner) ?? { inner: 0, outer: 0, land: world.map.landSize(owner) };
        if (squared <= inner * inner) entry.inner++;
        else entry.outer++;
        loss.set(owner, entry);
      }
    }
  for (const [owner, count] of loss) {
    const p = world.host.player(owner)!;
    const numerator = BigInt(count.inner * 2 + count.outer);
    const damage = Number((BigInt(p.troops) * numerator) / (BigInt(Math.max(1, count.land)) * 2n));
    p.troops = Math.max(0, p.troops - damage);
  }
  for (const tile of affected) {
    const x = tile % world.map.width,
      y = Math.floor(tile / world.map.width),
      squared = (x - cx) ** 2 + (y - cy) ** 2,
      b = world.buildings.get(world.map.buildingId[tile]!);
    if (squared <= inner * inner) {
      if (b) world.destroyBuilding(b.id);
      if (world.map.isLand(tile)) {
        world.host.neutralize(tile);
        world.map.setElevation(tile, 0);
        world.map.setTerrain(
          tile,
          world.map.terrainType[tile] === TerrainType.Coast
            ? TerrainType.Coast
            : TerrainType.Plains,
        );
        world.contaminate(tile);
      }
    } else if (b) {
      b.hp -= Math.ceil(b.hp / 2);
      if (b.hp <= 0) world.destroyBuilding(b.id);
    }
  }
  for (const unit of [...world.units.values()]) {
    if (unit.ownerId !== missile.ownerId && world.friendly(missile.ownerId, unit.ownerId)) continue;
    const x = unit.tile % world.map.width,
      y = Math.floor(unit.tile / world.map.width),
      squared = (x - cx) ** 2 + (y - cy) ** 2;
    if (squared <= inner * inner) world.removeUnit(unit.id);
    else if (squared <= outer * outer) {
      unit.hp -= Math.ceil(unit.hp / 2);
      if (unit.hp <= 0) world.removeUnit(unit.id);
    }
  }
  removeMissile(world, missile);
  world.emit('detonated', missile.id, missile.ownerId, missile.targetTile);
}
export function tickNuclear(world: WorldSystem): void {
  const impacts: WorldMissile[] = [];
  for (const missile of [...world.missiles.values()]) {
    if (
      missile.targetPlayerId !== null &&
      world.host.player(missile.ownerId)?.alliances.has(missile.targetPlayerId)
    ) {
      removeMissile(world, missile);
      world.emit('destroyed', missile.id, missile.ownerId, missile.targetTile);
      continue;
    }
    if (missile.createdTick === world.tick) continue;
    missile.elapsedTicks++;
    const end = missile.weapon === WeaponKind.Mirv ? missile.apexTile : missile.targetTile,
      t = Math.min(missile.flightTicks, missile.elapsedTicks),
      duration = missile.flightTicks;
    const ox = (missile.originTile % world.map.width) * 1000,
      oy = Math.floor(missile.originTile / world.map.width) * 1000,
      tx = (end % world.map.width) * 1000,
      ty = Math.floor(end / world.map.width) * 1000;
    missile.xMilli = ox + Math.trunc(((tx - ox) * t) / duration);
    missile.yMilli = oy + Math.trunc(((ty - oy) * t) / duration);
    missile.altitudeMilli = Math.floor((4 * t * (duration - t) * 50000) / (duration * duration));
    if (t === duration) impacts.push(missile);
  }
  const missileBuckets = new Map<number, WorldMissile[]>();
  for (const m of world.missiles.values()) {
    if (m.weapon === WeaponKind.Mirv) continue;
    const key = Math.floor(m.yMilli / 64000) * 65 + Math.floor(m.xMilli / 64000),
      bucket = missileBuckets.get(key) ?? [];
    bucket.push(m);
    missileBuckets.set(key, bucket);
  }
  const targeted = new Set([...world.interceptors.values()].map((i) => i.targetMissileId));
  for (const sam of world.buildings.values())
    if (
      sam.kind === BuildingKind.SamLauncher &&
      sam.cooldownTicks === 0 &&
      world.host.player(sam.ownerId) &&
      !world.host.player(sam.ownerId)!.eliminated
    ) {
      const range = Math.min(
          BALANCE.samMaxRadius,
          BALANCE.samBaseRadius + (sam.level - 1) * WORLD_BALANCE.samRadiusPerLevel,
        ),
        x = (sam.tile % world.map.width) * 1000,
        y = Math.floor(sam.tile / world.map.width) * 1000;
      let target: WorldMissile | undefined;
      const cx = Math.floor(x / 64000),
        cy = Math.floor(y / 64000),
        r = Math.ceil(range / 64);
      for (let by = cy - r; by <= cy + r; by++)
        for (let bx = cx - r; bx <= cx + r; bx++)
          for (const m of missileBuckets.get(by * 65 + bx) ?? []) {
            if (
              world.friendly(sam.ownerId, m.ownerId) ||
              targeted.has(m.id) ||
              (m.xMilli - x) ** 2 + (m.yMilli - y) ** 2 > range * range * 1000000
            )
              continue;
            if (
              !target ||
              m.flightTicks - m.elapsedTicks < target.flightTicks - target.elapsedTicks ||
              (m.flightTicks - m.elapsedTicks === target.flightTicks - target.elapsedTicks &&
                m.id < target.id)
            )
              target = m;
          }
      if (!target || world.interceptors.size >= WORLD_BALANCE.maxMissiles) continue;
      const id = world.allocateId();
      sam.cooldownTicks = BALANCE.samCooldownTicks;
      targeted.add(target.id);
      world.interceptors.set(id, {
        id,
        kind: UnitKind.Interceptor,
        ownerId: sam.ownerId,
        originTile: sam.tile,
        targetMissileId: target.id,
        flightTicks: Math.max(
          1,
          Math.ceil(
            integerSqrt((target.xMilli - x) ** 2 + (target.yMilli - y) ** 2) /
              WORLD_BALANCE.interceptorSpeedMilli,
          ),
        ),
        elapsedTicks: 0,
        xMilli: x,
        yMilli: y,
        createdTick: world.tick,
      });
      world.emit('launched', id, sam.ownerId, sam.tile);
    }
  for (const [id, interceptor] of [...world.interceptors]) {
    const target = world.missiles.get(interceptor.targetMissileId);
    if (!target || world.friendly(interceptor.ownerId, target.ownerId)) {
      world.interceptors.delete(id);
      continue;
    }
    interceptor.elapsedTicks++;
    const dx = target.xMilli - interceptor.xMilli,
      dy = target.yMilli - interceptor.yMilli,
      distance = integerSqrt(dx * dx + dy * dy);
    if (distance <= WORLD_BALANCE.interceptorSpeedMilli) {
      removeMissile(world, target);
      world.interceptors.delete(id);
      world.emit('intercepted', target.id, interceptor.ownerId, target.targetTile);
    } else {
      interceptor.xMilli += Math.trunc((dx * WORLD_BALANCE.interceptorSpeedMilli) / distance);
      interceptor.yMilli += Math.trunc((dy * WORLD_BALANCE.interceptorSpeedMilli) / distance);
    }
  }
  for (const missile of impacts)
    if (world.missiles.has(missile.id)) {
      if (missile.weapon === WeaponKind.Mirv) splitMirv(world, missile);
      else detonate(world, missile);
    }
}
