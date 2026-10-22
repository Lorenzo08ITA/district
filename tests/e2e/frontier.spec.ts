import { test, expect, type Page } from '@playwright/test';
import { decodeWire } from '@district/rts-shared';
import { GameEngine, type EngineSnapshot } from '@district/rts-engine';
async function open(page: Page, online = false) {
  await page.goto('/');
  if (online)
    await page
      .locator('.game-frontier')
      .getByRole('button', { name: 'Online', exact: false })
      .click();
  else await page.getByRole('button', { name: 'Gioca a Frontier', exact: true }).click();
  await page.getByRole('button', { name: 'Inizia', exact: false }).click();
}
async function saved(page: Page) {
  const bytes = await page.evaluate(
    async () =>
      new Promise<string | null>((resolve, reject) => {
        const request = indexedDB.open('district-rts-v1', 1);
        request.onsuccess = () => {
          const db = request.result,
            get = db.transaction('saves').objectStore('saves').get('guest');
          get.onsuccess = () => {
            if (get.result) {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result).split(',')[1]!);
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(new Blob([get.result]));
            } else resolve(null);
            db.close();
          };
          get.onerror = () => reject(get.error);
        };
        request.onerror = () => reject(request.error);
      }),
  );
  return bytes
    ? (decodeWire(Buffer.from(bytes, 'base64')).value as {
        snapshot: EngineSnapshot;
        layout: string;
      })
    : null;
}
test('Frontier: Worker, conquista, costruzione e ripresa locale', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  await page.getByRole('button', { name: 'Nuova partita', exact: true }).click();
  await expect(page.locator('.rts-hud')).toBeVisible();
  await expect
    .poll(async () => Number(await page.locator('.rts-game').getAttribute('data-tick')))
    .toBeGreaterThan(20);
  const checkpoint = (await saved(page))!;
  expect(checkpoint.snapshot.tick).toBeGreaterThan(0);
  expect(checkpoint.layout).toBe('world');
  expect(checkpoint.snapshot.map.width).toBe(512);
  const engine = GameEngine.fromSnapshot(checkpoint.snapshot),
    initial = engine.getPlayer(1)!.landSize;
  const border = engine.map
    .borderTiles(1)
    .find((tile) =>
      [tile - 1, tile + 1, tile - engine.map.width, tile + engine.map.width].some(
        (t) =>
          t >= 0 && t < engine.map.length && engine.map.isLand(t) && engine.map.ownerId[t] === 0,
      ),
    )!;
  const target = [
    border - 1,
    border + 1,
    border - engine.map.width,
    border + engine.map.width,
  ].find(
    (t) => t >= 0 && t < engine.map.length && engine.map.isLand(t) && engine.map.ownerId[t] === 0,
  )!;
  const canvas = page.getByLabel('Mappa Frontier'),
    box = (await canvas.boundingBox())!,
    zoom = Math.min(box.width / engine.map.width, box.height / engine.map.height) * 0.9;
  const point = (tile: number) => ({
    x: ((tile % engine.map.width) + 0.5 - engine.map.width / 2) * zoom + box.width / 2,
    y: (Math.floor(tile / engine.map.width) + 0.5 - engine.map.height / 2) * zoom + box.height / 2,
  });
  await canvas.click({ position: point(target) });
  await expect
    .poll(async () => {
      const value = await saved(page);
      return value ? GameEngine.fromSnapshot(value.snapshot).getPlayer(1)!.landSize : 0;
    })
    .toBeGreaterThan(initial);
  await page.locator('.rts-tools button[title^="Città ·"]').click();
  const current = GameEngine.fromSnapshot((await saved(page))!.snapshot),
    own = current.map.ownerId.findIndex(
      (owner, tile) => owner === 1 && current.map.buildingId[tile] === 0,
    );
  expect(own).toBeGreaterThanOrEqual(0);
  await canvas.click({ position: point(own) });
  await expect
    .poll(
      async () =>
        (await saved(page))?.snapshot.world.buildings.filter((b) => b.ownerId === 1).length ?? 0,
    )
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pausa', exact: true }).click();
  await page.screenshot({ path: 'docs/screenshots/frontier-offline.png' });
  const before = Number(await page.locator('.rts-game').getAttribute('data-tick'));
  await page.reload();
  await page.getByRole('button', { name: 'Gioca a Frontier', exact: true }).click();
  await page.getByRole('button', { name: 'Inizia', exact: false }).click();
  await page.getByRole('button', { name: 'Riprendi mondo', exact: false }).click();
  await expect
    .poll(async () => Number(await page.locator('.rts-game').getAttribute('data-tick')))
    .toBeGreaterThanOrEqual(before - 20);
  expect(errors).toEqual([]);
});
test('Frontier: due account, lobby, checksum Worker, riconnessione e risultato verificato', async ({
  browser,
}) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    const pages: Page[] = [];
    for (let i = 0; i < 2; i++) {
      const context = contexts[i]!;
      const registered = await context.request.post('http://localhost:3000/api/auth/register', {
        headers: { Origin: 'http://localhost:3000' },
        data: {
          name: 'Confine ' + i,
          email: 'rts-' + Date.now() + '-' + i + '@example.com',
          password: 'secure-test-password',
        },
      });
      expect(registered.status()).toBe(200);
      const page = await context.newPage();
      if (i === 1)
        await page.addInitScript(() => {
          const scope = window as unknown as { rtsCorrupted: boolean; rtsResyncs: number };
          scope.rtsCorrupted = false;
          scope.rtsResyncs = 0;
          const post = Worker.prototype.postMessage;
          Worker.prototype.postMessage = function (
            message: unknown,
            options?: StructuredSerializeOptions | Transferable[],
          ) {
            const packet = message as { type: string; frame?: { hash: number | null } };
            if (
              packet.type === 'tick' &&
              packet.frame?.hash !== null &&
              packet.frame?.hash !== undefined &&
              !scope.rtsCorrupted
            ) {
              packet.frame.hash ^= 1;
              scope.rtsCorrupted = true;
            }
            return Reflect.apply(post, this, [message, options]);
          };
          const send = WebSocket.prototype.send;
          WebSocket.prototype.send = function (data) {
            if (data instanceof ArrayBuffer) {
              const view = new DataView(data);
              if (view.getUint16(6, true) === 1) {
                const value = JSON.parse(
                  new TextDecoder().decode(new Uint8Array(data, 16, view.getUint32(8, true))),
                );
                if (value.type === 'resync') scope.rtsResyncs++;
              }
            }
            return Reflect.apply(send, this, [data]);
          };
        });
      pages.push(page);
      await open(page, true);
    }
    const a = pages[0]!,
      b = pages[1]!;
    await a.getByLabel('Numero bot').selectOption('1');
    await a.getByRole('button', { name: 'Crea lobby', exact: true }).click();
    await expect(a.locator('.rts-code')).toBeVisible();
    const code = (await a.locator('.rts-code').innerText()).slice(0, 6);
    await b.getByLabel('Codice lobby').fill(code);
    await b.getByRole('button', { name: 'Entra', exact: true }).click();
    await expect(b.locator('.rts-setup')).toContainText('Confine 0');
    await a.getByRole('button', { name: 'Avvia partita', exact: true }).click();
    for (const page of pages) await expect(page.locator('.rts-hud')).toBeVisible();
    await expect
      .poll(
        async () => {
          const values = await Promise.all(
            pages.map(async (p) => [
              await p.locator('.rts-game').getAttribute('data-hash-tick'),
              await p.locator('.rts-game').getAttribute('data-checksum'),
            ]),
          );
          return Number(values[0]![0]) >= 10 && values[0]!.join(':') === values[1]!.join(':');
        },
        { timeout: 15000 },
      )
      .toBe(true);
    expect(
      await b.evaluate(() => (window as unknown as { rtsResyncs: number }).rtsResyncs),
    ).toBeGreaterThan(0);
    await b.reload();
    await b.locator('.game-frontier').getByRole('button', { name: 'Online', exact: false }).click();
    await b.getByRole('button', { name: 'Inizia', exact: false }).click();
    await expect(b.locator('.rts-hud')).toBeVisible();
    await expect
      .poll(async () => Number(await b.locator('.rts-game').getAttribute('data-tick')))
      .toBeGreaterThan(10);
    await a.screenshot({ path: 'docs/screenshots/frontier-online.png' });
    await a.getByRole('button', { name: 'Concludi', exact: true }).click();
    await expect(a.getByText('Partita conclusa. Risultato salvato.')).toBeVisible();
    const runs = await (await contexts[0]!.request.get('http://localhost:3000/api/runs')).json();
    expect(runs.find((r: { game_id: string }) => r.game_id === 'frontier')?.verified).toBe(true);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
