import { afterEach, describe, it, expect, vi } from 'vitest';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { attachRts, type SavedRoom, type MatchResult } from '../../packages/server/src/index';
import { GameEngine, type EngineSnapshot } from '@district/rts-engine';
import {
  encodeWire,
  decodeWire,
  encodeCommands,
  decodeCommands,
  WireKind,
  CommandKind,
  type GameCommand,
} from '@district/rts-shared';
class Store {
  rooms = new Map<string, SavedRoom>();
  frames = new Map<string, { tick: number; commands: GameCommand[] }[]>();
  results = new Map<string, MatchResult>();
  broken = false;
  async load(code: string) {
    const state = this.rooms.get(code);
    return state
      ? {
          state: structuredClone(state),
          frames: structuredClone(
            (this.frames.get(state.id) ?? []).filter((f) => f.tick > (state.snapshot?.tick ?? 0)),
          ),
        }
      : null;
  }
  async save(room: SavedRoom) {
    this.rooms.set(room.code, structuredClone(room));
  }
  async append(id: string, tick: number, commands: readonly GameCommand[]) {
    if (this.broken) throw new Error('storage unavailable');
    const frames = this.frames.get(id) ?? [];
    frames.push({ tick, commands: structuredClone([...commands]) });
    this.frames.set(id, frames);
  }
  async result(account: string, result: MatchResult) {
    const key = account + result.id;
    if (!this.results.has(key)) this.results.set(key, structuredClone(result));
    return this.results.get(key)!;
  }
}
class Client {
  packets: { kind: WireKind; value: any }[] = [];
  socket: WebSocket;
  constructor(url: string, cookie: string, origin: string) {
    this.socket = new WebSocket(url, { headers: { Cookie: cookie, Origin: origin } });
    this.socket.on('message', (data) => this.packets.push(decodeWire(data as Buffer)));
    this.socket.on('error', () => {});
  }
  async wait(predicate: (p: { kind: WireKind; value: any }) => boolean) {
    for (let i = 0; i < 400; i++) {
      const index = this.packets.findIndex(predicate);
      if (index >= 0) return this.packets.splice(index, 1)[0]!;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(
      'Packet timeout: ' + JSON.stringify(this.packets.map((p) => [p.kind, p.value.type])),
    );
  }
  control(value: unknown) {
    this.socket.send(encodeWire(WireKind.Control, value));
  }
}
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
async function setup(store = new Store(), maxTicks = 3600) {
  const http = createServer(),
    origin = 'http://district.test';
  const service = attachRts(http, {
    origin,
    store,
    maxTicks,
    authenticate: async (cookie) =>
      cookie === 'alpha' || cookie === 'beta' || cookie === 'third'
        ? { id: cookie, name: cookie }
        : null,
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  const port = (http.address() as { port: number }).port,
    clients: Client[] = [];
  cleanup.push(async () => {
    for (const client of clients) client.socket.terminate();
    await service.close();
    await new Promise<void>((r) => http.close(() => r()));
  });
  return {
    store,
    service,
    async client(cookie: string) {
      const c = new Client('ws://127.0.0.1:' + port + '/rts/socket', cookie, origin);
      clients.push(c);
      await c.wait((p) => p.value.type === 'ready');
      return c;
    },
  };
}
describe('authoritative RTS rooms', () => {
  it('authenticates upgrades and rejects a foreign origin', async () => {
    const http = createServer(),
      service = attachRts(http, {
        origin: 'http://allowed',
        store: new Store(),
        authenticate: async () => null,
      });
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    cleanup.push(async () => {
      await service.close();
      await new Promise<void>((r) => http.close(() => r()));
    });
    for (const origin of ['http://foreign', 'http://allowed']) {
      const status = await new Promise<number>((resolve) => {
        const ws = new WebSocket(
          'ws://127.0.0.1:' + (http.address() as { port: number }).port + '/rts/socket',
          { origin },
        );
        ws.on('unexpected-response', (_req, res) => {
          resolve(res.statusCode!);
          res.resume();
          ws.terminate();
        });
        ws.on('error', () => {});
      });
      expect(status).toBe(origin.includes('foreign') ? 403 : 401);
    }
  });
  it('isolates identities, replays accepted commands, reconnects and saves one result', async () => {
    const setupResult = await setup(),
      a = await setupResult.client('alpha'),
      b = await setupResult.client('beta');
    a.control({ type: 'create', layout: 'continents', bots: 0 });
    const code = (await a.wait((p) => p.value.type === 'lobby')).value.code;
    b.control({ type: 'join', code });
    await b.wait((p) => p.value.type === 'lobby');
    b.control({ type: 'start' });
    expect((await b.wait((p) => p.value.type === 'error')).value.message).toContain('creatore');
    a.control({ type: 'start' });
    const snapshot = (await a.wait((p) => p.kind === WireKind.Snapshot)).value as {
      snapshot: EngineSnapshot;
      playerId: number;
      hash: number;
    };
    await b.wait((p) => p.kind === WireKind.Snapshot);
    const replica = GameEngine.fromSnapshot(snapshot.snapshot);
    expect(replica.stateHash()).toBe(snapshot.hash);
    const tile = replica.map.borderTiles(1)[0]!,
      target = [tile - 1, tile + 1, tile - replica.map.width, tile + replica.map.width].find(
        (t) =>
          t >= 0 && t < replica.map.length && replica.map.ownerId[t] === 0 && replica.map.isLand(t),
      )!;
    b.socket.send(
      encodeWire(
        WireKind.Commands,
        new Uint8Array(
          encodeCommands([
            {
              kind: CommandKind.Attack,
              playerId: 1,
              sequence: 0,
              executeTick: 1,
              targetTile: target,
              allocationBps: 3000,
            },
          ]),
        ),
      ),
    );
    expect((await b.wait((p) => p.value.type === 'error')).value.message).toContain('Identità');
    a.socket.send(
      encodeWire(
        WireKind.Commands,
        new Uint8Array(
          encodeCommands([
            {
              kind: CommandKind.Attack,
              playerId: 1,
              sequence: 0,
              executeTick: 1,
              targetTile: target,
              allocationBps: 3000,
            },
          ]),
        ),
      ),
    );
    let accepted = false;
    for (let n = 0; n < 10; n++) {
      const tick = (await a.wait((p) => p.kind === WireKind.Tick)).value;
      for (const command of decodeCommands(tick.commands)) {
        accepted = true;
        expect(replica.enqueue(command).accepted).toBe(true);
      }
      replica.tick();
      if (tick.hash !== null) expect(replica.stateHash()).toBe(tick.hash);
    }
    expect(accepted).toBe(true);
    expect(replica.getPlayer(1)!.landSize).toBeGreaterThan(snapshot.snapshot.players.length);
    a.socket.close();
    await new Promise((r) => setTimeout(r, 150));
    const rejoined = await setupResult.client('alpha');
    rejoined.control({ type: 'join', code });
    const rejoin = (await rejoined.wait((p) => p.kind === WireKind.Snapshot)).value;
    expect(rejoin.snapshot.tick).toBeGreaterThanOrEqual(replica.currentTick);
    expect(GameEngine.fromSnapshot(rejoin.snapshot).stateHash()).toBe(rejoin.hash);
    rejoined.control({ type: 'finish' });
    const result = (await rejoined.wait((p) => p.value.type === 'result')).value.result;
    expect(result.stats.abandoned).toBe(true);
    expect(setupResult.store.results.size).toBe(1);
    expect(result.mode).toBe('online');
    rejoined.control({ type: 'finish' });
    const retry = (await rejoined.wait((p) => p.value.type === 'result')).value.result;
    expect(retry).toEqual(result);
    expect(setupResult.store.results.size).toBe(1);
  });
  it('recovers the durable journal after service restart', async () => {
    const store = new Store(),
      first = await setup(store),
      a = await first.client('alpha');
    a.control({ type: 'create', layout: 'archipelago', bots: 1 });
    const code = (await a.wait((p) => p.value.type === 'lobby')).value.code;
    a.control({ type: 'start' });
    await a.wait((p) => p.kind === WireKind.Snapshot);
    await a.wait((p) => p.kind === WireKind.Tick && p.value.tick >= 3);
    a.socket.close();
    await new Promise((r) => setTimeout(r, 100));
    const state = structuredClone(store.rooms.get(code)!),
      frames = structuredClone(store.frames.get(state.id)!);
    const expected = GameEngine.fromSnapshot(state.snapshot!);
    for (const frame of frames) {
      for (const command of frame.commands) expected.enqueue(command);
      expected.tick();
    }
    const second = await setup(store),
      b = await second.client('alpha');
    b.control({ type: 'join', code });
    const snapshot = (await b.wait((p) => p.kind === WireKind.Snapshot)).value;
    expect(snapshot.hash).toBe(expected.stateHash());
    expect(snapshot.snapshot.tick).toBe(expected.currentTick);
  });
  it('ends on the server time limit and stores authoritative results', async () => {
    const env = await setup(new Store(), 3),
      a = await env.client('alpha');
    a.control({ type: 'create', layout: 'strait', bots: 1 });
    await a.wait((p) => p.value.type === 'lobby');
    a.control({ type: 'start' });
    const result = (await a.wait((p) => p.value.type === 'result')).value.result;
    expect(result.durationMs).toBe(300);
    expect(result.stats.ticks).toBe(3);
    expect(env.store.results.size).toBe(1);
  });
});

it('persists the final result for a disconnected member', async () => {
  const env = await setup(new Store(), 5),
    a = await env.client('alpha'),
    b = await env.client('beta');
  a.control({ type: 'create', layout: 'continents', bots: 0 });
  const code = (await a.wait((p) => p.value.type === 'lobby')).value.code;
  b.control({ type: 'join', code });
  await b.wait((p) => p.value.type === 'lobby');
  a.control({ type: 'start' });
  await b.wait((p) => p.kind === WireKind.Snapshot);
  b.socket.close();
  await a.wait((p) => p.value.type === 'result');
  expect(env.store.results.size).toBe(2);
});
it('suspends on a journal failure and resumes only durable ticks', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const env = await setup(),
      a = await env.client('alpha');
    a.control({ type: 'create', layout: 'strait', bots: 1 });
    const code = (await a.wait((p) => p.value.type === 'lobby')).value.code;
    a.control({ type: 'start' });
    await a.wait((p) => p.kind === WireKind.Tick && p.value.tick >= 2);
    env.store.broken = true;
    expect((await a.wait((p) => p.value.type === 'error')).value.message).toContain('sospesa');
    const persisted = (await env.store.load(code))!,
      expected = GameEngine.fromSnapshot(persisted.state.snapshot!);
    for (const frame of persisted.frames) {
      for (const command of frame.commands) expected.enqueue(command);
      expected.tick();
    }
    env.store.broken = false;
    const b = await env.client('alpha');
    b.control({ type: 'join', code });
    const restored = (await b.wait((p) => p.kind === WireKind.Snapshot)).value;
    expect(restored.hash).toBe(expected.stateHash());
  } finally {
    log.mockRestore();
  }
});
