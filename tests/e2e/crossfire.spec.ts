import { test, expect, type Worker } from '@playwright/test';
test('Crossfire: due schede debug, lobby, armi, movimento e risultati persistiti', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const errors: string[] = [];
  try {
    const registered = await context.request.post('http://localhost:3000/api/auth/register', {
      headers: { Origin: 'http://localhost:3000' },
      data: {
        name: 'Debug FPS',
        email: `fps-debug-${Date.now()}@example.com`,
        password: 'secure-test-password',
      },
    });
    expect(registered.ok()).toBe(true);
    await context.addInitScript(() => {
      const NativeWorker = window.Worker;
      (window as any).fpsFrames = [];
      (window as any).fpsShots = 0;
      (window as any).fpsWelcomes = 0;
      window.Worker = class extends NativeWorker {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          if (String(url).includes('fps-worker'))
            this.addEventListener('message', (event) => {
              if (event.data.type === 'welcome') (window as any).fpsWelcomes++;
              if (event.data.type === 'frame') {
                const list = (window as any).fpsFrames;
                list.push(Array.from(event.data.values));
                if (list.length > 120) list.shift();
              }
              if (event.data.type === 'localShot') (window as any).fpsShots++;
            });
        }
      };
    });
    const a = await context.newPage(),
      b = await context.newPage();
    for (const page of [a, b]) {
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('/');
      await page.getByRole('button', { name: 'Gioca a Crossfire', exact: true }).click();
      await page.getByRole('button', { name: 'Inizia', exact: false }).click();
      await page.getByRole('checkbox').check();
    }
    let simulation: Worker | undefined;
    a.on('worker', (worker) => {
      if (worker.url().includes('fps-worker')) simulation = worker;
    });
    await a.getByLabel('Mappa FPS').selectOption('sandstorm');
    await a.getByLabel('Modalità FPS').selectOption('tdm');
    await a.getByLabel('Bot iniziali').selectOption('0');
    await a.getByRole('button', { name: 'Crea lobby', exact: true }).click();
    await expect(a.getByTestId('fps-code')).toBeVisible();
    const code = await a.getByTestId('fps-code').innerText();
    await b.getByLabel('Codice lobby FPS').fill(code);
    await b.getByRole('button', { name: 'Entra con codice' }).click();
    await expect(b.getByText('In attesa del creatore.')).toBeVisible();
    await a.getByRole('button', { name: 'Avvia partita' }).click();
    for (const page of [a, b]) {
      await expect(page.locator('.leaderboard')).toContainText('Debug FPS');
      await expect(page.locator('.leaderboard>div')).toHaveCount(2);
      await expect(page.locator('.fps-hud')).toContainText('HP');
    }
    await a.bringToFront();
    await a.getByRole('button', { name: 'Entra nell’arena' }).click();
    await expect.poll(() => a.evaluate(() => !!document.pointerLockElement)).toBe(true);
    await a.keyboard.press('Digit2');
    await expect(a.locator('.fps-hud')).toContainText('Kraber');
    expect(simulation).toBeDefined();
    await simulation!.evaluate(() => {
      const until = performance.now() + 350;
      while (performance.now() < until) {
        /* Simulate a suspended simulation worker. */
      }
    });
    await expect.poll(() => a.evaluate(() => (window as any).fpsWelcomes)).toBeGreaterThan(1);
    await expect(a.locator('.fps-hud')).toContainText('Kraber');
    await expect(a.locator('.fps-error')).toHaveCount(0);
    await a.keyboard.press('Digit1');
    await expect(a.locator('.fps-hud')).toContainText('Vanguard');
    const before = await a.evaluate(() => {
      const v = (window as any).fpsFrames.at(-1);
      return [v[1], v[3]];
    });
    await a.keyboard.down('KeyW');
    await a.waitForTimeout(700);
    await a.keyboard.up('KeyW');
    await expect
      .poll(() =>
        a.evaluate(([x, z]) => {
          const v = (window as any).fpsFrames.at(-1);
          return Math.hypot(v[1] - x, v[3] - z);
        }, before),
      )
      .toBeGreaterThan(1);
    await a.mouse.down();
    await a.waitForTimeout(300);
    await a.mouse.up();
    await expect.poll(() => a.evaluate(() => (window as any).fpsShots)).toBeGreaterThan(0);
    await expect
      .poll(() => a.evaluate(() => (window as any).fpsFrames.at(-1)[12]))
      .toBeLessThan(30);
    await a.keyboard.press('Escape');
    await a.getByRole('button', { name: 'F3 · Debug' }).click();
    await a.getByRole('button', { name: 'Aggiungi Strafe Bot' }).click();
    await expect(a.locator('.leaderboard')).toContainText('Strafe');
    await a.getByRole('button', { name: 'F3 · Debug' }).click();
    await a.screenshot({ path: 'docs/screenshots/crossfire-debug.png', fullPage: true });
    await a.getByRole('button', { name: 'Concludi e salva' }).click();
    await expect(a.getByText('Partita conclusa. Risultato salvato.')).toBeVisible();
    await b.getByRole('button', { name: 'Concludi e salva' }).click();
    await expect(b.getByText('Partita conclusa. Risultato salvato.')).toBeVisible();
    const progress = await (await context.request.get('http://localhost:3000/api/progress')).json();
    expect(progress.find((p: any) => p.game_id === 'crossfire').plays).toBe(2);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('Crossfire: shader PBR, scope 6x e ricarica nel browser', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /THREE|shader/i.test(message.text()))
      errors.push(message.text());
  });
  // Exercise the full material pipeline even when CI uses a software WebGL driver.
  await page.addInitScript(() => {
    const original = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function (parameter: number) {
      if (parameter === 37446) return 'Hardware material verification';
      return original.call(this, parameter);
    };
  });
  await page.request.post('/api/auth/register', {
    headers: { Origin: 'http://localhost:3000' },
    data: {
      name: 'Scope QA',
      email: `fps-scope-${Date.now()}@example.com`,
      password: 'secure-test-password',
    },
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Gioca a Crossfire', exact: true }).click();
  await page.getByRole('button', { name: 'Inizia', exact: false }).click();
  await page.getByLabel('Bot iniziali').selectOption('0');
  await page.getByRole('button', { name: 'Crea lobby', exact: true }).click();
  await page.getByRole('button', { name: 'Avvia partita' }).click();
  await page.getByRole('button', { name: 'Entra nell’arena' }).click();
  await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(true);
  await page.keyboard.press('Digit2');
  await expect(page.locator('.fps-hud')).toContainText('Kraber');
  await page.mouse.down({ button: 'right' });
  await page.mouse.down({ button: 'left' });
  await page.mouse.up({ button: 'left' });
  await expect(page.locator('.fps-hud')).toContainText('4');
  await page.screenshot({ path: 'docs/screenshots/crossfire-scope.png' });
  await page.keyboard.press('KeyR');
  await expect(page.locator('.fps-hud')).toContainText('Ricarica');
  await page.mouse.up({ button: 'right' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Concludi e salva' }).click();
  await expect(page.getByText('Partita conclusa. Risultato salvato.')).toBeVisible();
  expect(errors).toEqual([]);
});
