import type { Server } from 'node:http';
import { attachRts, type SavedRoom, type MatchResult } from '../packages/server/src/index';
import { decodeWire, encodeWire, WireKind, type GameCommand } from '@district/rts-shared';
import { playerForCookie } from './auth';
import { saveResult, type Database } from './db';
export function attachDistrictRts(server: Server, db: Database, origin: string) {
  return attachRts(server, {
    origin,
    authenticate: (cookie) => playerForCookie(db, cookie),
    store: {
      async load(code) {
        const q = await db.query('SELECT id,state FROM rts_rooms WHERE code=$1', [code]);
        if (!q.rows.length) return null;
        const row = q.rows[0],
          state = decodeWire(new Uint8Array(row.state)).value as SavedRoom;
        const frames = await db.query(
          'SELECT tick,commands FROM rts_frames WHERE room_id=$1 AND tick>$2 ORDER BY tick',
          [row.id, state.snapshot?.tick ?? 0],
        );
        return {
          state,
          frames: frames.rows.map((r) => ({
            tick: Number(r.tick),
            commands: decodeWire(new Uint8Array(r.commands)).value as GameCommand[],
          })),
        };
      },
      async save(room) {
        await db.transaction(async (query) => {
          await query(
            'INSERT INTO rts_rooms(id,code,state,updated_at) VALUES($1,$2,$3,now()) ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state,updated_at=now()',
            [room.id, room.code, Buffer.from(encodeWire(WireKind.Snapshot, room))],
          );
          await query('DELETE FROM rts_frames WHERE room_id=$1 AND tick<=$2', [
            room.id,
            room.snapshot?.tick ?? 0,
          ]);
        });
      },
      async append(id, tick, commands) {
        await db.query('INSERT INTO rts_frames(room_id,tick,commands) VALUES($1,$2,$3)', [
          id,
          tick,
          Buffer.from(encodeWire(WireKind.Commands, commands)),
        ]);
      },
      async result(accountId, result: MatchResult) {
        await saveResult(db, accountId, result, true);
        const q = await db.query(
          'SELECT score,duration_ms,won,stats FROM runs WHERE player_id=$1 AND id=$2',
          [accountId, result.id],
        );
        const row = q.rows[0]!;
        return {
          ...result,
          score: Number(row.score),
          durationMs: Number(row.duration_ms),
          won: row.won,
          stats: row.stats,
        };
      },
    },
  });
}
