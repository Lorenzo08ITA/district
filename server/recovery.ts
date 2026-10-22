import { saveResult, type Database } from './db';
import type { Result } from '../lib/catalog';
// Interrupted matches end at the latest durable snapshot, never from client claims.
export async function recoverMatches(db: Database) {
  const { rows } = await db.query(
    'SELECT id,game_id,started_at,state FROM matches WHERE ended_at IS NULL',
  );
  for (const match of rows) {
    const actors = match.state.actors || [];
    const best = Math.max(0, ...actors.map((a: any) => a.score));
    const results: [string, Result][] =
      match.state.results ||
      actors.map((a: any) => [
        a.id,
        {
          id: match.id,
          game: match.game_id,
          mode: 'online',
          score: a.score,
          durationMs: Math.min(86400000, Math.max(0, match.state.elapsed || 0)),
          won: a.score === best && best > 0,
          stats: {
            kills: a.kills,
            deaths: a.deaths,
            interrupted: true,
            participants: actors.length,
          },
        },
      ]);
    for (const [id, result] of results) await saveResult(db, id, result, true, match.id);
    await db.query('UPDATE matches SET ended_at=now() WHERE id=$1', [match.id]);
  }
}
