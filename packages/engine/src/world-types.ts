import type {
  BuildingState,
  EngineEvent,
  GameCommand,
  CommandPayload,
  CommandRejection,
  RailConnection,
  TrainState,
  TradeShipState,
  TransportShipState,
  WarshipState,
  MissileState,
  InterceptorState,
} from '@district/rts-shared';
import type { GameMap } from './GameMap.js';
import type { Mulberry32 } from './prng.js';
import type { MutablePlayer } from './state.js';
export interface WorldHost {
  readonly map: GameMap;
  readonly rng: Mulberry32;
  readonly currentTick: number;
  player(id: number): MutablePlayer | undefined;
  playerIds(): readonly number[];
  activeAttacksFor(id: number): number;
  issueBotCommand(playerId: number, command: CommandPayload): void;
  startLandingAttack(
    playerId: number,
    tile: number,
    troops: number,
    events: EngineEvent[],
  ): boolean;
  neutralize(tile: number): void;
  tileCost(tile: number): number;
}
export interface TravelRuntime {
  xMilli: number;
  yMilli: number;
  segmentProgressMilli: number;
  createdTick: number;
}
export type WorldUnit = (TrainState | TradeShipState | TransportShipState | WarshipState) &
  TravelRuntime;
export interface WorldMissile extends MissileState {
  readonly siloId: number;
  readonly apexTile: number;
  xMilli: number;
  yMilli: number;
  altitudeMilli: number;
  readonly createdTick: number;
}
export interface WorldInterceptor extends InterceptorState {
  xMilli: number;
  yMilli: number;
  readonly createdTick: number;
}
export interface NavalProjectile {
  readonly id: number;
  readonly ownerId: number;
  readonly sourceId: number;
  readonly targetId: number;
  xMilli: number;
  yMilli: number;
  readonly expiresTick: number;
}
export interface AllianceRequest {
  readonly from: number;
  readonly to: number;
  readonly expiresTick: number;
}
export interface WorldSnapshot {
  readonly version: 1;
  readonly nextEntityId: number;
  readonly mirvLaunches: number;
  readonly buildings: readonly BuildingState[];
  readonly rails: readonly RailConnection[];
  readonly units: readonly WorldUnit[];
  readonly missiles: readonly WorldMissile[];
  readonly interceptors: readonly WorldInterceptor[];
  readonly projectiles: readonly NavalProjectile[];
  readonly baseCityLevels: readonly (readonly [number, number])[];
  readonly defenseBuilt: readonly (readonly [number, number])[];
  readonly allianceRequests: readonly AllianceRequest[];
  readonly bots: readonly number[];
}
export type WorldCommand = Exclude<GameCommand, { kind: 1 | 2 }>;
export type WorldCommandResult = CommandRejection | null;
