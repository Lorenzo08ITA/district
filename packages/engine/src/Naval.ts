import {
  BALANCE,
  WORLD_BALANCE,
  BuildingKind,
  CommandKind,
  UnitKind,
  type CommandRejection,
  type GameCommand,
} from '@district/rts-shared';
import { distanceMilli, integerSqrt } from './Pathfinder.js';
import type { WorldSystem } from './WorldSystem.js';
import type { WorldUnit } from './world-types.js';
export function executeNaval(world: WorldSystem, command: GameCommand): CommandRejection | null {
  const owner = command.playerId,
    p = world.host.player(owner)!;
  if (command.kind === CommandKind.Patrol) {
    const unit = world.units.get(command.shipId);
    if (!unit || unit.kind !== UnitKind.Warship) return 'UNKNOWN_UNIT';
    if (unit.ownerId !== owner) return 'NOT_OWNER';
    if (command.targetTile >= world.map.length || world.map.isLand(command.targetTile))
      return 'INVALID_TILE';
    const result = world.findPath(unit.tile, command.targetTile, {
      mode: 'water',
      smooth: true,
      maxNodes: WORLD_BALANCE.pathNodeBudget,
    });
    if (result.status !== 'found')
      return result.status === 'budget-exceeded' ? 'PATH_BUDGET' : 'NO_PATH';
    if (!world.routeFits(result.path.length, unit.id)) return 'ENTITY_LIMIT';
    const created = unit.createdTick;
    Object.assign(unit, world.motion(result.path));
    unit.createdTick = created;
    unit.patrolTile = command.targetTile;
    return null;
  }
  if (command.kind === CommandKind.ProduceWarship) {
    const port = world.buildings.get(command.portId);
    if (!port || port.kind !== BuildingKind.Port) return 'UNKNOWN_BUILDING';
    if (port.ownerId !== owner) return 'NOT_OWNER';
    if (command.patrolTile >= world.map.length || world.map.isLand(command.patrolTile))
      return 'INVALID_TILE';
    if (!world.canAllocateUnit(owner)) return 'ENTITY_LIMIT';
    if (p.gold < WORLD_BALANCE.warshipGold) return 'INSUFFICIENT_GOLD';
    let path: Uint32Array | null = null;
    let expanded = 0;
    for (const start of world.waterNeighbors(port.tile)) {
      const r = world.findPath(start, command.patrolTile, {
        mode: 'water',
        smooth: true,
        maxNodes: Math.max(1, WORLD_BALANCE.pathNodeBudget - expanded),
      });
      expanded += r.expanded;
      if (r.status === 'budget-exceeded') return 'PATH_BUDGET';
      if (r.status === 'found') {
        path = r.path;
        break;
      }
      if (expanded >= WORLD_BALANCE.pathNodeBudget) return 'PATH_BUDGET';
    }
    if (!path) return 'NO_PATH';
    if (!world.canAllocateUnit(owner, path.length)) return 'ENTITY_LIMIT';
    p.gold -= WORLD_BALANCE.warshipGold;
    const id = world.allocateId();
    world.units.set(id, {
      id,
      kind: UnitKind.Warship,
      ownerId: owner,
      hp: BALANCE.warshipHp,
      ...world.motion(path),
      patrolTile: command.patrolTile,
      targetId: null,
      cooldownTicks: 0,
      experience: 0,
    });
    world.emit('spawned', id, owner, port.tile);
    return null;
  }
  if (command.kind !== CommandKind.Transport) return 'UNSUPPORTED_COMMAND';
  const target = command.targetTile;
  if (target >= world.map.length || !world.map.isLand(target)) return 'INVALID_TILE';
  if (!world.isCoast(target)) return 'NOT_COASTAL';
  if (world.map.contaminationUntil[target]! > world.tick) return 'CONTAMINATED';
  const targetOwner = world.map.ownerId[target]!;
  if (world.friendly(owner, targetOwner) && targetOwner !== 0)
    return targetOwner === owner ? 'OWN_TERRITORY' : 'ALLIED_TARGET';
  if (!world.canAllocateUnit(owner)) return 'ENTITY_LIMIT';
  if (
    world.host.activeAttacksFor(owner) + world.transportCount(owner) >=
    BALANCE.maxAttacksPerPlayer
  )
    return 'ATTACK_LIMIT';
  const troops = Number((BigInt(p.troops) * BigInt(command.allocationBps)) / 10000n);
  if (troops < world.host.tileCost(target)) return 'INSUFFICIENT_TROOPS';
  const coasts = [...world.map.borderTiles(owner)]
    .filter((t) => world.isCoast(t))
    .sort(
      (a, b) =>
        distanceMilli(world.map.width, a, target) - distanceMilli(world.map.width, b, target) ||
        a - b,
    );
  if (!coasts.length) return 'NO_COAST';
  let path: Uint32Array | null = null,
    expanded = 0;
  for (const coast of coasts) {
    const r = world.seaRoute(coast, target);
    expanded += r.expanded;
    if (r.status === 'budget-exceeded') return 'PATH_BUDGET';
    if (r.status === 'found') {
      path = r.path;
      break;
    }
    if (expanded >= WORLD_BALANCE.pathNodeBudget) return 'PATH_BUDGET';
  }
  if (!path) return 'NO_PATH';
  if (!world.canAllocateUnit(owner, path.length)) return 'ENTITY_LIMIT';
  p.troops -= troops;
  const id = world.allocateId();
  world.units.set(id, {
    id,
    kind: UnitKind.TransportShip,
    ownerId: owner,
    hp: 500,
    ...world.motion(path),
    landingTile: target,
    troops,
  });
  world.emit('spawned', id, owner, path[0]!);
  return null;
}
class NavalIndex {
  private readonly buckets = new Map<number, number[]>();
  constructor(world: WorldSystem) {
    for (const unit of world.units.values()) {
      if (unit.kind === UnitKind.Train) continue;
      const key = Math.floor(unit.yMilli / 16000) * 257 + Math.floor(unit.xMilli / 16000);
      const bucket = this.buckets.get(key) ?? [];
      bucket.push(unit.id);
      this.buckets.set(key, bucket);
    }
  }
  query(unit: WorldUnit): number[] {
    const result: number[] = [],
      cx = Math.floor(unit.xMilli / 16000),
      cy = Math.floor(unit.yMilli / 16000);
    for (let y = cy - 1; y <= cy + 1; y++)
      for (let x = cx - 1; x <= cx + 1; x++) result.push(...(this.buckets.get(y * 257 + x) ?? []));
    return result.sort((a, b) => a - b);
  }
}
export function tickNaval(world: WorldSystem): void {
  for (const unit of [...world.units.values()]) {
    if (unit.createdTick === world.tick) continue;
    if (unit.kind === UnitKind.TransportShip) {
      const status = world.move(unit, WORLD_BALANCE.shipSpeedMilli);
      if (status === 'blocked') {
        world.removeUnit(unit.id);
        continue;
      }
      if (status === 'arrived') {
        if (
          world.friendly(unit.ownerId, world.map.ownerId[unit.landingTile]!) &&
          world.map.ownerId[unit.landingTile] !== 0
        ) {
          const p = world.host.player(unit.ownerId)!;
          const cap =
            world.map.landSize(p.id) * BALANCE.baseTroopsPerTile +
            p.cityLevels * BALANCE.troopsPerCityLevel;
          p.troops = Math.min(cap, p.troops + unit.troops);
        } else
          world.host.startLandingAttack(unit.ownerId, unit.landingTile, unit.troops, world.events);
        world.emit('arrived', unit.id, unit.ownerId, unit.landingTile);
        world.units.delete(unit.id);
      }
    }
    if (unit.kind === UnitKind.Warship) {
      world.move(unit, WORLD_BALANCE.warshipSpeedMilli);
      if (unit.cooldownTicks > 0) unit.cooldownTicks--;
      if ((world.tick - unit.createdTick) % 100 === 0) unit.experience++;
    }
  }
  const index = new NavalIndex(world);
  for (const unit of world.units.values())
    if (unit.kind === UnitKind.Warship) {
      let target: WorldUnit | undefined,
        distance = Number.POSITIVE_INFINITY;
      for (const id of index.query(unit)) {
        const candidate = world.units.get(id)!;
        if (candidate.kind === UnitKind.Train || world.friendly(unit.ownerId, candidate.ownerId))
          continue;
        const d = (unit.xMilli - candidate.xMilli) ** 2 + (unit.yMilli - candidate.yMilli) ** 2;
        if (
          d <= WORLD_BALANCE.navalRange ** 2 * 1000000 &&
          (d < distance || (d === distance && candidate.id < (target?.id ?? Infinity)))
        ) {
          target = candidate;
          distance = d;
        }
      }
      unit.targetId = target?.id ?? null;
      if (
        target &&
        unit.cooldownTicks === 0 &&
        world.projectiles.size < WORLD_BALANCE.maxProjectiles
      ) {
        unit.cooldownTicks = WORLD_BALANCE.navalCooldownTicks;
        const id = world.allocateId();
        world.projectiles.set(id, {
          id,
          ownerId: unit.ownerId,
          sourceId: unit.id,
          targetId: target.id,
          xMilli: unit.xMilli,
          yMilli: unit.yMilli,
          expiresTick: world.tick + 30,
        });
      }
    }
  for (const [id, shot] of [...world.projectiles]) {
    const target = world.units.get(shot.targetId);
    if (!target || world.friendly(shot.ownerId, target.ownerId) || world.tick >= shot.expiresTick) {
      world.projectiles.delete(id);
      continue;
    }
    const dx = target.xMilli - shot.xMilli,
      dy = target.yMilli - shot.yMilli,
      distance = integerSqrt(dx * dx + dy * dy);
    if (distance > WORLD_BALANCE.projectileSpeedMilli) {
      shot.xMilli += Math.trunc((dx * WORLD_BALANCE.projectileSpeedMilli) / distance);
      shot.yMilli += Math.trunc((dy * WORLD_BALANCE.projectileSpeedMilli) / distance);
      continue;
    }
    world.projectiles.delete(id);
    const source = world.units.get(shot.sourceId);
    if (target.kind === UnitKind.TradeShip) {
      if (
        [...world.units.values()].filter((u) => u.ownerId === shot.ownerId).length >=
        WORLD_BALANCE.maxUnitsPerPlayer
      )
        continue;
      target.ownerId = shot.ownerId;
      target.destinationPortId = 0;
      world.emit('captured', target.id, target.ownerId, target.tile);
      if (source?.kind === UnitKind.Warship) source.experience += 5;
    } else {
      target.hp -= BALANCE.warshipDamage;
      if (target.hp <= 0) {
        if (source?.kind === UnitKind.Warship) source.experience += 10;
        world.removeUnit(target.id);
      }
    }
  }
}
