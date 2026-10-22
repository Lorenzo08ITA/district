import type { Game, Result } from '../lib/catalog';
import type { useMultiplayer } from '../lib/multiplayer';
export type EndResult = {
  durationMs?: number;
  score: number;
  won: boolean;
  stats: Record<string, number | string | boolean>;
};
export type GameProps = {
  owner: string;
  game: Game;
  online: boolean;
  network: ReturnType<typeof useMultiplayer>;
  onEnd: (result: EndResult) => void;
  paused: boolean;
  onAuthoritativeResult?: (result: Result) => void;
};
