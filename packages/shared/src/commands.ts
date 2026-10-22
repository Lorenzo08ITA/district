import { z } from 'zod';
import { BALANCE, MAX_PLAYERS, UINT32_MAX } from './constants.js';
import { BuildingKind, CommandKind, WeaponKind } from './types.js';
export const uint32Schema = z.number().int().min(0).max(UINT32_MAX);
export const playerIdSchema = z.number().int().min(1).max(MAX_PLAYERS);
const entityIdSchema = uint32Schema.refine((id) => id > 0, 'Entity ID must be positive');
const envelope = { playerId: playerIdSchema, sequence: uint32Schema, executeTick: uint32Schema };
const allocation = z
  .number()
  .int()
  .min(BALANCE.minAttackBasisPoints)
  .max(BALANCE.maxAttackBasisPoints);
export const commandSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...envelope,
    kind: z.literal(CommandKind.ProduceWarship),
    portId: entityIdSchema,
    patrolTile: uint32Schema,
  }),
  z.strictObject({
    ...envelope,
    kind: z.literal(CommandKind.Attack),
    targetTile: uint32Schema,
    allocationBps: allocation,
  }),
  z.strictObject({
    ...envelope,
    kind: z.literal(CommandKind.CancelAttack),
    attackId: entityIdSchema,
  }),
  z.strictObject({
    ...envelope,
    kind: z.literal(CommandKind.Build),
    tile: uint32Schema,
    building: z.enum(BuildingKind),
  }),
  z.strictObject({ ...envelope, kind: z.literal(CommandKind.Upgrade), buildingId: entityIdSchema }),
  z.strictObject({
    ...envelope,
    kind: z.literal(CommandKind.Transport),
    targetTile: uint32Schema,
    allocationBps: allocation.max(BALANCE.transportMaxBasisPoints),
  }),
  z.strictObject({
    ...envelope,
    kind: z.literal(CommandKind.Patrol),
    shipId: entityIdSchema,
    targetTile: uint32Schema,
  }),
  z.strictObject({
    ...envelope,
    kind: z.literal(CommandKind.LaunchNuke),
    siloId: entityIdSchema,
    targetTile: uint32Schema,
    weapon: z.enum(WeaponKind),
  }),
  z.strictObject({
    ...envelope,
    kind: z.literal(CommandKind.RequestAlliance),
    otherPlayerId: playerIdSchema,
  }),
  z.strictObject({
    ...envelope,
    kind: z.literal(CommandKind.AcceptAlliance),
    otherPlayerId: playerIdSchema,
  }),
  z.strictObject({
    ...envelope,
    kind: z.literal(CommandKind.BreakAlliance),
    otherPlayerId: playerIdSchema,
  }),
]);
export type GameCommand = z.infer<typeof commandSchema>;
export type AttackCommand = Extract<GameCommand, { kind: CommandKind.Attack }>;
export function compareCommands(a: GameCommand, b: GameCommand): number {
  return a.executeTick - b.executeTick || a.playerId - b.playerId || a.sequence - b.sequence;
}

type PayloadOf<C> = C extends GameCommand
  ? Omit<C, 'playerId' | 'sequence' | 'executeTick'>
  : never;
export type CommandPayload = PayloadOf<GameCommand>;
