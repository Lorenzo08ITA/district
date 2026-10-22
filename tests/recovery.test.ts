import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { openDatabase, migrate } from '../server/db';
import { recoverMatches } from '../server/recovery';
it('recupera risultati multiplayer dopo arresto e resta idempotente', async () => {
  const db = await openDatabase('memory://');
  try {
    await migrate(db);
    const id = randomUUID(),
      match = randomUUID();
    await db.query('INSERT INTO players(id,email,name,password_hash) VALUES($1,$2,$3,$4)', [
      id,
      'recovery@test.it',
      'Recovery',
      'unused',
    ]);
    await db.query('INSERT INTO matches(id,game_id,state) VALUES($1,$2,$3)', [
      match,
      'crossfire',
      JSON.stringify({ elapsed: 3500, actors: [{ id, score: 200, kills: 2, deaths: 1 }] }),
    ]);
    await recoverMatches(db);
    await recoverMatches(db);
    const q = await db.query('SELECT * FROM runs WHERE player_id=$1', [id]);
    expect(q.rows).toHaveLength(1);
    expect(q.rows[0].score).toBe(200);
    expect(q.rows[0].stats.interrupted).toBe(true);
    expect(q.rows[0].verified).toBe(true);
  } finally {
    await db.close();
  }
});
