import { GameEngine, GameMap } from '@district/rts-engine';
import {
  CommandKind,
  TerrainType,
  type GameCommand,
  type CommandRejection,
} from '@district/rts-shared';
export type Payload = GameCommand extends infer C
  ? C extends GameCommand
    ? Omit<C, 'playerId' | 'sequence' | 'executeTick'>
    : never
  : never;

export function fixture(water = false, bots: readonly number[] = []) {
  const map = new GameMap(96, 64);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 96; x++) {
      const tile = map.index(x, y);
      if (water && x >= 32 && x < 64) map.setTerrain(tile, TerrainType.DeepWater);
      else if (x < 32) map.setOwner(tile, 1);
      else if (x >= 64) map.setOwner(tile, 2);
    }
  return new GameEngine({
    map,
    seed: 7362,
    players: [
      { id: 1, name: 'Alba', initialGold: 1_000_000_000, initialTroops: 500000 },
      { id: 2, name: 'Vespro', initialGold: 1_000_000_000, initialTroops: 500000 },
    ],
    bots,
  });
}
export function queue(e: GameEngine, payload: Payload, owner = 1) {
  const sequence = e.nextCommandSequence(owner);
  return e.enqueue({
    ...payload,
    playerId: owner,
    sequence,
    executeTick: e.currentTick + 1,
  } as GameCommand);
}
export function send(e: GameEngine, payload: Payload, owner = 1): CommandRejection | null {
  const result = queue(e, payload, owner);
  if (!result.accepted) return result.reason;
  const tick = e.tick();
  const rejected = tick.events.find((v) => v.kind === 'commandRejected' && v.playerId === owner);
  return rejected?.kind === 'commandRejected' ? rejected.reason : null;
}
export function advance(e: GameEngine, ticks: number) {
  for (let i = 0; i < ticks && e.winnerId === null; i++) e.tick();
}
export function building(e: GameEngine, kind: number, owner = 1) {
  return e.getWorldSnapshot().buildings.find((b) => b.kind === kind && b.ownerId === owner)!;
}
export { CommandKind };
