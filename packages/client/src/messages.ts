import type { EngineSnapshot, WorldSnapshot, MapName, AttackSnapshot } from '@district/rts-engine';
import type { CommandPayload, EngineEvent, PlayerState } from '@district/rts-shared';
export interface ViewPlayer extends Omit<PlayerState, 'alliances'> {
  alliances: number[];
  center: readonly [number, number];
}
export interface RenderFrame {
  type: 'frame';
  tick: number;
  width: number;
  height: number;
  playerId: number;
  indices: Uint32Array;
  colors: Uint8Array;
  owners: Uint16Array;
  terrain: Uint8Array;
  coverage: Uint8Array;
  buildings: Uint32Array;
  players: ViewPlayer[];
  world: WorldSnapshot;
  attacks: readonly AttackSnapshot[];
  events: readonly EngineEvent[];
  hash: number | null;
  winnerId: number | null;
  sequence: number;
}
export interface TickFrame {
  tick: number;
  commands: Uint8Array;
  hash: number | null;
  remaining: number | null;
}
export type WorkerRequest =
  | { type: 'offline'; seed: number; layout: MapName; snapshot?: EngineSnapshot }
  | { type: 'snapshot'; snapshot: EngineSnapshot; playerId: number; hash: number }
  | { type: 'tick'; frame: TickFrame }
  | { type: 'command'; command: CommandPayload }
  | { type: 'delta'; data: Uint8Array }
  | { type: 'pause'; paused: boolean }
  | { type: 'save'; requestId: number }
  | { type: 'stop' };
export type WorkerResponse =
  | RenderFrame
  | { type: 'error'; message: string }
  | { type: 'desync'; message: string }
  | { type: 'save'; requestId: number; snapshot: EngineSnapshot };
export const PLAYER_COLORS: readonly (readonly [number, number, number])[] = [
  [101, 127, 117],
  [190, 230, 132],
  [109, 170, 228],
  [234, 128, 128],
  [205, 153, 229],
  [238, 192, 102],
  [84, 203, 190],
  [235, 151, 89],
  [137, 159, 232],
  [227, 136, 190],
  [174, 206, 150],
  [213, 184, 147],
  [148, 211, 223],
];
