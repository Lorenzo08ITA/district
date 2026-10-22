import { GameEngine, createScenario } from '@district/rts-engine';
import { decodeCommands, decodeTileDelta, TICK_MS } from '@district/rts-shared';
import {
  PLAYER_COLORS,
  type WorkerRequest,
  type WorkerResponse,
  type RenderFrame,
} from './messages.js';
import { TerritoryLabels } from './territoryLabels.js';
interface Scope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
}
const scope = self as unknown as Scope;
let engine: GameEngine | null = null,
  playerId = 1,
  online = false,
  timer: ReturnType<typeof setInterval> | null = null,
  paused = false;
let labels: TerritoryLabels | null = null;
function stop() {
  if (timer !== null) clearInterval(timer);
  timer = null;
}
function publish(
  indices: Uint32Array,
  events: RenderFrame['events'] = [],
  hash: number | null = null,
) {
  if (!engine) return;
  const map = engine.map;
  if (!labels) labels = new TerritoryLabels(map.width, map.height);
  if (engine.currentTick % 10 === 0 || indices.length === map.length) labels.refresh(map.ownerId);
  const colors = new Uint8Array(indices.length * 4),
    owners = new Uint16Array(indices.length),
    terrain = new Uint8Array(indices.length),
    coverage = new Uint8Array(indices.length),
    buildings = new Uint32Array(indices.length);
  for (let n = 0; n < indices.length; n++) {
    const i = indices[n]!,
      owner = map.ownerId[i]!,
      t = map.terrainType[i]!,
      h = map.elevation[i]!,
      border = map.isBorder[i] !== 0;
    owners[n] = owner;
    terrain[n] = t;
    coverage[n] = map.defenseCoverage[i]!;
    buildings[n] = map.buildingId[i]!;
    const base = PLAYER_COLORS[owner % PLAYER_COLORS.length]!,
      shade = (border && owner ? 0.65 : 0.88) + (h / 255) * 0.22;
    let r = t === 0 ? 16 : t === 1 ? 24 : t === 2 ? 155 : Math.round(base[0] * shade),
      g = t === 0 ? 41 : t === 1 ? 68 : t === 2 ? 151 : Math.round(base[1] * shade),
      b = t === 0 ? 58 : t === 1 ? 83 : t === 2 ? 121 : Math.round(base[2] * shade);
    if (owner) {
      r = Math.round(base[0] * shade);
      g = Math.round(base[1] * shade);
      b = Math.round(base[2] * shade);
    } else if (t >= 4) {
      r += 20;
      g += 17;
      b += 18;
    }
    if (map.contaminationUntil[i]! > engine.currentTick) {
      r = 117;
      g = 102;
      b = 146;
    }
    colors[n * 4] = r;
    colors[n * 4 + 1] = g;
    colors[n * 4 + 2] = b;
    colors[n * 4 + 3] = t < 2 ? 0 : 255;
  }
  const frame: RenderFrame = {
    type: 'frame',
    tick: engine.currentTick,
    width: map.width,
    height: map.height,
    playerId,
    indices,
    colors,
    owners,
    terrain,
    coverage,
    buildings,
    players: engine
      .getPlayers()
      .map((p) => ({
        ...p,
        alliances: [...p.alliances],
        center: labels!.get(p.id, map.centroid(p.id)),
      })),
    world: engine.getWorldSnapshot(),
    attacks: engine.getAttacks(),
    events,
    hash,
    winnerId: engine.winnerId,
    sequence: engine.nextCommandSequence(playerId),
  };
  scope.postMessage(frame, [
    indices.buffer,
    colors.buffer,
    owners.buffer,
    terrain.buffer,
    coverage.buffer,
    buildings.buffer,
  ]);
}
function full() {
  if (engine)
    publish(
      Uint32Array.from({ length: engine.map.length }, (_, i) => i),
      [],
      engine.stateHash(),
    );
}
function desync(message: string) {
  paused = true;
  scope.postMessage({ type: 'desync', message });
}
scope.onmessage = (event) => {
  try {
    const message = event.data;
    switch (message.type) {
      case 'offline':
        stop();
        labels = null;
        online = false;
        paused = false;
        playerId = 1;
        engine = message.snapshot
          ? GameEngine.fromSnapshot(message.snapshot)
          : createScenario(
              message.seed,
              ['Tu', 'Aster', 'Marea', 'Vega'],
              [2, 3, 4],
              message.layout,
            );
        full();
        timer = setInterval(() => {
          if (!engine || paused || engine.winnerId !== null) return;
          try {
            const result = engine.tick();
            publish(result.dirtyTiles, result.events);
          } catch (error) {
            stop();
            scope.postMessage({
              type: 'error',
              message: error instanceof Error ? error.message : 'Errore simulazione',
            });
          }
        }, TICK_MS);
        break;
      case 'snapshot':
        stop();
        labels = null;
        online = true;
        paused = false;
        playerId = message.playerId;
        engine = GameEngine.fromSnapshot(message.snapshot);
        if (engine.stateHash() !== message.hash) throw new Error('Snapshot checksum mismatch');
        full();
        break;
      case 'tick':
        if (!engine || !online || paused) return;
        if (message.frame.tick !== engine.currentTick + 1) {
          desync('Tick mancante. Sincronizzazione…');
          return;
        }
        for (const command of decodeCommands(message.frame.commands)) {
          if (!engine.enqueue(command).accepted) {
            desync('Comando divergente. Sincronizzazione…');
            return;
          }
        }
        {
          const result = engine.tick(),
            hash = message.frame.hash === null ? null : engine.stateHash();
          if (hash !== message.frame.hash) {
            desync('Stato divergente. Sincronizzazione…');
            return;
          }
          publish(result.dirtyTiles, result.events, hash);
        }
        break;
      case 'command':
        if (!engine || online || paused) return;
        {
          const result = engine.enqueue({
            ...message.command,
            playerId,
            sequence: engine.nextCommandSequence(playerId),
            executeTick: engine.currentTick + 1,
          });
          if (!result.accepted) scope.postMessage({ type: 'error', message: result.reason });
        }
        break;
      case 'delta':
        if (!engine || !online || paused) return;
        {
          const delta = decodeTileDelta(message.data);
          if (delta.tick !== engine.currentTick) return;
          for (let n = 0; n < delta.indices.length; n++) {
            const i = delta.indices[n]!;
            if (
              engine.map.ownerId[i] !== delta.owners[n] ||
              engine.map.buildingId[i] !== delta.buildings[n] ||
              engine.map.terrainType[i] !== delta.terrain[n] ||
              engine.map.isBorder[i] !== delta.borders[n]
            ) {
              desync('Delta divergente. Sincronizzazione…');
              break;
            }
          }
        }
        break;
      case 'pause':
        if (!online) paused = message.paused;
        break;
      case 'save':
        if (engine)
          scope.postMessage({
            type: 'save',
            requestId: message.requestId,
            snapshot: engine.snapshot(),
          });
        break;
      case 'stop':
        stop();
        engine = null;
        labels = null;
        break;
    }
  } catch (error) {
    stop();
    scope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Errore Worker',
    });
  }
};
