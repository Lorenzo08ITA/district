import { Pool } from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { games } from '../lib/catalog';
import type { Result } from '../lib/catalog';
type QueryResult = { rows: any[]; rowCount?: number | null };
export type Database = {
  query: (sql: string, params?: any[]) => Promise<QueryResult>;
  transaction: <T>(work: (query: Database['query']) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
};
export async function openDatabase(path = process.env.DATABASE_URL): Promise<Database> {
  if (path?.startsWith('postgres')) {
    const pool = new Pool({ connectionString: path, max: 10, connectionTimeoutMillis: 5000 });
    return {
      query: (s, p) => pool.query(s, p),
      transaction: async (work) => {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          const result = await work((s, p) => c.query(s, p));
          await c.query('COMMIT');
          return result;
        } catch (e) {
          await c.query('ROLLBACK');
          throw e;
        } finally {
          c.release();
        }
      },
      close: () => pool.end(),
    };
  }
  const localPath = path || '.data/arcade';
  if (!localPath.startsWith('memory:')) await mkdir(dirname(localPath), { recursive: true });
  const db = new PGlite(localPath);
  let queue = Promise.resolve();
  return {
    query: (s, p) => db.query(s, p),
    transaction: <T>(work: (query: Database['query']) => Promise<T>) => {
      const task = queue.then(() => db.transaction((tx) => work((s, p) => tx.query(s, p))));
      queue = task.then(
        () => {},
        () => {},
      );
      return task;
    },
    close: () => db.close(),
  };
}
export async function migrate(db: Database) {
  const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  // Statements contain no functions or quoted semicolons.
  for (const statement of sql.split(';').filter((s) => s.trim())) await db.query(statement);
  for (const g of games)
    await db.query(
      'INSERT INTO games(id,title,authority) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title',
      [g.id, g.title, ['crossfire', 'frontier'].includes(g.id) ? 'server' : 'client'],
    );
}
export async function saveResult(
  db: Database,
  playerId: string,
  result: Result,
  verified = false,
  matchId?: string,
) {
  return db.transaction(async (query) => {
    const inserted = await query(
      'INSERT INTO runs(id,player_id,game_id,match_id,mode,score,duration_ms,won,stats,verified) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(player_id,id) DO NOTHING RETURNING id',
      [
        result.id,
        playerId,
        result.game,
        matchId || null,
        result.mode,
        result.score,
        result.durationMs,
        result.won,
        JSON.stringify(result.stats),
        verified,
      ],
    );
    if (!inserted.rows.length) return { duplicate: true };
    await query(
      `INSERT INTO progress(player_id,game_id,best,plays,wins,total_ms,stats) VALUES($1,$2,$3,1,$4,$5,$6)
 ON CONFLICT(player_id,game_id) DO UPDATE SET best=GREATEST(progress.best,EXCLUDED.best),plays=progress.plays+1,wins=progress.wins+EXCLUDED.wins,total_ms=progress.total_ms+EXCLUDED.total_ms,stats=EXCLUDED.stats,updated_at=now()`,
      [
        playerId,
        result.game,
        result.score,
        result.won ? 1 : 0,
        result.durationMs,
        JSON.stringify(result.stats),
      ],
    );
    return { duplicate: false };
  });
}
