import type { Server } from 'node:http';
import { attachFps, type FpsCheckpoint, type FpsResult } from '../packages/server/src/fps/service';
import { playerForCookie } from './auth';
import { saveResult, type Database } from './db';
export async function recoverFps(db: Database) {
  const rows = await db.query('SELECT id,state FROM fps_matches WHERE ended_at IS NULL');
  for (const row of rows.rows) {
    const state = row.state as FpsCheckpoint;
    if (!state?.members) continue;
    for (const m of state.members) {
      if (m.finished) continue;
      await saveResult(
        db,
        m.accountId,
        {
          id: m.runId,
          game: 'crossfire',
          mode: 'online',
          score: m.score,
          durationMs: Math.round((state.tick / 60) * 1000),
          won: false,
          stats: {
            engineVersion: 2,
            kills: m.kills,
            deaths: m.deaths,
            damage: m.damage,
            headshots: m.headshots,
            captures: m.captures,
            timeOnPoint: m.timeOnPoint,
            shots: m.shots ?? 0,
            debug: state.debug,
            interrupted: true,
            map: state.map,
            mode: state.mode,
          },
        },
        !state.debug,
      );
    }
    await db.query('UPDATE fps_matches SET ended_at=now() WHERE id=$1', [row.id]);
  }
}
export function attachDistrictFps(
  server: Server,
  db: Database,
  origin: string,
  production: boolean,
) {
  return attachFps(server, {
    origin,
    debugAllowed: !production || process.env.FPS_DEBUG === 'true',
    authenticate: (cookie) => playerForCookie(db, cookie),
    store: {
      async checkpoint(state) {
        await db.query(
          'INSERT INTO fps_matches(id,state) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state,updated_at=now()',
          [state.id, JSON.stringify(state)],
        );
      },
      async result(accountId, result, verified) {
        await saveResult(db, accountId, result, verified);
        const q = await db.query(
            'SELECT score,duration_ms,won,stats FROM runs WHERE player_id=$1 AND id=$2',
            [accountId, result.id],
          ),
          row = q.rows[0]!;
        return {
          ...result,
          score: Number(row.score),
          durationMs: Number(row.duration_ms),
          won: row.won,
          stats: row.stats,
        } as FpsResult;
      },
      async closeMatch(id) {
        await db.query('UPDATE fps_matches SET ended_at=now() WHERE id=$1', [id]);
      },
    },
  });
}
