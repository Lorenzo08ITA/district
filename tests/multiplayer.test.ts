import { it, expect } from 'vitest';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io, Socket } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import { openDatabase, migrate } from '../server/db';
import { createSession } from '../server/auth';
import { attachMultiplayer } from '../server/multiplayer';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
function event(socket: Socket, name: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout ${name}`)), 5000);
    socket.once(name, (value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}
it('due giocatori: auth socket, stanza arcade condivisa, validazione e risultati server', async () => {
  const db = await openDatabase('memory://');
  await migrate(db);
  const http = createServer(),
    server = new Server(http);
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  const stop = attachMultiplayer(server, db, origin, { matchMs: 1400 });
  const clients: Socket[] = [];
  try {
    const anonymous = io(origin, {
      extraHeaders: { origin },
      transports: ['websocket'],
      autoConnect: false,
      reconnection: false,
    });
    clients.push(anonymous);
    const rejected = event(anonymous, 'connect_error');
    anonymous.connect();
    expect((await rejected).message).toContain('Accedi');
    const playerIds: string[] = [];
    for (let i = 0; i < 2; i++) {
      const id = randomUUID();
      playerIds.push(id);
      await db.query('INSERT INTO players(id,email,name,password_hash) VALUES($1,$2,$3,$4)', [
        id,
        `${id}@example.com`,
        `P${i}`,
        'unused',
      ]);
      const token = await createSession(db, id);
      const socket = io(origin, {
        extraHeaders: { origin, Cookie: `arcade_session=${token}` },
        transports: ['websocket'],
        autoConnect: false,
        reconnection: false,
      });
      clients.push(socket);
      const connected = event(socket, 'connect');
      socket.connect();
      await connected;
      const retired: any = await new Promise((resolve) =>
        socket.emit('join', { game: 'crossfire' }, resolve),
      );
      expect(retired.error).toContain('lobby dedicata');
      const joined: any = await new Promise((resolve) =>
        socket.emit('join', { game: 'orbit' }, resolve),
      );
      expect(joined.error).toBeUndefined();
      expect(joined.playerId).toBe(id);
    }
    const a = clients[1],
      b = clients[2];
    const snap = await event(a, 'snapshot');
    expect(snap.actors).toHaveLength(2);
    expect(snap.id).toBe((await event(b, 'snapshot')).id);
    a.emit('input', { px: 99, pz: 99, score: 999999, x: 1, z: 1, yaw: 0 });
    await wait(180);
    const after = await event(a, 'snapshot');
    const actor = after.actors.find((a: any) => a.id === playerIds[0]);
    expect(actor.x).toBeLessThan(20);
    expect(actor.score).toBe(0);
    const finished = await event(a, 'finished');
    expect(finished.mode).toBe('online');
    const rows = await db.query('SELECT * FROM runs WHERE match_id=$1', [finished.id]);
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.every((r: any) => r.verified)).toBe(true);
  } finally {
    clients.forEach((c) => c.disconnect());
    await stop();
    server.close();
    http.close();
    await db.close();
  }
});
