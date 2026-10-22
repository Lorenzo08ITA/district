import { test, expect } from '@playwright/test';
import { decodeWire, encodeWire, WireKind } from '@district/rts-shared';
import { GameEngine, createScenario } from '@district/rts-engine';
test('Frontier: Canvas2D fallback e HUD mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...args: unknown[]
    ) {
      if (type === 'webgl2') return null;
      return Reflect.apply(get, this, [type, ...args]);
    } as typeof get;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Gioca a Frontier', exact: true }).click();
  await page.getByRole('button', { name: 'Inizia', exact: false }).click();
  await page.getByRole('button', { name: 'Nuova partita', exact: true }).click();
  await expect(page.locator('.rts-hud')).toBeVisible();
  await expect
    .poll(async () => Number(await page.locator('.rts-game').getAttribute('data-tick')))
    .toBeGreaterThan(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Pausa', exact: true }).click();
  await page.screenshot({ path: 'docs/screenshots/frontier-mobile.png', fullPage: true });
});
test('Frontier: checkpoint cloud isolato, validato e concluso', async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    const identities: string[] = [];
    for (let i = 0; i < 2; i++) {
      const response = await contexts[i]!.request.post('http://localhost:3000/api/auth/register', {
        headers: { Origin: 'http://localhost:3000' },
        data: {
          name: 'Cloud ' + i,
          email: 'rts-cloud-' + Date.now() + '-' + i + '@example.com',
          password: 'secure-test-password',
        },
      });
      expect(response.status()).toBe(200);
      identities.push((await response.json()).id);
    }
    const headers = {
      Origin: 'http://localhost:3000',
      'Content-Type': 'application/octet-stream',
      'X-Player-Id': identities[0]!,
    };
    const engine = createScenario(3, ['Tu', 'A', 'B', 'C'], [2, 3, 4], 'continents');
    engine.tick();
    const state = {
        snapshot: engine.snapshot(),
        layout: 'continents',
        updatedAt: Date.now() - 1000,
      },
      data = Buffer.from(encodeWire(WireKind.Snapshot, state));
    const a = contexts[0]!.request,
      b = contexts[1]!.request;
    expect(
      (await a.put('http://localhost:3000/api/rts/checkpoint', { headers, data })).status(),
    ).toBe(200);
    expect((await b.get('http://localhost:3000/api/rts/checkpoint')).status()).toBe(204);
    const restored = decodeWire(
      await (await a.get('http://localhost:3000/api/rts/checkpoint')).body(),
    ).value as typeof state;
    expect(GameEngine.fromSnapshot(restored.snapshot).stateHash()).toBe(engine.stateHash());
    expect(
      (await b.put('http://localhost:3000/api/rts/checkpoint', { headers, data })).status(),
    ).toBe(403);
    expect(
      (
        await a.put('http://localhost:3000/api/rts/checkpoint', {
          headers: { ...headers, Origin: 'http://evil.test' },
          data,
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await a.put('http://localhost:3000/api/rts/checkpoint', {
          headers,
          data: Buffer.from('invalid'),
        })
      ).status(),
    ).toBe(400);
    expect((await a.delete('http://localhost:3000/api/rts/checkpoint', { headers })).status()).toBe(
      200,
    );
    expect(
      (await a.put('http://localhost:3000/api/rts/checkpoint', { headers, data })).status(),
    ).toBe(200);
    const ended = decodeWire(await (await a.get('http://localhost:3000/api/rts/checkpoint')).body())
      .value as { completed: boolean };
    expect(ended.completed).toBe(true);
    // A local completion survives an offline finish and invalidates an older cloud save.
    const fresh = { ...state, updatedAt: Date.now() };
    await a.put('http://localhost:3000/api/rts/checkpoint', {
      headers,
      data: Buffer.from(encodeWire(WireKind.Snapshot, fresh)),
    });
    const page = await contexts[0]!.newPage();
    await page.goto('/');
    await page.evaluate(async (identity) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('district-rts-v1', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('saves');
        request.onsuccess = () => {
          const db = request.result,
            transaction = db.transaction('saves', 'readwrite');
          transaction.objectStore('saves').put(Date.now(), identity + ':completed');
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    }, identities[0]!);
    await page.getByRole('button', { name: 'Gioca a Frontier', exact: true }).click();
    await page.getByRole('button', { name: 'Inizia', exact: false }).click();
    await expect(page.getByRole('button', { name: 'Nuova partita', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Riprendi mondo', exact: false })).toHaveCount(0);
    expect(
      (
        decodeWire(await (await a.get('http://localhost:3000/api/rts/checkpoint')).body())
          .value as { completed: boolean }
      ).completed,
    ).toBe(true);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
