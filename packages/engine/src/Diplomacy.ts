import {
  WORLD_BALANCE,
  BuildingKind,
  CommandKind,
  type CommandRejection,
  type GameCommand,
} from '@district/rts-shared';
import type { WorldSystem } from './WorldSystem.js';
export function executeDiplomacy(
  world: WorldSystem,
  command: GameCommand,
): CommandRejection | null {
  if (
    command.kind !== CommandKind.RequestAlliance &&
    command.kind !== CommandKind.AcceptAlliance &&
    command.kind !== CommandKind.BreakAlliance
  )
    return 'UNSUPPORTED_COMMAND';
  const player = world.host.player(command.playerId)!,
    other = world.host.player(command.otherPlayerId);
  if (!other || other.id === player.id || other.eliminated) return 'INVALID_TARGET';
  if (command.kind === CommandKind.RequestAlliance) {
    if (player.alliances.has(other.id)) return 'ALLIED_TARGET';
    world.allianceRequests.set(`${player.id}:${other.id}`, {
      from: player.id,
      to: other.id,
      expiresTick: world.tick + WORLD_BALANCE.allianceRequestTicks,
    });
    return null;
  }
  if (command.kind === CommandKind.AcceptAlliance) {
    if (!world.allianceRequests.has(`${other.id}:${player.id}`)) return 'NO_ALLIANCE_REQUEST';
    world.allianceRequests.delete(`${other.id}:${player.id}`);
    world.allianceRequests.delete(`${player.id}:${other.id}`);
    player.alliances.add(other.id);
    other.alliances.add(player.id);
    world.emit('alliance', 0, player.id, 0);
    return null;
  }
  if (!player.alliances.has(other.id)) return 'INVALID_TARGET';
  player.alliances.delete(other.id);
  other.alliances.delete(player.id);
  player.gold -= Math.floor((player.gold * WORLD_BALANCE.betrayalGoldBps) / 10000);
  world.emit('betrayal', 0, player.id, 0);
  return null;
}
function buildTile(world: WorldSystem, owner: number, coast: boolean): number | undefined {
  const [cx, cy] = world.map.centroid(owner);
  const candidates: number[] = [];
  for (let radius = 0; radius <= 12; radius++)
    for (let dy = -radius; dy <= radius; dy++)
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = Math.floor(cx) + dx,
          y = Math.floor(cy) + dy;
        if (x < 0 || y < 0 || x >= world.map.width || y >= world.map.height) continue;
        const tile = y * world.map.width + x;
        if (
          world.map.ownerId[tile] === owner &&
          world.map.buildingId[tile] === 0 &&
          world.map.contaminationUntil[tile]! <= world.tick &&
          (!coast || world.isCoast(tile))
        )
          candidates.push(tile);
      }
  if (candidates.length) return candidates.sort((a, b) => a - b)[0];
  return [...world.map.borderTiles(owner)]
    .sort((a, b) => a - b)
    .find(
      (t) =>
        world.map.buildingId[t] === 0 &&
        world.map.contaminationUntil[t]! <= world.tick &&
        (!coast || world.isCoast(t)),
    );
}
export function tickBots(world: WorldSystem): void {
  if (world.tick % 10 !== 0) return;
  for (const id of [...world.bots].sort((a, b) => a - b)) {
    const player = world.host.player(id)!;
    if (player.eliminated) continue;
    const request = [...world.allianceRequests.values()]
      .filter((r) => r.to === id)
      .sort((a, b) => a.from - b.from)[0];
    if (request) {
      world.host.issueBotCommand(id, {
        kind: CommandKind.AcceptAlliance,
        otherPlayerId: request.from,
      });
      continue;
    }
    const own = [...world.buildings.values()].filter((b) => b.ownerId === id);
    const danger = [...world.host.playerIds()]
      .filter((p) => p !== id && !player.alliances.has(p))
      .sort((a, b) => world.map.landSize(b) - world.map.landSize(a) || a - b)[0];
    const utility: { kind: BuildingKind; score: number }[] = [
      { kind: BuildingKind.City, score: own.some((b) => b.kind === BuildingKind.City) ? 0 : 80 },
      {
        kind: BuildingKind.Factory,
        score:
          own.some((b) => b.kind === BuildingKind.City) &&
          !own.some((b) => b.kind === BuildingKind.Factory)
            ? 75
            : 0,
      },
      { kind: BuildingKind.Port, score: !own.some((b) => b.kind === BuildingKind.Port) ? 45 : 0 },
      {
        kind: BuildingKind.DefensePost,
        score:
          danger &&
          world.map.landSize(danger) > player.landSize * 2 &&
          !own.some((b) => b.kind === BuildingKind.DefensePost)
            ? 90
            : 0,
      },
    ];
    let built = false;
    for (const candidate of utility.sort((a, b) => b.score - a.score || a.kind - b.kind))
      if (candidate.score > 0 && player.gold >= world.buildCost(id, candidate.kind)) {
        const tile = buildTile(world, id, candidate.kind === BuildingKind.Port);
        if (tile !== undefined) {
          world.host.issueBotCommand(id, {
            kind: CommandKind.Build,
            tile,
            building: candidate.kind,
          });
          built = true;
          break;
        }
      }
    if (
      built ||
      world.host.activeAttacksFor(id) + world.transportCount(id) >= 4 ||
      player.troops < 1000
    )
      continue;
    let target: number | undefined,
      best = -Infinity;
    const seen = new Set<number>();
    for (const border of [...world.map.borderTiles(id)].sort((a, b) => a - b))
      for (let direction = 0; direction < 4; direction++) {
        const tile = world.map.neighbor(border, direction);
        if (
          tile < 0 ||
          seen.has(tile) ||
          !world.map.isLand(tile) ||
          world.map.contaminationUntil[tile]! > world.tick
        )
          continue;
        seen.add(tile);
        const owner = world.map.ownerId[tile]!;
        if (owner === id || player.alliances.has(owner)) continue;
        const cost = world.host.tileCost(tile);
        if (cost > player.troops / 4) continue;
        const score = (owner === 0 ? 100000 : owner === danger ? 120000 : 50000) - cost;
        if (score > best || (score === best && tile < (target ?? Infinity))) {
          best = score;
          target = tile;
        }
      }
    if (target !== undefined)
      world.host.issueBotCommand(id, {
        kind: CommandKind.Attack,
        targetTile: target,
        allocationBps: 2500,
      });
  }
}
