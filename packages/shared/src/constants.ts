export const SIMULATION_HZ = 10;
export const TICK_MS = 1000 / SIMULATION_HZ;
export const PROTOCOL_VERSION = 2;
export const PROTOCOL_MAGIC = 0x32535452;
export const MAX_PLAYERS = 64;
export const MAX_MAP_SIDE = 4096;
export const MAX_MAP_TILES = 4_194_304;
export const MAX_RESOURCE = 1_000_000_000_000;
export const MAX_PACKET_BYTES = 1_048_576;
export const MAX_COMMANDS_PER_PACKET = 4096;
export const MAX_DELTA_TILES = 50_000;
export const UINT32_MAX = 0xffff_ffff;

export const BALANCE = Object.freeze({
  baseTroopsPerTile: 5_000,
  troopsPerCityLevel: 250_000,
  initialTroops: 20_000,
  initialGold: 500_000,
  growthBasisPointsPerTick: 12,
  baseTileCost: 100,
  defenseCostMultiplier: 5,
  defenseWorkMultiplier: 3,
  attackWorkPerTick: 12,
  minAttackBasisPoints: 1_000,
  maxAttackBasisPoints: 10_000,
  maxAttacksPerPlayer: 4,
  maxQueuedCommands: 4096,
  maxQueuedCommandsPerPlayer: 64,
  maxInputLeadTicks: 50,
  victoryPercent: 80,
  transportMaxBasisPoints: 2_000,
  factoryStationRadius: 100,
  factoryProbabilityDivisor: 15,
  defenseRadius: 30,
  defenseBaseGold: 50_000,
  defenseGoldIncrement: 50_000,
  defenseMaxGold: 250_000,
  warshipHp: 1_000,
  warshipDamage: 250,
  siloCooldownTicks: 90,
  atomGold: 750_000,
  atomInnerRadius: 12,
  atomOuterRadius: 30,
  hydrogenGold: 5_000_000,
  hydrogenInnerRadius: 80,
  hydrogenOuterRadius: 100,
  mirvBaseGold: 25_000_000,
  mirvGoldIncrement: 15_000_000,
  mirvMaxWarheads: 350,
  samBaseRadius: 70,
  samMaxRadius: 150,
  samCooldownTicks: 90,
});
