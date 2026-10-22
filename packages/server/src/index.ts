import { randomBytes, randomUUID } from 'node:crypto';
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import {
  GameEngine,
  createScenario,
  type EngineSnapshot,
  type MapName,
} from '@district/rts-engine';
import {
  decodeCommands,
  decodeWire,
  encodeCommands,
  encodeWire,
  encodeTileDelta,
  MAX_DELTA_TILES,
  TICK_MS,
  WireKind,
  type GameCommand,
  type TileDelta,
} from '@district/rts-shared';
export interface Identity {
  id: string;
  name: string;
}
export interface Member {
  accountId: string;
  name: string;
  playerId: number;
  withdrawn: boolean;
  result?: MatchResult;
}
export interface SavedRoom {
  id: string;
  code: string;
  host: string;
  members: Member[];
  layout: MapName;
  seed: number;
  bots: number;
  ended: boolean;
  snapshot: EngineSnapshot | null;
}
export interface StoredRoom {
  state: SavedRoom;
  frames: { tick: number; commands: GameCommand[] }[];
}
export interface MatchResult {
  id: string;
  game: 'frontier';
  mode: 'online';
  score: number;
  durationMs: number;
  won: boolean;
  stats: Record<string, number | string | boolean>;
}
export interface RoomStore {
  load(code: string): Promise<StoredRoom | null>;
  save(room: SavedRoom): Promise<void>;
  append(id: string, tick: number, commands: readonly GameCommand[]): Promise<void>;
  result(accountId: string, result: MatchResult): Promise<MatchResult>;
}
interface Room extends Omit<SavedRoom, 'snapshot'> {
  engine: GameEngine | null;
  peers: Set<Peer>;
  pending: { peer: Peer; command: GameCommand }[];
  busy: boolean;
  failed: boolean;
  touched: number;
}
interface Peer {
  socket: WebSocket;
  identity: Identity;
  cookie: string;
  room: Room | null;
  alive: boolean;
  count: number;
  reset: number;
  lastSync: number;
  lastAuth: number;
}
const control = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('create'),
      layout: z.enum(['world','continents', 'archipelago', 'strait']),
      bots: z.number().int().min(0).max(6),
    })
    .strict(),
  z.object({ type: z.literal('join'), code: z.string().regex(/^[A-Z2-9]{6}$/) }).strict(),
  z.object({ type: z.literal('start') }).strict(),
  z.object({ type: z.literal('resync') }).strict(),
  z.object({ type: z.literal('finish') }).strict(),
]);
const send = (peer: Peer, kind: WireKind, data: unknown): void => {
  if (peer.socket.readyState !== WebSocket.OPEN) return;
  if (peer.socket.bufferedAmount > 2 * 1024 * 1024) {
    peer.socket.close(1013, 'Connessione troppo lenta. Riconnetti.');
    return;
  }
  peer.socket.send(encodeWire(kind, data));
};
const fail = (peer: Peer, message: string) =>
  send(peer, WireKind.Control, { type: 'error', message });
export function attachRts(
  http: HttpServer,
  options: {
    origin: string;
    authenticate(cookie: string): Promise<Identity | null>;
    store: RoomStore;
    maxTicks?: number;
  },
) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false });
  const rooms = new Map<string, Room>(),
    peers = new Set<Peer>(),
    loads = new Map<string, Promise<Room | null>>();
  let stopping = false;
  const saved = (room: Room): SavedRoom => ({
    id: room.id,
    code: room.code,
    host: room.host,
    members: room.members,
    layout: room.layout,
    seed: room.seed,
    bots: room.bots,
    ended: room.ended,
    snapshot: room.engine?.snapshot() ?? null,
  });
  const broadcast = (room: Room, kind: WireKind, data: unknown) => {
    for (const peer of room.peers) send(peer, kind, data);
  };
  const lobby = (room: Room) =>
    broadcast(room, WireKind.Control, {
      type: 'lobby',
      code: room.code,
      host: room.host,
      layout: room.layout,
      bots: room.bots,
      started: !!room.engine,
      members: room.members.map((m) => ({
        ...m,
        connected: [...room.peers].some((p) => p.identity.id === m.accountId),
      })),
    });
  const snapshot = (peer: Peer) => {
    const room = peer.room;
    if (!room?.engine) return;
    const member = room.members.find((m) => m.accountId === peer.identity.id)!;
    send(peer, WireKind.Snapshot, {
      snapshot: room.engine.snapshot(),
      playerId: member.playerId,
      code: room.code,
      maxTicks: options.maxTicks ?? null,
      hash: room.engine.stateHash(),
    });
  };
  async function load(code: string): Promise<Room | null> {
    const existing = rooms.get(code);
    if (existing) return existing;
    if (loads.has(code)) return loads.get(code)!;
    const job = (async () => {
      const stored = await options.store.load(code);
      if (!stored) return null;
      const state = stored.state,
        engine = state.snapshot ? GameEngine.fromSnapshot(state.snapshot) : null;
      if (engine)
        for (const frame of stored.frames) {
          if (frame.tick !== engine.currentTick + 1) throw new Error('RTS journal gap');
          for (const command of frame.commands) {
            if (!engine.enqueue(command).accepted) throw new Error('RTS journal rejected');
          }
          engine.tick();
        }
      const room: Room = {
        ...state,
        engine,
        peers: new Set(),
        pending: [],
        busy: false,
        failed: false,
        touched: Date.now(),
      };
      rooms.set(code, room);
      return room;
    })();
    loads.set(code, job);
    try {
      return await job;
    } finally {
      loads.delete(code);
    }
  }
  async function settleMember(
    room: Room,
    member: Member,
    abandoned: boolean,
  ): Promise<MatchResult> {
    const engine = room.engine!;
    if (member.result) return member.result;
    const player = engine.getPlayer(member.playerId)!;
    const ranking = [...engine.getPlayers()].sort((a, b) => b.landSize - a.landSize || a.id - b.id);
    const won =
      !abandoned &&
      (engine.winnerId === player.id || (engine.winnerId === null && ranking[0]?.id === player.id));
    const world = engine.getWorldSnapshot();
    const result: MatchResult = {
      id: room.id,
      game: 'frontier',
      mode: 'online',
      score: player.landSize,
      durationMs: engine.elapsedMs,
      won,
      stats: {
        engineVersion: 2,
        ticks: engine.currentTick,
        land: player.landSize,
        troops: player.troops,
        gold: player.gold,
        buildings: world.buildings.filter((b) => b.ownerId === player.id).length,
        ships: world.units.filter((u) => u.ownerId === player.id).length,
        alliances: player.alliances.size,
        map: room.layout,
        abandoned,
      },
    };
    // The result ID is stable across retries, reconnects and server recovery.
    const persisted = await options.store.result(member.accountId, result);
    member.withdrawn = true;
    member.result = persisted;
    await options.store.save(saved(room));
    return persisted;
  }
  async function settle(peer: Peer, abandoned: boolean): Promise<void> {
    const room = peer.room;
    if (!room?.engine) return;
    const member = room.members.find((m) => m.accountId === peer.identity.id)!;
    const result = await settleMember(room, member, abandoned);
    send(peer, WireKind.Control, { type: 'result', result });
  }

  async function handleControl(peer: Peer, value: unknown) {
    const message = control.parse(value);
    if (message.type === 'create' || message.type === 'join') {
      if (peer.room) throw new Error('Sei già in una lobby');
      if (rooms.size >= 32) throw new Error('Server pieno. Riprova più tardi.');
      let room: Room | null;
      if (message.type === 'create') {
        let code: string;
        do {
          code = Array.from(randomBytes(6), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join(
            '',
          );
        } while (rooms.has(code) || (await options.store.load(code)));
        room = {
          id: randomUUID(),
          code,
          host: peer.identity.id,
          members: [],
          layout: message.layout,
          seed: randomBytes(4).readUInt32LE(),
          bots: message.bots,
          ended: false,
          engine: null,
          peers: new Set(),
          pending: [],
          busy: false,
          failed: false,
          touched: Date.now(),
        };
        rooms.set(code, room);
      } else room = await load(message.code);
      if (!room) throw new Error('Codice lobby inesistente');
      const deadline = Date.now() + 5000;
      while (room.busy && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 10));
      if (room.busy || room.failed) throw new Error('Lobby occupata. Riprova.');
      if ([...room.peers].some((p) => p.identity.id === peer.identity.id))
        throw new Error('Account già collegato. Usa un altro account per il secondo giocatore.');
      let member = room.members.find((m) => m.accountId === peer.identity.id);
      if (!member) {
        if (room.engine || room.ended) throw new Error('Partita già iniziata');
        if (room.members.length >= 6) throw new Error('Lobby piena');
        member = {
          accountId: peer.identity.id,
          name: peer.identity.name.slice(0, 32),
          playerId: room.members.length + 1,
          withdrawn: false,
        };
        room.members.push(member);
      }
      room.busy = true;
      try {
        await options.store.save(saved(room));
      } finally {
        room.busy = false;
      }
      peer.room = room;
      room.peers.add(peer);
      room.touched = Date.now();
      lobby(room);
      snapshot(peer);
      if (room.ended || member.withdrawn) await settle(peer, member.withdrawn && !room.ended);
      return;
    }
    const room = peer.room;
    if (!room) throw new Error('Entra prima in una lobby');
    const deadline = Date.now() + 5000;
    while (room.busy && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    if (room.busy || room.failed) throw new Error('Operazione in corso. Riprova.');
    if (message.type === 'resync') {
      if (Date.now() - peer.lastSync < 2000) return;
      peer.lastSync = Date.now();
      snapshot(peer);
      return;
    }
    if (message.type === 'start') {
      if (room.host !== peer.identity.id || room.engine)
        throw new Error('Solo il creatore può avviare');
      if (room.members.length + room.bots < 2)
        throw new Error('Invita un giocatore oppure aggiungi bot');
      const names = room.members.map((m) => m.name),
        ids: number[] = [];
      for (let i = 0; i < room.bots; i++) {
        ids.push(names.length + 1);
        names.push('Nazione ' + (i + 1));
      }
      room.busy = true;
      try {
        room.engine = createScenario(room.seed, names, ids, room.layout);
        await options.store.save(saved(room));
        lobby(room);
        for (const p of room.peers) snapshot(p);
      } catch (error) {
        room.engine = null;
        throw error;
      } finally {
        room.busy = false;
      }
      return;
    }
    if (message.type === 'finish') {
      room.busy = true;
      try {
        await settle(peer, !room.ended);
        if (room.members.every((m) => m.withdrawn)) {
          room.ended = true;
          await options.store.save(saved(room));
        }
      } finally {
        room.busy = false;
      }
    }
  }
  async function tickRoom(room: Room) {
    const engine = room.engine;
    if (
      room.busy ||
      room.failed ||
      room.ended ||
      !engine ||
      ![...room.peers].some(
        (p) => !room.members.find((m) => m.accountId === p.identity.id)?.withdrawn,
      )
    )
      return;
    room.busy = true;
    try {
      const pending = room.pending.splice(0),
        accepted: GameCommand[] = [];
      // Dry-run admission on a clone only when inputs exist. Failed journal writes never advance the live engine.
      const admission = pending.length ? GameEngine.fromSnapshot(engine.snapshot()) : engine;
      for (const { peer, command } of pending) {
        const member = room.members.find((m) => m.accountId === peer.identity.id);
        if (!member || member.withdrawn) continue;
        const scheduled = {
          ...command,
          playerId: member.playerId,
          executeTick: engine.currentTick + 1,
        };
        const result = admission.enqueue(scheduled);
        if (result.accepted) accepted.push(scheduled);
        else fail(peer, result.reason);
      }
      await options.store.append(room.id, engine.currentTick + 1, accepted);
      for (const command of accepted) {
        if (!engine.enqueue(command).accepted) throw new Error('Admission mismatch');
      }
      const result = engine.tick(),
        hash = engine.currentTick % 10 === 0 ? engine.stateHash() : null;
      broadcast(room, WireKind.Tick, {
        tick: result.tick,
        commands: new Uint8Array(encodeCommands(accepted)),
        hash,
        events: result.events,
        remaining:
          options.maxTicks === undefined ? null : Math.max(0, options.maxTicks - result.tick),
      });
      // Deltas are independent, bounded packets; clients compare them with their Worker replica.
      for (let start = 0; start < result.dirtyTiles.length; start += MAX_DELTA_TILES) {
        const indices = result.dirtyTiles.slice(start, start + MAX_DELTA_TILES).sort(),
          map = engine.map;
        const delta: TileDelta = {
          tick: result.tick,
          stateHash: hash ?? 0,
          indices,
          terrain: Uint8Array.from(indices, (i) => map.terrainType[i]!),
          elevation: Uint8Array.from(indices, (i) => map.elevation[i]!),
          owners: Uint16Array.from(indices, (i) => map.ownerId[i]!),
          borders: Uint8Array.from(indices, (i) => map.isBorder[i]!),
          buildings: Uint32Array.from(indices, (i) => map.buildingId[i]!),
          coverage: Uint8Array.from(indices, (i) => map.defenseCoverage[i]!),
          contaminationUntil: Uint32Array.from(indices, (i) => map.contaminationUntil[i]!),
        };
        broadcast(room, WireKind.TileDelta, new Uint8Array(encodeTileDelta(delta)));
      }
      if (
        engine.winnerId !== null ||
        (options.maxTicks !== undefined && engine.currentTick >= options.maxTicks)
      ) {
        room.ended = true;
        await options.store.save(saved(room));
        for (const member of room.members) {
          const result = await settleMember(room, member, false);
          for (const peer of room.peers)
            if (peer.identity.id === member.accountId)
              send(peer, WireKind.Control, { type: 'result', result });
        }
      } else if (engine.currentTick % 100 === 0) await options.store.save(saved(room));
      room.touched = Date.now();
    } catch (error) {
      room.failed = true;
      console.error('rts_tick_failed', room.id, error);
      broadcast(room, WireKind.Control, {
        type: 'error',
        message: 'Salvataggio non disponibile. Partita sospesa; riconnetti per riprendere.',
      });
      for (const p of room.peers) p.socket.close(1011, 'Persistenza non disponibile');
      rooms.delete(room.code);
    } finally {
      room.busy = false;
    }
  }
  const timer = setInterval(() => {
    for (const room of rooms.values()) {
      void tickRoom(room);
      if (!room.peers.size && !room.busy && Date.now() - room.touched > 300000)
        rooms.delete(room.code);
    }
  }, TICK_MS);
  const heartbeat = setInterval(() => {
    for (const peer of peers) {
      if (!peer.alive) {
        peer.socket.terminate();
        continue;
      }
      peer.alive = false;
      peer.socket.ping();
      if (Date.now() - peer.lastAuth > 60000) {
        peer.lastAuth = Date.now();
        void options
          .authenticate(peer.cookie)
          .then((identity) => {
            if (!identity || identity.id !== peer.identity.id)
              peer.socket.close(1008, 'Sessione scaduta');
          })
          .catch(() => peer.socket.close(1011, 'Autenticazione non disponibile'));
      }
    }
  }, 30000);
  const upgrade = (
    request: IncomingMessage,
    socket: import('node:stream').Duplex,
    head: Buffer,
  ) => {
    if (new URL(request.url ?? '/', options.origin).pathname !== '/rts/socket') return;
    if (stopping || request.headers.origin !== options.origin || peers.size >= 256) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    const timeout = setTimeout(() => socket.destroy(), 5000);
    void options
      .authenticate(request.headers.cookie ?? '')
      .then((identity) => {
        clearTimeout(timeout);
        if (!identity || socket.destroyed) {
          socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
          return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => {
          const peer: Peer = {
            socket: ws,
            identity,
            cookie: request.headers.cookie ?? '',
            room: null,
            alive: true,
            count: 0,
            reset: Date.now() + 1000,
            lastSync: 0,
            lastAuth: Date.now(),
          };
          peers.add(peer);
          send(peer, WireKind.Control, { type: 'ready', accountId: identity.id });
          ws.on('pong', () => {
            peer.alive = true;
          });
          let handling = false;
          ws.on('message', (data, isBinary) => {
            if (!isBinary || handling) {
              fail(peer, 'Richiesta non valida o in corso');
              return;
            }
            const now = Date.now();
            if (now > peer.reset) {
              peer.reset = now + 1000;
              peer.count = 0;
            }
            if (++peer.count > 20) {
              ws.close(1008, 'Troppe richieste');
              return;
            }
            try {
              const packet = decodeWire(data as Buffer);
              if (packet.kind === WireKind.Commands) {
                const room = peer.room,
                  member = room?.members.find((m) => m.accountId === peer.identity.id);
                if (!room?.engine || room.ended || room.failed || member?.withdrawn)
                  throw new Error('Partita non attiva');
                const commands = decodeCommands(packet.value as Uint8Array);
                if (commands.length !== 1 || room.pending.length >= 128)
                  throw new Error('Troppi comandi');
                const command = commands[0]!;
                if (command.playerId !== member?.playerId)
                  throw new Error('Identità comando non valida');
                room.pending.push({ peer, command });
              } else if (packet.kind === WireKind.Control) {
                handling = true;
                void handleControl(peer, packet.value)
                  .catch((error) =>
                    fail(
                      peer,
                      error instanceof z.ZodError
                        ? 'Messaggio non valido'
                        : error instanceof Error
                          ? error.message
                          : 'Errore server',
                    ),
                  )
                  .finally(() => {
                    handling = false;
                  });
              } else throw new Error('Tipo pacchetto non consentito');
            } catch (error) {
              fail(peer, error instanceof Error ? error.message : 'Pacchetto non valido');
            }
          });
          ws.on('error', () => {});
          ws.on('close', () => {
            peers.delete(peer);
            if (peer.room) {
              peer.room.peers.delete(peer);
              peer.room.touched = Date.now();
              lobby(peer.room);
            }
          });
        });
      })
      .catch(() => {
        clearTimeout(timeout);
        socket.destroy();
      });
  };
  http.on('upgrade', upgrade);
  return {
    revoke(cookie: string) {
      for (const peer of peers)
        if (peer.cookie === cookie) peer.socket.close(1008, 'Sessione terminata');
    },
    async close() {
      stopping = true;
      clearInterval(timer);
      clearInterval(heartbeat);
      http.off('upgrade', upgrade);
      for (const peer of peers) peer.socket.close(1001, 'Server in riavvio');
      for (const room of rooms.values()) {
        while (room.busy) await new Promise((resolve) => setTimeout(resolve, 10));
        if (!room.failed) await options.store.save(saved(room));
      }
      wss.close();
    },
  };
}
