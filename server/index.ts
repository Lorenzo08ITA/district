import 'dotenv/config';
import next from 'next';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import { z, ZodError } from 'zod';
import { openDatabase, migrate, saveResult } from './db';
import { credentialsSchema, resultSchema, preferencesSchema } from '../lib/validation';
import { games, getGame, type Result } from '../lib/catalog';
import {
  createSession,
  hashPassword,
  verifyPassword,
  playerForCookie,
  sessionCookie,
  tokenHash,
  cookieToken,
  RateLimiter,
} from './auth';
import { recoverMatches } from './recovery';
import { attachMultiplayer } from './multiplayer';
import { attachDistrictRts } from './rts';
import {attachDistrictFps,recoverFps} from './fps';
import { decodeWire, encodeWire, WireKind } from '@district/rts-shared';
import { GameEngine, type EngineSnapshot } from '@district/rts-engine';
const production = process.argv.includes('--production');
if (production && (!process.env.DATABASE_URL || !process.env.PUBLIC_ORIGIN?.startsWith('https://')))
  throw new Error('Produzione: configurare DATABASE_URL PostgreSQL e PUBLIC_ORIGIN HTTPS');
const port = Number(process.env.PORT || 3000),
  origin = process.env.PUBLIC_ORIGIN || `http://localhost:${port}`;
const db = await openDatabase();
await migrate(db);
await recoverMatches(db);
await recoverFps(db);
const app = next({ dev: !production && !process.argv.includes('--preview'), port });
await app.prepare();
const handle = app.getRequestHandler();
const authLimit = new RateLimiter(15, 60000),
  apiLimit = new RateLimiter(180, 60000);
function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}
async function body(req: IncomingMessage) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32768) throw Object.assign(new Error('Richiesta troppo grande'), { status: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}
const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  const path = new URL(req.url || '/', origin).pathname;
  if (!path.startsWith('/api/')) return handle(req, res);
  try {
    const ip = req.socket.remoteAddress || 'unknown';
    if (!apiLimit.allow(ip))
      return send(res, 429, { error: 'Troppe richieste. Riprova tra un minuto.' });
    if (req.method !== 'GET' && req.headers.origin !== origin)
      return send(res, 403, { error: 'Origine non consentita' });
    if (path === '/api/health') {
      await db.query('SELECT 1');
      return send(res, 200, { ok: true });
    }
    if (path === '/api/games' && req.method === 'GET') return send(res, 200, games);
    if ((path === '/api/auth/register' || path === '/api/auth/login') && req.method === 'POST') {
      if (!authLimit.allow(ip))
        return send(res, 429, { error: 'Troppi tentativi. Attendi un minuto.' });
      const data = credentialsSchema.parse(await body(req));
      let player;
      if (path.endsWith('register')) {
        if (!data.name) return send(res, 400, { error: 'Inserisci il nome' });
        const hash = await hashPassword(data.password);
        const id = randomUUID();
        try {
          const q = await db.query(
            'INSERT INTO players(id,email,name,password_hash) VALUES($1,$2,$3,$4) RETURNING id,email,name,preferences',
            [id, data.email, data.name, hash],
          );
          player = q.rows[0];
        } catch (e: any) {
          if (e.code === '23505') return send(res, 409, { error: 'Email già registrata' });
          throw e;
        }
      } else {
        const q = await db.query('SELECT * FROM players WHERE email=$1', [data.email]);
        const candidate = q.rows[0];
        const hash = candidate?.password_hash || (await hashPassword('constant-dummy-password'));
        if (!(await verifyPassword(data.password, hash)) || !candidate)
          return send(res, 401, { error: 'Email o password errati' });
        const { password_hash, ...safe } = candidate;
        player = safe;
      }
      res.setHeader('Set-Cookie', sessionCookie(await createSession(db, player.id), production));
      return send(res, 200, player);
    }
    const player = await playerForCookie(db, req.headers.cookie);
    if (path === '/api/me' && req.method === 'GET') return send(res, 200, player);
    if (player && req.headers['x-player-id'] && req.headers['x-player-id'] !== player.id)
      return send(res, 403, { error: 'Account cambiato. Riapri il gioco dal tuo account.' });
    if (!player) return send(res, 401, { error: 'Accedi per sincronizzare i progressi' });
    if (path === '/api/auth/logout' && req.method === 'POST') {
      rts.revoke(req.headers.cookie ?? '');
      fps.revoke(req.headers.cookie ?? '');
      await db.query('DELETE FROM sessions WHERE token_hash=$1', [
        tokenHash(cookieToken(req.headers.cookie)),
      ]);
      for (const socket of io.sockets.sockets.values())
        if (cookieToken(socket.handshake.headers.cookie) === cookieToken(req.headers.cookie))
          socket.disconnect(true);
      res.setHeader('Set-Cookie', sessionCookie('', production));
      return send(res, 200, { ok: true });
    }

    if (path.startsWith('/api/checkpoints/')) {
      const gameId = path.slice('/api/checkpoints/'.length);
      if (!getGame(gameId)?.offline) return send(res, 400, { error: 'Gioco offline non valido' });
      if (req.method === 'GET') {
        const q = await db.query(
          'SELECT data,extract(epoch from updated_at)*1000 AS timestamp FROM checkpoints WHERE player_id=$1 AND game_id=$2',
          [player.id, gameId],
        );
        return send(
          res,
          200,
          q.rows.length ? { data: q.rows[0].data, updatedAt: Number(q.rows[0].timestamp) } : null,
        );
      }
      if (req.method === 'PUT') {
        const checkpoint = z
          .object({
            data: z
              .record(z.string(), z.unknown())
              .refine((v) => JSON.stringify(v).length <= 20000),
            updatedAt: z
              .number()
              .finite()
              .min(0)
              .max(Date.now() + 60000),
          })
          .parse(await body(req));
        await db.query(
          'INSERT INTO checkpoints(player_id,game_id,data,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(player_id,game_id) DO UPDATE SET data=EXCLUDED.data,updated_at=EXCLUDED.updated_at WHERE checkpoints.updated_at<=EXCLUDED.updated_at',
          [player.id, gameId, JSON.stringify(checkpoint.data), new Date(checkpoint.updatedAt)],
        );
        return send(res, 200, { ok: true });
      }
      if (req.method === 'DELETE') {
        await db.query(
          'INSERT INTO checkpoints(player_id,game_id,data) VALUES($1,$2,\'{"completed":true}\') ON CONFLICT(player_id,game_id) DO UPDATE SET data=EXCLUDED.data,updated_at=now()',
          [player.id, gameId],
        );
        return send(res, 200, { ok: true });
      }
    }
    if (path === '/api/rts/checkpoint') {
      if (req.method === 'GET') {
        const q = await db.query('SELECT state FROM rts_checkpoints WHERE player_id=$1', [
          player.id,
        ]);
        if (!q.rows.length) {
          res.writeHead(204);
          res.end();
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Cache-Control': 'no-store',
        });
        res.end(q.rows[0].state);
        return;
      }
      if (req.method === 'DELETE') {
        const ended = { completed: true, updatedAt: Date.now() };
        await db.query(
          'INSERT INTO rts_checkpoints(player_id,state,updated_at) VALUES($1,$2,$3) ON CONFLICT(player_id) DO UPDATE SET state=EXCLUDED.state,updated_at=GREATEST(rts_checkpoints.updated_at,EXCLUDED.updated_at)',
          [player.id, Buffer.from(encodeWire(WireKind.Snapshot, ended)), new Date(ended.updatedAt)],
        );
        return send(res, 200, { ok: true });
      }
      if (req.method === 'PUT') {
        let size = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 4 * 1024 * 1024) return send(res, 413, { error: 'Checkpoint troppo grande' });
          chunks.push(chunk);
        }
        let value: { snapshot: EngineSnapshot; layout: string; updatedAt: number };
        try {
          const packet = decodeWire(Buffer.concat(chunks));
          if (packet.kind !== WireKind.Snapshot) throw new Error('kind');
          value = packet.value as typeof value;
          if (
            !['world','continents', 'archipelago', 'strait'].includes(value.layout) ||
            !Number.isFinite(value.updatedAt) ||
            value.updatedAt > Date.now() + 60000
          )
            return send(res, 400, { error: 'Checkpoint non valido' });
          if (
            !((value.snapshot.map.width===192&&value.snapshot.map.height===128)||(value.layout==='world'&&value.snapshot.map.width===512&&value.snapshot.map.height===256)) ||
            value.snapshot.players.length !== 4
          )
            return send(res, 400, { error: 'Scenario non valido' });
          GameEngine.fromSnapshot(value.snapshot);
        } catch {
          return send(res, 400, { error: 'Checkpoint non valido' });
        }
        await db.query(
          'INSERT INTO rts_checkpoints(player_id,state,updated_at) VALUES($1,$2,$3) ON CONFLICT(player_id) DO UPDATE SET state=EXCLUDED.state,updated_at=EXCLUDED.updated_at WHERE rts_checkpoints.updated_at<=EXCLUDED.updated_at',
          [player.id, Buffer.from(encodeWire(WireKind.Snapshot, value)), new Date(value.updatedAt)],
        );
        return send(res, 200, { ok: true });
      }
    }
    if (path === '/api/preferences' && req.method === 'PUT') {
      const prefs = preferencesSchema.parse(await body(req));
      await db.query('UPDATE players SET preferences=$1 WHERE id=$2', [
        JSON.stringify(prefs),
        player.id,
      ]);
      return send(res, 200, prefs);
    }
    if (path === '/api/progress' && req.method === 'GET') {
      const q = await db.query(
        'SELECT game_id,best,plays,wins,total_ms,stats FROM progress WHERE player_id=$1',
        [player.id],
      );
      return send(res, 200, q.rows);
    }
    if (path === '/api/runs' && req.method === 'GET') {
      const q = await db.query(
        'SELECT id,game_id,mode,score,duration_ms,won,stats,verified,created_at FROM runs WHERE player_id=$1 ORDER BY created_at DESC LIMIT 100',
        [player.id],
      );
      return send(res, 200, q.rows);
    }
    if (path === '/api/results' && req.method === 'POST') {
      const result = resultSchema.parse(await body(req)) as Result;
      const game = getGame(result.game)!;
      if (result.mode === 'online' || !game.offline)
        return send(res, 403, { error: 'I risultati online sono registrati dal server' });
      return send(res, 200, await saveResult(db, player.id, result));
    }
    return send(res, 404, { error: 'Endpoint non trovato' });
  } catch (e: any) {
    if (e instanceof ZodError || e instanceof SyntaxError)
      return send(res, 400, { error: 'Dati non validi' });
    console.error('request_failed', path, e);
    send(res, e.status || 503, {
      error: e.status
        ? e.message
        : 'Servizio temporaneamente non disponibile. I progressi locali restano salvati.',
    });
  }
});
const io = new Server(server, {
  maxHttpBufferSize: 16384,
  cors: { origin, credentials: true },
  pingTimeout: 10000,
  destroyUpgrade: false,
});
const stopMultiplayer = attachMultiplayer(io, db, origin);
const rts = attachDistrictRts(server, db, origin);
const fps=attachDistrictFps(server,db,origin,production);
const cleanup = setInterval(
  () => void db.query('DELETE FROM sessions WHERE expires_at<now()').catch(console.error),
  3600000,
);
server.listen(port, () => console.log(`Arcade District: ${origin}`));
async function shutdown() {
  clearInterval(cleanup);
  await fps.close();
  await rts.close();
  await stopMultiplayer();
  io.close();
  server.close();
  await db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
