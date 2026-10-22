export enum TerrainType {
  DeepWater = 0,
  ShallowWater = 1,
  Coast = 2,
  Plains = 3,
  Hills = 4,
  Mountains = 5,
}
export enum BorderMask {
  North = 1,
  East = 2,
  South = 4,
  West = 8,
}
export enum BuildingKind {
  City = 1,
  Factory = 2,
  Port = 3,
  DefensePost = 4,
  MissileSilo = 5,
  SamLauncher = 6,
}
export enum UnitKind {
  Train = 1,
  TradeShip = 2,
  TransportShip = 3,
  Warship = 4,
  Missile = 5,
  Interceptor = 6,
}
export enum WeaponKind {
  Atom = 1,
  Hydrogen = 2,
  Mirv = 3,
}
export enum CommandKind {
  Attack = 1,
  CancelAttack = 2,
  Build = 3,
  Upgrade = 4,
  Transport = 5,
  Patrol = 6,
  LaunchNuke = 7,
  RequestAlliance = 8,
  AcceptAlliance = 9,
  BreakAlliance = 10,
  ProduceWarship = 11,
}
export enum PacketKind {
  Commands = 1,
  TileDelta = 2,
}
export type PlayerId = number;
export type TileIndex = number;
export type EntityId = number;
export interface PlayerState {
  readonly id: PlayerId;
  readonly name: string;
  readonly troops: number;
  readonly maxTroops: number;
  readonly gold: number;
  readonly landSize: number;
  readonly cityLevels: number;
  readonly alliances: ReadonlySet<PlayerId>;
  readonly eliminated: boolean;
}
export interface TileDelta {
  readonly tick: number;
  readonly stateHash: number;
  readonly indices: Uint32Array;
  readonly terrain: Uint8Array;
  readonly elevation: Uint8Array;
  readonly owners: Uint16Array;
  readonly borders: Uint8Array;
  readonly buildings: Uint32Array;
  readonly coverage: Uint8Array;
  readonly contaminationUntil?: Uint32Array;
}
export type CommandRejection =
  | 'UNKNOWN_PLAYER'
  | 'ELIMINATED'
  | 'STALE_TICK'
  | 'TICK_TOO_FAR'
  | 'DUPLICATE_SEQUENCE'
  | 'QUEUE_FULL'
  | 'UNSUPPORTED_COMMAND'
  | 'INVALID_TILE'
  | 'OWN_TERRITORY'
  | 'ALLIED_TARGET'
  | 'NOT_ADJACENT'
  | 'INSUFFICIENT_TROOPS'
  | 'ATTACK_LIMIT'
  | 'UNKNOWN_ATTACK'
  | 'MATCH_FINISHED'
  | 'NOT_OWNER'
  | 'OCCUPIED'
  | 'CONTAMINATED'
  | 'NOT_COASTAL'
  | 'INSUFFICIENT_GOLD'
  | 'ENTITY_LIMIT'
  | 'UNKNOWN_BUILDING'
  | 'MAX_LEVEL'
  | 'NO_PATH'
  | 'PATH_BUDGET'
  | 'NO_COAST'
  | 'UNKNOWN_UNIT'
  | 'INVALID_TARGET'
  | 'COOLDOWN'
  | 'NO_AMMUNITION'
  | 'NO_ALLIANCE_REQUEST';
export type EngineEvent =
  | {
      readonly kind: 'commandRejected';
      readonly playerId: number;
      readonly sequence: number;
      readonly reason: CommandRejection;
    }
  | {
      readonly kind: 'attackStarted';
      readonly attackId: number;
      readonly playerId: number;
      readonly targetOwnerId: number;
      readonly troops: number;
    }
  | {
      readonly kind: 'attackEnded';
      readonly attackId: number;
      readonly playerId: number;
      readonly captured: number;
      readonly refunded: number;
    }
  | { readonly kind: 'playerEliminated'; readonly playerId: number }
  | { readonly kind: 'victory'; readonly playerId: number }
  | {
      readonly kind: 'world';
      readonly action:
        | 'built'
        | 'upgraded'
        | 'destroyed'
        | 'spawned'
        | 'arrived'
        | 'captured'
        | 'launched'
        | 'intercepted'
        | 'detonated'
        | 'alliance'
        | 'betrayal'
        | 'pathLimited';
      readonly entityId: number;
      readonly playerId: number;
      readonly tile: number;
    }
  | {
      readonly kind: 'income';
      readonly playerId: number;
      readonly amount: number;
      readonly sourceId: number;
    };
export interface TickResult {
  readonly tick: number;
  readonly elapsedMs: number;
  readonly dirtyTiles: Uint32Array;
  readonly events: readonly EngineEvent[];
  readonly winnerId: number | null;
}
export const isLand = (terrain: TerrainType | number): boolean => terrain >= TerrainType.Coast;
/** Sparse entity state; tile storage remains exclusively in GameMap TypedArrays. */
export interface BuildingState {
  readonly id: EntityId;
  readonly kind: BuildingKind;
  ownerId: PlayerId;
  readonly tile: TileIndex;
  level: number;
  hp: number;
  cooldownTicks: number;
  ammunition: number;
}
export interface RailConnection {
  readonly id: EntityId;
  readonly fromBuildingId: EntityId;
  readonly toBuildingId: EntityId;
  readonly tiles: Uint32Array;
}
export interface MovingUnitState {
  readonly id: EntityId;
  ownerId: PlayerId;
  tile: TileIndex;
  hp: number;
  path: Uint32Array;
  pathCursor: number;
  /** Integer sub-tile progress; 0..9999, avoiding frame-time integration. */
  progressBps: number;
}
export interface TrainState extends MovingUnitState {
  readonly kind: UnitKind.Train;
  readonly originBuildingId: EntityId;
  readonly destinationBuildingId: EntityId;
  readonly visitedStationIds: Set<EntityId>;
}
export interface TradeShipState extends MovingUnitState {
  readonly kind: UnitKind.TradeShip;
  readonly originPortId: EntityId;
  destinationPortId: EntityId;
  cargoGold: number;
  distanceTravelled: number;
}
export interface TransportShipState extends MovingUnitState {
  readonly kind: UnitKind.TransportShip;
  readonly landingTile: TileIndex;
  troops: number;
}
export interface WarshipState extends MovingUnitState {
  readonly kind: UnitKind.Warship;
  patrolTile: TileIndex;
  targetId: EntityId | null;
  cooldownTicks: number;
  experience: number;
}
export interface MissileState {
  readonly id: EntityId;
  readonly kind: UnitKind.Missile;
  readonly ownerId: PlayerId;
  readonly weapon: WeaponKind;
  readonly originTile: TileIndex;
  readonly targetTile: TileIndex;
  readonly targetPlayerId: PlayerId | null;
  readonly flightTicks: number;
  elapsedTicks: number;
  phase: 'ascent' | 'descent';
  readonly parentId: EntityId | null;
}
export interface InterceptorState {
  readonly id: EntityId;
  readonly kind: UnitKind.Interceptor;
  readonly ownerId: PlayerId;
  readonly originTile: TileIndex;
  readonly targetMissileId: EntityId;
  readonly flightTicks: number;
  elapsedTicks: number;
}
export type UnitState =
  TrainState | TradeShipState | TransportShipState | WarshipState | MissileState | InterceptorState;
