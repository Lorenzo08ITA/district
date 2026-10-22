import type { PlayerState } from '@district/rts-shared';
export interface MutablePlayer extends Omit<PlayerState, 'alliances'> {
  id: number;
  name: string;
  troops: number;
  maxTroops: number;
  gold: number;
  landSize: number;
  cityLevels: number;
  alliances: Set<number>;
  eliminated: boolean;
}
export interface PlayerSetup {
  readonly id: number;
  readonly name: string;
  readonly spawnTile?: number;
  readonly spawnRadius?: number;
  readonly initialTroops?: number;
  readonly initialGold?: number;
  readonly cityLevels?: number;
  readonly alliances?: readonly number[];
}
export interface SerializedPlayer {
  readonly id: number;
  readonly name: string;
  readonly troops: number;
  readonly gold: number;
  readonly cityLevels: number;
  readonly alliances: readonly number[];
}
