import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import { encodeWire, decodeWire, WireKind } from '@district/rts-shared';
import {
  ARENA_NAMES,
  HitConfirm,
  PacketReader,
  PacketBufferPool,
  PlayerInput,
  PlayerSnapshot,
  FpsPacketKind,
  type ArenaName,
  type GameMode,
} from '@district/rts-shared/fps';
import { GameRoom, type FpsPlayer } from './GameRoom.js';
export interface FpsResult {
  id: string;
  game: 'crossfire';
  mode: 'online';
  score: number;
  durationMs: number;
  won: boolean;
  stats: Record<string, number | string | boolean>;
}
export interface FpsCheckpoint {
  id: string;
  code: string;
  map: ArenaName;
  mode: GameMode;
  debug: boolean;
  tick: number;
  members: {
    accountId: string;
    runId: string;
    name: string;
    kills: number;
    deaths: number;
    damage: number;
    score: number;
    headshots: number;
    captures: number;
    timeOnPoint: number;
    shots: number;
    finished: boolean;
  }[];
}
export interface FpsStore {
  checkpoint(state: FpsCheckpoint): Promise<void>;
  result(accountId: string, result: FpsResult, verified: boolean): Promise<FpsResult>;
  closeMatch(id: string): Promise<void>;
}
interface Member {
  actor: FpsPlayer;
  accountId: string;
  sessionKey: string;
  runId: string;
  result: FpsResult | null;
}
interface Room {
  id: string;
  code: string;
  host: string;
  core: GameRoom;
  debug: boolean;
  quick: boolean;
  started: boolean;
  members: Map<string, Member>;
  peers: Set<Peer>;
  savedAt: number;
  lastActive: number;
  saving: boolean;
  failed: boolean;
  finishing: boolean;
  closed: boolean;
  snapshot: PlayerSnapshot;
}
interface Peer {
  socket: WebSocket;
  account: { id: string; name: string };
  cookie: string;
  room: Room | null;
  member: Member | null;
  alive: boolean;
  count: number;
  reset: number;
  controlCount: number;
  pingAt: number;
  nonce: string;
  rttMs: number;
  authAt: number;
  reader: PacketReader;
  input: PlayerInput;
  controls: Promise<void>;
  pendingControls: number;
}
const configure = {
  map: z.enum(ARENA_NAMES),
  mode: z.enum(['ffa', 'tdm', 'ctf', 'hardpoint']),
  debug: z.boolean(),
  tabId: z.string().uuid(),
  bots: z.number().int().min(0).max(5),
};
const schema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create'), ...configure }).strict(),
  z.object({ type: z.literal('quick'), ...configure }).strict(),
  z
    .object({
      type: z.literal('join'),
      code: z.string().regex(/^[A-Z2-9]{6}$/),
      debug: z.boolean(),
      tabId: z.string().uuid(),
    })
    .strict(),
  z.object({ type: z.literal('start') }).strict(),
  z.object({ type: z.literal('finish') }).strict(),
  z.object({ type: z.literal('resync') }).strict(),
  z
    .object({
      type: z.literal('bots'),
      count: z.number().int().min(1).max(5),
      reactionMs: z.number().int().min(100).max(2000),
    })
    .strict(),
  z.object({ type: z.literal('pong'), nonce: z.string().max(40) }).strict(),
]);
export function attachFps(
  server: HttpServer,
  options: {
    origin: string;
    authenticate(cookie: string): Promise<{ id: string; name: string } | null>;
    store: FpsStore;
    debugAllowed: boolean;
    maxTicks?: number;
  },
) {
  const rooms = new Map<string, Room>(),
    peers = new Set<Peer>(),
    wss = new WebSocketServer({ noServer: true, maxPayload: 8192, perMessageDeflate: false }),
    pool = new PacketBufferPool(32, 4096);
  let last = performance.now(),
    accumulator = 0,
    stopping = false;
  const hitRecord = new HitConfirm();
  const send = (peer: Peer, value: unknown) => {
    if (peer.socket.readyState === WebSocket.OPEN) {
      if (peer.socket.bufferedAmount > 256 * 1024) {
        peer.socket.close(1013, 'Rete lenta. Rientra nella lobby.');
        return;
      }
      peer.socket.send(encodeWire(WireKind.Control, value));
    }
  };
  const notice = (peer: Peer, message: string) => send(peer, { type: 'error', message });
  const broadcast = (room: Room, value: unknown) => {
    for (const peer of room.peers) send(peer, value);
  };
  const checkpoint = (room: Room): FpsCheckpoint => ({
    id: room.id,
    code: room.code,
    map: room.core.arena.name,
    mode: room.core.mode,
    debug: room.debug,
    tick: room.core.tickNumber,
    members: [...room.members.values()].map((m) => ({
      accountId: m.accountId,
      runId: m.runId,
      name: m.actor.name,
      kills: m.actor.kills,
      deaths: m.actor.deaths,
      damage: m.actor.damage,
      score: m.actor.score,
      headshots: m.actor.headshots,
      captures: m.actor.captures,
      timeOnPoint: m.actor.timeOnPoint,
      shots: m.actor.shotsFired,
      finished: !!m.result,
    })),
  });
  const roster = (room: Room) => ({
    type: 'lobby',
    code: room.code,
    map: room.core.arena.name,
    mode: room.core.mode,
    debug: room.debug,
    started: room.started,
    host: room.host,
    players: room.core.players
      .filter((p) => p.active)
      .map((p) => ({ id: p.id, name: p.name, team: p.team, bot: p.bot, connected: p.connected })),
  });
  function snapshots(room: Room, target?: Peer) {
    let writer: ReturnType<PacketBufferPool['acquire']>;
    try {
      writer = pool.acquire();
    } catch {
      for (const peer of room.peers) peer.socket.close(1013, 'Backpressure');
      return;
    }
    writer.begin(FpsPacketKind.Snapshot);
    const record = room.snapshot;
    for (const p of room.core.players) {
      if (!p.active) continue;
      record.playerId = p.id;
      record.weapon = p.weapon;
      record.lastProcessedSeq = p.lastProcessed;
      record.state.copy(p.controller.state);
      record.yaw = p.yaw;
      record.pitch = p.pitch;
      record.hp = p.hp;
      record.ammo = p.weapons.ammo[p.weapon]!;
      record.reserve = p.weapons.reserve[p.weapon]!;
      record.nextFire = p.weapons.nextFire[p.weapon]!;
      record.reloadUntil = p.weapons.reloadUntil[p.weapon]!;
      record.bloom = p.weapons.bloom[p.weapon]!;
      record.shots = p.weapons.shots[p.weapon]!;
      writer.snapshot(record);
    }
    const bytes = writer.finish();
    let pending = 0;
    for (const peer of room.peers)
      if (
        (!target || peer === target) &&
        peer.socket.readyState === WebSocket.OPEN &&
        peer.socket.bufferedAmount <= 256 * 1024
      )
        pending++;
    if (!pending) {
      pool.release(writer);
      return;
    }
    for (const peer of room.peers) {
      if (target && peer !== target) continue;
      if (peer.socket.readyState !== WebSocket.OPEN) continue;
      if (peer.socket.bufferedAmount > 256 * 1024) {
        peer.socket.close(1013, 'Rete lenta');
        continue;
      }
      peer.socket.send(bytes, () => {
        if (--pending === 0) pool.release(writer);
      });
    }
  }
  function confirms(room: Room): void {
    const tape = room.core.events;
    for (const peer of room.peers) {
      if (
        !peer.member ||
        peer.socket.readyState !== WebSocket.OPEN ||
        peer.socket.bufferedAmount > 256 * 1024
      )
        continue;
      let writer: ReturnType<PacketBufferPool['acquire']> | null = null;
      let count = 0;
      for (let n = 0; n < tape.count; n++) {
        const o = n * 16;
        if (tape.data[o] !== 2 || tape.data[o + 1] !== peer.member.actor.id) continue;
        if (!writer) {
          try {
            writer = pool.acquire();
            writer.begin(FpsPacketKind.HitConfirm);
          } catch {
            break;
          }
        }
        hitRecord.shotSequence = tape.data[o + 13]!;
        hitRecord.victimId = tape.data[o + 2]!;
        hitRecord.isHeadshot = !!(tape.data[o + 11]! & 1);
        hitRecord.isKill = !!(tape.data[o + 11]! & 2);
        hitRecord.zone = tape.data[o + 15]!;
        hitRecord.damageDealt = tape.data[o + 10]!;
        hitRecord.hitPosition.set(tape.data[o + 7]!, tape.data[o + 8]!, tape.data[o + 9]!);
        hitRecord.serverTick = tape.data[o + 12]!;
        hitRecord.subTickFraction = tape.data[o + 14]!;
        writer.hit(hitRecord);
        if (++count >= 32) break;
      }
      if (writer) {
        const lease = writer;
        peer.socket.send(lease.finish(), () => pool.release(lease));
      }
    }
  }
  function state(room: Room, target?: Peer) {
    const core = room.core,
      value = {
        type: 'state',
        tick: core.tickNumber,
        mode: core.mode,
        code: room.code,
        map: core.arena.name,
        debug: room.debug,
        remaining: Math.max(0, core.maxTicks - core.tickNumber),
        teamScores: [...core.teamScores],
        hardpoint: core.hardpoint,
        flagCarrier: [...core.flagCarrier],
        flagPosition: [...core.flagPosition],
        flagHome: [...core.flagHome],
        players: core.players
          .filter((p) => p.active)
          .map((p) => ({
            id: p.id,
            name: p.name,
            team: p.team,
            kills: p.kills,
            deaths: p.deaths,
            score: p.score,
            hp: p.hp,
            bot: p.bot,
            carrying: p.carrying,
            radar: p.carrying >= 0 && core.tickNumber % 180 < 15,
            respawn: Math.max(0, p.respawnAt - core.tickNumber),
            protected: p.protectedUntil > core.tickNumber,
          })),
      };
    if (target) send(target, value);
    else broadcast(room, value);
  }
  async function finishMember(room: Room, member: Member, abandoned: boolean) {
    if (member.result) return member.result;
    const p = member.actor,
      won =
        !abandoned &&
        (room.core.mode === 'ffa' ? room.core.winnerId === p.id : room.core.winnerTeam === p.team),
      result: FpsResult = {
        id: member.runId,
        game: 'crossfire',
        mode: 'online',
        score: p.score,
        durationMs: Math.round((room.core.tickNumber / 60) * 1000),
        won,
        stats: {
          engineVersion: 2,
          kills: p.kills,
          deaths: p.deaths,
          damage: p.damage,
          headshots: p.headshots,
          captures: p.captures,
          timeOnPoint: p.timeOnPoint,
          shots: p.shotsFired,
          debug: room.debug,
          abandoned,
          map: room.core.arena.name,
          mode: room.core.mode,
        },
      };
    member.result = await options.store.result(member.accountId, result, !room.debug);
    return member.result;
  }
  async function end(room: Room) {
    if (room.finishing || room.closed) return;
    room.finishing = true;
    try {
      for (const member of room.members.values()) {
        const result = await finishMember(room, member, false);
        for (const peer of room.peers)
          if (peer.member === member) send(peer, { type: 'result', result });
      }
      await options.store.checkpoint(checkpoint(room));
      await options.store.closeMatch(room.id);
      room.closed = true;
    } catch (error) {
      room.failed = true;
      broadcast(room, {
        type: 'error',
        message: 'Salvataggio risultato non disponibile. Riprova a concludere.',
      });
      console.error('fps_finish_failed', error);
    } finally {
      room.finishing = false;
    }
  }
  function bots(room: Room, count: number, reactionMs: number) {
    let current = 0;
    for (const p of room.core.players) if (p.active && p.bot) current++;
    for (let i = 0; i < Math.min(count, 5 - current); i++)
      room.core.add('Strafe ' + (current + i + 1), '', 'bot:' + randomUUID(), true, reactionMs);
  }
  async function handle(peer: Peer, value: unknown) {
    const message = schema.parse(value);
    if (message.type === 'pong') {
      if (message.nonce === peer.nonce) {
        peer.rttMs = Math.min(500, Math.max(0, performance.now() - peer.pingAt));
        if (peer.member) peer.member.actor.rttMs = peer.rttMs;
      }
      return;
    }
    if (message.type === 'create' || message.type === 'join' || message.type === 'quick') {
      if (peer.room) throw new Error('Sei già in una lobby');
      if (message.debug && !options.debugAllowed)
        throw new Error('Debug disabilitato su questo server');
      const key = peer.account.id + (message.debug ? ':' + message.tabId : '');
      let room: Room | undefined;
      if (message.type === 'join') room = rooms.get(message.code);
      else if (message.type === 'quick')
        room = [...rooms.values()].find(
          (r) =>
            r.quick &&
            !r.debug &&
            !message.debug &&
            r.core.mode === message.mode &&
            r.core.arena.name === message.map &&
            !r.core.ended &&
            r.members.size < 6 &&
            !r.failed,
        );
      if (message.type === 'join' && !room) throw new Error('Codice lobby non trovato');
      if (!room) {
        if (rooms.size >= 32) throw new Error('Server pieno');
        let code: string;
        do {
          const bytes = randomBytes(6);
          code = Array.from(bytes, (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
        } while (rooms.has(code));
        const map = message.type === 'join' ? 'nexus' : message.map,
          mode = message.type === 'join' ? 'ffa' : message.mode;
        room = {
          id: randomUUID(),
          code,
          host: key,
          core: new GameRoom(map, mode, randomBytes(4).readUInt32LE(), options.maxTicks ?? 28800),
          debug: message.debug,
          quick: message.type === 'quick',
          started: false,
          members: new Map(),
          peers: new Set(),
          savedAt: Date.now(),
          lastActive: Date.now(),
          saving: false,
          failed: false,
          finishing: false,
          closed: false,
          snapshot: new PlayerSnapshot(),
        };
        rooms.set(code, room);
      }
      if (room.debug !== message.debug)
        throw new Error('Questa lobby usa una modalità debug diversa');
      if (room.failed) throw new Error('Partita sospesa per errore di persistenza');
      if (room.core.ended) throw new Error('Partita conclusa. Crea una nuova lobby.');
      const previous = [...room.peers].find((p) => p.member?.sessionKey === key);
      if (previous)
        previous.socket.close(
          1008,
          'Sessione aperta in un’altra scheda. Attiva debug per due schede.',
        );
      let member = room.members.get(key);
      if (member?.result) {
        send(peer, { type: 'result', result: member.result });
        return;
      }
      if (!member) {
        const actor = room.core.add(
            peer.account.name + (room.debug ? ' · ' + message.tabId.slice(0, 4) : ''),
            peer.account.id,
            key,
          ),
          hex = createHash('sha256')
            .update(room.id + key)
            .digest('hex')
            .slice(0, 32);
        member = {
          actor,
          accountId: peer.account.id,
          sessionKey: key,
          runId:
            hex.slice(0, 8) +
            '-' +
            hex.slice(8, 12) +
            '-4' +
            hex.slice(13, 16) +
            '-a' +
            hex.slice(17, 20) +
            '-' +
            hex.slice(20),
          result: null,
        };
        room.members.set(key, member);
      }
      member.actor.connected = true;
      peer.room = room;
      peer.member = member;
      room.peers.add(peer);
      room.lastActive = Date.now();
      if (message.type !== 'join' && !room.started) {
        bots(room, message.bots, 300);
        if (message.type === 'quick') room.started = true;
      }
      await options.store.checkpoint(checkpoint(room));
      send(peer, {
        type: 'welcome',
        playerId: member.actor.id,
        code: room.code,
        map: room.core.arena.name,
        mode: room.core.mode,
        debug: room.debug,
        started: room.started,
        nextSequence: member.actor.lastAccepted + 1,
        tick: room.core.tickNumber,
        host: room.host,
        sessionKey: key,
      });
      broadcast(room, roster(room));
      snapshots(room, peer);
      state(room, peer);
      return;
    }
    const room = peer.room,
      member = peer.member;
    if (!room || !member) throw new Error('Entra prima in una lobby');
    if (message.type === 'start') {
      if (room.host !== member.sessionKey) throw new Error('Solo il creatore avvia la partita');
      room.started = true;
      await options.store.checkpoint(checkpoint(room));
      broadcast(room, roster(room));
      return;
    }
    if (message.type === 'bots') {
      if (!room.debug || room.host !== member.sessionKey)
        throw new Error('Bot extra disponibili al creatore della lobby debug');
      bots(room, message.count, message.reactionMs);
      broadcast(room, roster(room));
      return;
    }
    if (message.type === 'resync') {
      member.actor.queue.clear();
      member.actor.lastProcessed = member.actor.lastAccepted;
      member.actor.input.buttons = 0;
      member.actor.input.moveX = member.actor.input.moveZ = 0;
      send(peer, {
        type: 'welcome',
        playerId: member.actor.id,
        code: room.code,
        map: room.core.arena.name,
        mode: room.core.mode,
        debug: room.debug,
        started: room.started,
        nextSequence: member.actor.lastAccepted + 1,
        tick: room.core.tickNumber,
        host: room.host,
        sessionKey: member.sessionKey,
      });
      snapshots(room, peer);
      state(room, peer);
      return;
    }
    if (message.type === 'finish') {
      const result = await finishMember(room, member, !room.core.ended);
      member.actor.connected = false;
      member.actor.input.buttons = 0;
      member.actor.active = false;
      room.core.alive[member.actor.id - 1] = 0;
      await options.store.checkpoint(checkpoint(room));
      send(peer, { type: 'result', result });
      peer.socket.close(1000, 'Round concluso');
    }
  }
  const pump = setInterval(() => {
    const now = performance.now();
    accumulator += Math.min(100, now - last);
    last = now;
    let steps = 0;
    while (accumulator >= 1000 / 60 && steps++ < 4) {
      accumulator -= 1000 / 60;
      for (const room of rooms.values()) {
        if (!room.started || room.failed || room.core.ended || room.peers.size === 0) continue;
        try {
          room.core.step();
          if (room.core.tickNumber % 3 === 0) {
            snapshots(room);
            if (room.core.events.count) {
              confirms(room);
              broadcast(room, {
                type: 'events',
                data: room.core.events.data.slice(0, room.core.events.count * 16),
              });
              room.core.events.clear();
            }
          }
          if (room.core.tickNumber % 6 === 0) state(room);
          if (room.core.ended) void end(room);
        } catch (error) {
          room.failed = true;
          broadcast(room, {
            type: 'error',
            message: 'Errore di simulazione. Partita sospesa; risultati conservati.',
          });
          console.error('fps_tick_failed', error);
        }
      }
    }
    for (const room of rooms.values()) {
      if (!room.saving && !room.failed && Date.now() - room.savedAt >= 5000) {
        room.saving = true;
        room.savedAt = Date.now();
        void options.store
          .checkpoint(checkpoint(room))
          .catch((error) => {
            room.failed = true;
            broadcast(room, {
              type: 'error',
              message: 'Persistenza non disponibile. Partita sospesa.',
            });
            console.error('fps_checkpoint_failed', error);
          })
          .finally(() => {
            room.saving = false;
          });
      }
      if (!room.peers.size && Date.now() - room.lastActive > 120000 && !room.finishing) {
        if (room.closed) rooms.delete(room.code);
        else void end(room);
      }
    }
  }, 4);
  const heartbeat = setInterval(() => {
    for (const peer of peers) {
      if (!peer.alive) {
        peer.socket.terminate();
        continue;
      }
      peer.alive = false;
      peer.socket.ping();
      peer.nonce = randomBytes(8).toString('hex');
      peer.pingAt = performance.now();
      send(peer, { type: 'ping', nonce: peer.nonce });
      if (Date.now() - peer.authAt > 60000) {
        peer.authAt = Date.now();
        void options
          .authenticate(peer.cookie)
          .then((account) => {
            if (!account || account.id !== peer.account.id)
              peer.socket.close(1008, 'Sessione scaduta');
          })
          .catch(() => peer.socket.close(1011, 'Autenticazione non disponibile'));
      }
    }
  }, 5000);
  const upgrade = (
    request: IncomingMessage,
    socket: import('node:stream').Duplex,
    head: Buffer,
  ) => {
    if (new URL(request.url ?? '/', options.origin).pathname !== '/fps/socket') return;
    if (stopping || request.headers.origin !== options.origin || peers.size >= 128) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    const timeout = setTimeout(() => socket.destroy(), 5000);
    void options
      .authenticate(request.headers.cookie ?? '')
      .then((account) => {
        clearTimeout(timeout);
        if (!account || socket.destroyed) {
          socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
          return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => {
          const peer: Peer = {
            socket: ws,
            account,
            cookie: request.headers.cookie ?? '',
            room: null,
            member: null,
            alive: true,
            count: 0,
            reset: Date.now() + 1000,
            controlCount: 0,
            pingAt: 0,
            nonce: '',
            rttMs: 0,
            authAt: Date.now(),
            reader: new PacketReader(8192),
            input: new PlayerInput(),
            controls: Promise.resolve(),
            pendingControls: 0,
          };
          peers.add(peer);
          send(peer, { type: 'ready', debugAllowed: options.debugAllowed });
          ws.on('pong', () => {
            peer.alive = true;
          });
          ws.on('message', (raw, binary) => {
            try {
              if (!binary) throw new Error('Pacchetto binario richiesto');
              if (Date.now() > peer.reset) {
                peer.count = peer.controlCount = 0;
                peer.reset = Date.now() + 1000;
              }
              if (++peer.count > 100) {
                ws.close(1008, 'Troppe richieste');
                return;
              }
              const data = raw as Buffer;
              if (data[0] === 0x46 && data[1] === 0x50 && data[2] === 0x53 && data[3] === 0x31) {
                if (!peer.room?.started || peer.room.failed || !peer.member || peer.member.result)
                  return;
                peer.reader.reset(data);
                if (
                  (peer.reader.kind !== FpsPacketKind.Inputs &&
                    peer.reader.kind !== FpsPacketKind.Fire) ||
                  peer.reader.count > 4
                )
                  throw new Error('Input non valido');
                for (let i = 0; i < peer.reader.count; i++) {
                  peer.reader.input(peer.input);
                  peer.room.core.enqueue(
                    peer.member.actor,
                    peer.input,
                    peer.room.core.tickNumber +
                      Math.min(1, (performance.now() - last) / (1000 / 60)),
                  );
                }
              } else {
                if (++peer.controlCount > 10) throw new Error('Troppi controlli');
                if (peer.pendingControls >= 8) throw new Error('Troppi controlli in attesa');
                const packet = decodeWire(data);
                if (packet.kind !== WireKind.Control) throw new Error('Tipo messaggio non valido');
                peer.pendingControls++;
                peer.controls = peer.controls
                  .then(() => {
                    if (peer.socket.readyState === WebSocket.OPEN)
                      return handle(peer, packet.value);
                  })
                  .catch((error) =>
                    notice(
                      peer,
                      error instanceof z.ZodError
                        ? 'Richiesta non valida'
                        : error instanceof Error
                          ? error.message
                          : 'Errore server',
                    ),
                  )
                  .finally(() => {
                    peer.pendingControls--;
                  });
              }
            } catch (error) {
              notice(peer, error instanceof Error ? error.message : 'Pacchetto non valido');
            }
          });
          ws.on('error', () => {});
          ws.on('close', () => {
            peers.delete(peer);
            if (peer.room) {
              peer.room.peers.delete(peer);
              peer.room.lastActive = Date.now();
              if (peer.member) {
                peer.member.actor.connected = false;
                peer.member.actor.queue.clear();
                peer.member.actor.lastProcessed = peer.member.actor.lastAccepted;
                peer.member.actor.input.buttons = 0;
                peer.member.actor.input.moveX = peer.member.actor.input.moveZ = 0;
              }
              broadcast(peer.room, roster(peer.room));
            }
          });
        });
      })
      .catch(() => {
        clearTimeout(timeout);
        socket.destroy();
      });
  };
  server.on('upgrade', upgrade);
  return {
    revoke(cookie: string) {
      for (const peer of peers)
        if (peer.cookie === cookie) peer.socket.close(1008, 'Sessione terminata');
    },
    async close() {
      stopping = true;
      clearInterval(pump);
      clearInterval(heartbeat);
      server.off('upgrade', upgrade);
      for (const peer of peers) peer.socket.close(1001, 'Server in riavvio');
      for (const room of rooms.values()) {
        while (room.saving || room.finishing)
          await new Promise((resolve) => setTimeout(resolve, 10));
        await options.store.checkpoint(checkpoint(room));
      }
      wss.close();
    },
  };
}
