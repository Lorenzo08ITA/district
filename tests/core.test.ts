import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { openDatabase, migrate, saveResult, type Database } from '../server/db';
import {
  hashPassword,
  verifyPassword,
  createSession,
  playerForCookie,
  sessionCookie,
  RateLimiter,
} from '../server/auth';
import { games, type Result } from '../lib/catalog';
import { resultSchema, inputSchema } from '../lib/validation';
import {
  createActor,
  stepShooter,
  blocked,
  createTerritory,
  conquer,
  stepTerritory,
  neighbors,
} from '../games/simulation';
import { evaluateGuess, words } from '../games/words';
import { quizQuestions } from '../games/questions';
let db: Database;
const player = randomUUID(),
  other = randomUUID();
beforeAll(async () => {
  db = await openDatabase('memory://');
  await migrate(db);
  for (const id of [player, other])
    await db.query('INSERT INTO players(id,email,name,password_hash) VALUES($1,$2,$3,$4)', [
      id,
      id + '@example.com',
      'Tester',
      await hashPassword('test-password-123'),
    ]);
});
afterAll(async () => {
  await db?.close();
});
const result = (): Result => ({
  id: randomUUID(),
  game: 'pulse',
  mode: 'offline',
  score: 70,
  durationMs: 14000,
  won: false,
  stats: { jumps: 3 },
});
describe('account e isolamento', () => {
  it('hash con sale e verifica password', async () => {
    const a = await hashPassword('secret-password');
    const b = await hashPassword('secret-password');
    expect(a).not.toBe(b);
    expect(await verifyPassword('secret-password', a)).toBe(true);
    expect(await verifyPassword('wrong', a)).toBe(false);
  });
  it('sessione opaca, cookie HttpOnly e scadenza', async () => {
    const token = await createSession(db, player);
    expect((await playerForCookie(db, sessionCookie(token, false)))?.id).toBe(player);
    expect(sessionCookie(token, true)).toContain('Secure');
    expect(sessionCookie(token, false)).toContain('HttpOnly');
    expect(await playerForCookie(db, 'arcade_session=invalid')).toBeNull();
    await db.query('UPDATE sessions SET expires_at=$1 WHERE player_id=$2', [new Date(0), player]);
    expect(await playerForCookie(db, sessionCookie(token, false))).toBeNull();
  });
  it('limita tentativi e recupera dopo finestra', () => {
    const limit = new RateLimiter(2, 100);
    expect(limit.allow('ip', 1)).toBe(true);
    expect(limit.allow('ip', 2)).toBe(true);
    expect(limit.allow('ip', 3)).toBe(false);
    expect(limit.allow('ip', 102)).toBe(true);
  });
});
describe('persistenza atomica', () => {
  it('ritenti concorrenti non duplicano punteggi', async () => {
    const r = result();
    await Promise.all(Array.from({ length: 8 }, () => saveResult(db, player, r)));
    const { rows } = await db.query('SELECT * FROM progress WHERE player_id=$1 AND game_id=$2', [
      player,
      'pulse',
    ]);
    expect(rows[0].plays).toBe(1);
    expect(rows[0].best).toBe(70);
    expect(Number(rows[0].total_ms)).toBe(14000);
  });
  it('stesso identificatore su account diversi resta isolato', async () => {
    const r = result();
    await saveResult(db, other, r);
    const q = await db.query('SELECT * FROM runs WHERE player_id=$1', [other]);
    expect(q.rows).toHaveLength(1);
    expect(q.rows[0].player_id).toBe(other);
  });
  it('rollback conserva consistenza su gioco sconosciuto', async () => {
    const r = { ...result(), game: 'invalid' } as unknown as Result;
    await expect(saveResult(db, player, r)).rejects.toThrow();
    const q = await db.query('SELECT * FROM runs WHERE id=$1', [r.id]);
    expect(q.rows).toHaveLength(0);
  });
  it('conserva tutti i risultati e il record massimo', async () => {
    const a = { ...result(), game: 'wing' as const, score: 40, won: true },
      b = { ...result(), game: 'wing' as const, score: 2 };
    await saveResult(db, player, a);
    await saveResult(db, player, b);
    const q = await db.query('SELECT * FROM progress WHERE player_id=$1 AND game_id=$2', [
      player,
      'wing',
    ]);
    expect(q.rows[0].plays).toBe(2);
    expect(q.rows[0].best).toBe(40);
    expect(q.rows[0].wins).toBe(1);
  });
});
describe('validazione confini', () => {
  it('rifiuta NaN, valori enormi e payload eccessivi', () => {
    expect(resultSchema.safeParse({ ...result(), score: NaN }).success).toBe(false);
    expect(inputSchema.safeParse({ px: Infinity }).success).toBe(false);
    expect(inputSchema.safeParse({ x: 100 }).success).toBe(false);
    expect(resultSchema.safeParse({ ...result(), stats: { huge: 'x'.repeat(8193) } }).success).toBe(
      false,
    );
  });
});
describe('simulazione autoritativa', () => {
  it('normalizza movimento diagonale e impedisce uscita arena', () => {
    const a = createActor('a', 'A', 0);
    a.x = 15;
    a.z = 15;
    a.input = { x: 1, z: 1, yaw: 0, pitch: 0, fire: false };
    const start = { x: a.x, z: a.z };
    stepShooter([a], 1 / 30);
    expect(Math.hypot(a.x - start.x, a.z - start.z)).toBeCloseTo(7 / 30);
    for (let i = 0; i < 1000; i++) stepShooter([a], 1 / 30);
    expect(blocked(a.x, a.z)).toBe(false);
  });
  it('colpi rispettano muri e cooldown', () => {
    const a = createActor('a', 'A', 0),
      b = createActor('b', 'B', 1);
    a.x = 0;
    a.z = 8;
    b.x = 0;
    b.z = -8;
    a.input = { x: 0, z: 0, yaw: 0, pitch: 0, fire: true };
    stepShooter([a, b], 1 / 30);
    expect(b.hp).toBe(100);
    a.x = 15;
    b.x = 15;
    a.cooldown = 0;
    stepShooter([a, b], 1 / 30);
    expect(b.hp).toBe(75);
    stepShooter([a, b], 1 / 30);
    expect(b.hp).toBe(75);
  });
  it('conquista solo territori adiacenti e trasferisce capitale', () => {
    const t = createTerritory(2);
    expect(conquer(t, 0, 500)).toBe(false);
    const n = neighbors(t.capitals[0]).find((i) => t.owners[i] === -1)!;
    expect(conquer(t, 0, n)).toBe(true);
    const target = t.capitals[1],
      source = neighbors(target)[0];
    t.owners[source] = 0;
    t.armies[source] = 100;
    t.armies[target] = 1;
    expect(conquer(t, 0, target)).toBe(true);
    expect(t.alive[1]).toBe(false);
    expect(t.owners[target]).toBe(0);
  });
  it('genera truppe solo nei territori occupati', () => {
    const t = createTerritory(2);
    for (let i = 0; i < 15; i++) stepTerritory(t);
    expect(t.armies[t.capitals[0]]).toBe(28);
    expect(t.armies.find((_, i) => t.owners[i] === -1)).toBe(0);
  });
});
describe('giochi e catalogo', () => {
  it('catalogo unico con 3 giochi 3D e modalità coerenti', () => {
    expect(new Set(games.map((g) => g.id)).size).toBe(games.length);
    expect(games.filter((g) => g.dimension === '3D')).toHaveLength(3);
    expect(games.every((g) => g.online || g.offline)).toBe(true);
  });
  it('Wordle rispetta quantità lettere duplicate', () => {
    expect(evaluateGuess('mamma', 'amica')).toEqual([
      'present',
      'present',
      'absent',
      'absent',
      'exact',
    ]);
    expect(evaluateGuess('cassa', 'cassa')).toEqual(Array(5).fill('exact'));
    expect(words.length).toBeGreaterThan(200);
    expect(words.every((w) => /^[a-z]{5}$/.test(w))).toBe(true);
  });
  it.each(['trivia', 'geography', 'flags'])(
    'quiz %s senza duplicati e con una sola risposta corretta',
    (kind) => {
      const q = quizQuestions(kind);
      expect(q).toHaveLength(10);
      expect(new Set(q.map((q) => q.prompt + (q.flag || ''))).size).toBe(10);
      expect(
        q.every(
          (q) =>
            q.choices.length === 4 && new Set(q.choices).size === 4 && q.choices.includes(q.answer),
        ),
      ).toBe(true);
    },
  );
});
