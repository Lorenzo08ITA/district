import { afterEach, describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import {
  attachFps,
  type FpsResult,
  type FpsCheckpoint,
} from '../../packages/server/src/fps/service';
import { encodeWire, decodeWire, WireKind } from '@district/rts-shared';
import { PacketWriter, PlayerInput, FpsPacketKind } from '@district/rts-shared/fps';
class Client {
  socket: WebSocket;
  packets: any[] = [];
  constructor(url: string, cookie: string, origin = 'http://district.test') {
    this.socket = new WebSocket(url, { headers: { Cookie: cookie, Origin: origin } });
    this.socket.on('error', () => {});
    this.socket.on('message', (raw) => {
      const bytes = raw as Buffer;
      if (bytes[0] === 0x46) return;
      this.packets.push(decodeWire(bytes).value);
    });
  }
  send(value: unknown) {
    this.socket.send(encodeWire(WireKind.Control, value));
  }
  async wait(type: string) {
    for (let n = 0; n < 400; n++) {
      const i = this.packets.findIndex((p) => p.type === type);
      if (i >= 0) return this.packets.splice(i, 1)[0];
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('Timeout ' + type + ': ' + JSON.stringify(this.packets));
  }
}
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
async function setup(debugAllowed = true) {
  const server = createServer(),
    saved = new Map<string, { value: FpsResult; verified: boolean }>(),
    checkpoints: FpsCheckpoint[] = [],
    closed: string[] = [],
    service = attachFps(server, {
      origin: 'http://district.test',
      debugAllowed,
      authenticate: async (cookie) =>
        cookie === 'alpha' || cookie === 'beta' ? { id: cookie, name: cookie } : null,
      store: {
        async checkpoint(s) {
          checkpoints.push(structuredClone(s));
        },
        async result(account, value, verified) {
          const key = account + value.id;
          if (!saved.has(key)) saved.set(key, { value, verified });
          return saved.get(key)!.value;
        },
        async closeMatch(id) {
          closed.push(id);
        },
      },
    });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = 'ws://127.0.0.1:' + (server.address() as { port: number }).port + '/fps/socket',
    clients: Client[] = [];
  cleanup.push(async () => {
    for (const c of clients) c.socket.terminate();
    await service.close();
    await new Promise<void>((r) => server.close(() => r()));
  });
  return {
    url,
    saved,
    checkpoints,
    closed,
    service,
    async client(cookie = 'alpha') {
      const c = new Client(url, cookie);
      clients.push(c);
      await c.wait('ready');
      return c;
    },
  };
}
const config = (type = 'create', debug = false) => ({
  type,
  map: 'nexus',
  mode: 'tdm',
  debug,
  tabId: crypto.randomUUID(),
  bots: 0,
});
describe('FPS websocket trust boundary', () => {
  it('rejects missing authentication and foreign origins', async () => {
    const { url } = await setup();
    for (const [cookie, origin] of [
      ['missing', 'http://district.test'],
      ['alpha', 'https://evil.test'],
    ]) {
      const ws = new WebSocket(url, { headers: { Cookie: cookie, Origin: origin } });
      const code = await new Promise<number>((resolve) => {
        ws.on('unexpected-response', (_, response) => {
          response.resume();
          ws.terminate();
          resolve(response.statusCode!);
        });
        ws.on('error', () => {});
      });
      expect(code).toBe(cookie === 'missing' ? 401 : 403);
    }
  });
  it('isolates two debug tabs on the same account, starts only as host and saves unranked results', async () => {
    const app = await setup(),
      a = await app.client(),
      b = await app.client();
    a.send(config('create', true));
    const first = await a.wait('welcome');
    b.send({ type: 'join', code: first.code, debug: true, tabId: crypto.randomUUID() });
    const second = await b.wait('welcome');
    expect(second.playerId).not.toBe(first.playerId);
    b.send({ type: 'start' });
    expect((await b.wait('error')).message).toContain('creatore');
    a.send({ type: 'start' });
    let lobby = await b.wait('lobby');
    while (!lobby.started) lobby = await b.wait('lobby');
    expect(lobby.players.filter((p: any) => !p.bot)).toHaveLength(2);
    a.send({ type: 'bots', count: 5, reactionMs: 100 });
    lobby = await a.wait('lobby');
    while (lobby.players.length < 7) lobby = await a.wait('lobby');
    expect(lobby.players.filter((p: any) => p.bot)).toHaveLength(5);
    a.send({ type: 'finish' });
    await a.wait('result');
    expect(app.saved.size).toBe(1);
    expect([...app.saved.values()][0]!.verified).toBe(false);
    b.send({ type: 'finish' });
    await b.wait('result');
    expect(app.saved.size).toBe(2);
    expect(new Set([...app.saved.values()].map((s) => s.value.id)).size).toBe(2);
  });
  it('normal quickplay joins distinct accounts and stores verified results', async () => {
    const app = await setup(),
      a = await app.client(),
      b = await app.client('beta');
    a.send(config('quick'));
    const first = await a.wait('welcome');
    b.send(config('quick'));
    const second = await b.wait('welcome');
    expect(second.code).toBe(first.code);
    a.send({ type: 'finish' });
    const result = await a.wait('result');
    expect(result.result.game).toBe('crossfire');
    expect([...app.saved.values()][0]!.verified).toBe(true);
  });
  it('disables debug on production and denies debug tools in normal rooms', async () => {
    const app = await setup(false),
      a = await app.client();
    a.send(config('create', true));
    expect((await a.wait('error')).message).toContain('Debug disabilitato');
    a.send(config());
    await a.wait('welcome');
    a.send({ type: 'bots', count: 1, reactionMs: 100 });
    expect((await a.wait('error')).message).toContain('debug');
  });
  it('validates packet sequences without accepting client positions or results', async () => {
    const app = await setup(),
      a = await app.client();
    a.send(config('quick'));
    await a.wait('welcome');
    const input = new PlayerInput();
    input.sequenceNumber = 999;
    const writer = new PacketWriter();
    a.socket.send(writer.begin(FpsPacketKind.Inputs).input(input).finish());
    expect((await a.wait('error')).message).toContain('Sequenza');
    a.send({ type: 'result', score: 99999 });
    expect((await a.wait('error')).message).toContain('non valida');
    a.send({ type: 'resync' });
    expect((await a.wait('welcome')).nextSequence).toBe(1);
  });
  it('revokes live sockets when authentication is logged out', async () => {
    const app = await setup(),
      a = await app.client();
    const closed = new Promise<number>((resolve) => a.socket.on('close', resolve));
    app.service.revoke('alpha');
    expect(await closed).toBe(1008);
  });
});
