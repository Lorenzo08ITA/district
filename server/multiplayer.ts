import { randomUUID } from 'node:crypto';
import { Server, Socket } from 'socket.io';
import { playerForCookie, RateLimiter } from './auth';
import { saveResult, type Database } from './db';
import { getGame, type GameId } from '../lib/catalog';
import { inputSchema } from '../lib/validation';
import {
  createActor,
  stepShooter,
  stepTerritory,
  conquer,
  type Actor,
  type Territory,
} from '../games/simulation';
type Room = {
  id: string;
  game: GameId;
  actors: Map<string, Actor>;
  sockets: Map<string, Socket>;
  started: number;
  duration: number;
  territory?: Territory;
  finished: boolean;
  persisting: boolean;
  results?: Map<string, any>;
  lastInput: Map<string, number>;
  checkpoint?: Promise<void>;
};
export function attachMultiplayer(
  io: Server,
  db: Database,
  origin: string,
  options: { matchMs?: number } = {},
) {
  const rooms = new Map<string, Room>();
  const limiter = new RateLimiter(90, 1000);
  io.use(async (socket, next) => {
    try {
      if (socket.handshake.headers.origin !== origin)
        return next(new Error('Origine non consentita'));
      const p = await playerForCookie(db, socket.handshake.headers.cookie);
      if (!p) return next(new Error('Accedi per giocare online'));
      socket.data.player = p;
      next();
    } catch {
      next(new Error('Autenticazione non disponibile'));
    }
  });
  async function finish(room: Room) {
    if (room.persisting) return;
    room.finished = true;
    room.persisting = true;
    try {
      await room.checkpoint;
      if (!room.results) {
        room.results = new Map();
        const actors = [...room.actors.values()];
        const max = Math.max(0, ...actors.map((a) => a.score));
        for (const a of actors)
          room.results.set(a.id, {
            id: room.id,
            game: room.game,
            mode: 'online',
            score: a.score,
            durationMs: Math.min(86400000, Date.now() - room.started),
            won: a.score === max && max > 0,
            stats: {
              kills: a.kills,
              deaths: a.deaths,
              territories:
                room.territory?.owners.filter((o) => o === actors.indexOf(a)).length || 0,
              participants: actors.length,
            },
          });
      }
      await db.query('UPDATE matches SET state=$1 WHERE id=$2', [
        JSON.stringify({ results: [...room.results] }),
        room.id,
      ]);
      for (const [id, result] of room.results) await saveResult(db, id, result, true, room.id);
      await db.query('UPDATE matches SET ended_at=now() WHERE id=$1', [room.id]);
      for (const [id, socket] of room.sockets) {
        socket.emit('finished', room.results.get(id));
        socket.leave(room.id);
        socket.data.room = null;
      }
      rooms.delete(room.id);
    } catch (e) {
      console.error('match_save_failed', room.id, e);
      io.to(room.id).emit('notice', 'Salvataggio in attesa. Il server ritenta.');
    } finally {
      room.persisting = false;
    }
  }
  function detach(socket: Socket) {
    const room = rooms.get(socket.data.room);
    if (!room) return;
    room.sockets.delete(socket.data.player.id);
    socket.leave(room.id);
    socket.data.room = null;
    const a = room.actors.get(socket.data.player.id);
    if (a) a.input = { x: 0, z: 0, yaw: a.yaw, pitch: 0, fire: false };
  }
  io.on('connection', (socket) => {
    socket.on('join', async (payload, ack) => {
      if (typeof ack !== 'function') return;
      try {
        if (!limiter.allow(`join:${socket.data.player.id}`))
          return ack({ error: 'Troppi tentativi' });
        const game = getGame(payload?.game);
        if (game?.id === 'frontier'||game?.id==='crossfire') return ack?.({ error: 'Questo gioco usa la nuova lobby dedicata' });
        if (!game?.online) return ack({ error: 'Modalità non disponibile' });
        detach(socket);
        const player = socket.data.player;
        let room = [...rooms.values()].find(
          (r) =>
            r.game === game.id &&
            !r.finished &&
            Date.now() - r.started < 20000 &&
            r.actors.size < 8 &&
            !r.actors.has(player.id),
        );
        if (!room) {
          if (rooms.size >= 100) return ack({ error: 'Server pieno' });
          room = {
            id: randomUUID(),
            game: game.id,
            actors: new Map(),
            sockets: new Map(),
            started: Date.now(),
            duration: options.matchMs ?? 90000,
            finished: false,
            persisting: false,
            lastInput: new Map(),
          };
          await db.query('INSERT INTO matches(id,game_id) VALUES($1,$2)', [room.id, game.id]);
          rooms.set(room.id, room);
        }
        const existing = [...rooms.values()].find(
          (r) => r.game === game.id && !r.finished && r.actors.has(player.id),
        );
        if (existing) room = existing;
        const previous = room.sockets.get(player.id);
        if (previous && previous.id !== socket.id) {
          previous.emit('notice', 'Sessione aperta in un’altra scheda');
          previous.disconnect();
        }
        if (!room.actors.has(player.id)) {
          const actor = createActor(player.id, player.name, room.actors.size);
          if (game.id === 'drift') {
            actor.x = 24;
            actor.z = 0;
          }
          room.actors.set(player.id, actor);
        }
        room.sockets.set(player.id, socket);
        socket.data.room = room.id;
        socket.join(room.id);
        await db.query('UPDATE matches SET state=$1 WHERE id=$2', [
          JSON.stringify({ actors: [...room.actors.values()], elapsed: Date.now() - room.started }),
          room.id,
        ]);
        ack({ room: room.id, playerId: player.id });
      } catch (e) {
        console.error('join_failed', e);
        ack({ error: 'Impossibile creare la partita' });
      }
    });
    socket.on('input', (raw) => {
      const room = rooms.get(socket.data.room);
      if (!room || room.finished || !limiter.allow(socket.id)) return;
      const parsed = inputSchema.safeParse(raw);
      if (!parsed.success) return;
      const a = room.actors.get(socket.data.player.id);
      if (!a) return;
      const input = parsed.data;
      const now = Date.now();
      const elapsed = Math.min(1, (now - (room.lastInput.get(a.id) || now)) / 1000);
      room.lastInput.set(a.id, now);
      if (room.game === 'crossfire') a.input = input;
      else if (room.game === 'frontier') {
        if (input.target !== undefined && room.territory)
          conquer(room.territory, [...room.actors.keys()].indexOf(a.id), input.target);
      } else {
        if (input.px !== undefined && input.pz !== undefined) {
          const distance = Math.hypot(input.px - a.x, input.pz - a.z);
          if (distance <= Math.max(3, elapsed * 35)) {
            a.x = input.px;
            a.z = input.pz;
          }
        }
        if (
          input.score !== undefined &&
          input.score >= a.score &&
          input.score <= a.score + Math.max(5, elapsed * 200)
        )
          a.score = input.score;
        if (input.size !== undefined && input.size <= a.size + 1) a.size = input.size;
        a.yaw = input.yaw;
      }
    });
    socket.on('leave', () => detach(socket));
    socket.on('disconnect', () => detach(socket));
  });
  let ticks = 0;
  const timer = setInterval(() => {
    ticks++;
    for (const room of rooms.values()) {
      if (room.finished) {
        if (ticks % 150 === 0) void finish(room);
        continue;
      }
      const actors = [...room.actors.values()];
      if (room.game === 'crossfire')
        stepShooter(
          actors.filter((a) => room.sockets.has(a.id)),
          1 / 30,
        );
      if (room.game === 'frontier' && room.territory) {
        stepTerritory(room.territory);
        actors.forEach(
          (a, i) => (a.score = room.territory!.owners.filter((o) => o === i).length * 10),
        );
      }
      if (ticks % 60 === 0 && !room.checkpoint) {
        room.checkpoint = db
          .query('UPDATE matches SET state=$1 WHERE id=$2', [
            JSON.stringify({ actors, elapsed: Date.now() - room.started }),
            room.id,
          ])
          .then(() => {})
          .catch((e) => {
            console.error('match_checkpoint_failed', room.id, e);
            io.to(room.id).emit('notice', 'Salvataggio server rallentato');
          })
          .finally(() => (room.checkpoint = undefined));
      }
      if (ticks % 2 === 0)
        io.to(room.id).emit('snapshot', {
          id: room.id,
          game: room.game,
          actors: actors.map(({ input, ...a }) => a),
          territory: room.territory,
          remaining: Math.max(0, room.duration - Date.now() + room.started),
          started: room.started,
        });
      if (Date.now() - room.started >= room.duration) void finish(room);
    }
  }, 1000 / 30);
  return async () => {
    clearInterval(timer);
    await Promise.all([...rooms.values()].map(finish));
  };
}
