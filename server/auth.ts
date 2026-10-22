import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { Database } from './db';
const scrypt = promisify(scryptCallback);
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${((await scrypt(password, salt, 64)) as Buffer).toString('hex')}`;
}
export async function verifyPassword(password: string, hash: string) {
  const [salt, key] = hash.split(':');
  const candidate = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(key, 'hex');
  return expected.length === candidate.length && timingSafeEqual(candidate, expected);
}
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export function cookieToken(cookie = '') {
  return (
    cookie
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('arcade_session='))
      ?.slice(15) || ''
  );
}
export async function playerForCookie(db: Database, cookie?: string) {
  const token = cookieToken(cookie);
  if (!token) return null;
  const { rows } = await db.query(
    'SELECT p.id,p.name,p.email,p.preferences FROM sessions s JOIN players p ON p.id=s.player_id WHERE s.token_hash=$1 AND s.expires_at>now()',
    [tokenHash(token)],
  );
  return rows[0] || null;
}
export async function createSession(db: Database, playerId: string) {
  const token = randomBytes(32).toString('hex');
  await db.query('INSERT INTO sessions(token_hash,player_id,expires_at) VALUES($1,$2,$3)', [
    tokenHash(token),
    playerId,
    new Date(Date.now() + 30 * 86400000),
  ]);
  return token;
}
export function sessionCookie(token: string, production: boolean) {
  return `arcade_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${token ? 2592000 : 0}${production ? '; Secure' : ''}`;
}
export class RateLimiter {
  private entries = new Map<string, { count: number; reset: number }>();
  constructor(
    private max = 100,
    private windowMs = 60000,
  ) {}
  allow(key: string, now = Date.now()) {
    for (const [k, v] of this.entries) if (v.reset <= now) this.entries.delete(k);
    const entry = this.entries.get(key) || { count: 0, reset: now + this.windowMs };
    entry.count++;
    if (this.entries.size >= 10000 && !this.entries.has(key)) return false;
    this.entries.set(key, entry);
    return entry.count <= this.max;
  }
}
