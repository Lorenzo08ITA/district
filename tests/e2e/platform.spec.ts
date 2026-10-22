import { test, expect } from '@playwright/test';
test('catalogo, preferiti e personalizzazione persistono', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Entra in gioco.' })).toBeVisible();
  await expect(page.locator('.game-card')).toHaveCount(12);
  await page.getByRole('button', { name: 'Preferito: Flux Grid', exact: true }).click();
  await page.getByRole('button', { name: 'La tua selezione' }).click();
  await expect(page.locator('.game-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Personalizza' }).click();
  await page.getByLabel('Tema', { exact: true }).selectOption('light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
test('account, risultato idempotente e isolamento', async ({ request }) => {
  const headers = { Origin: 'http://localhost:3000' };
  const email = `test-${Date.now()}@example.com`;
  const register = await request.post('/api/auth/register', {
    headers,
    data: { name: 'Playwright', email, password: 'secure-test-password' },
  });
  expect(register.status()).toBe(200);
  expect(register.headers()['set-cookie']).toContain('HttpOnly');
  const r = {
    id: crypto.randomUUID(),
    game: 'pulse',
    mode: 'offline',
    score: 80,
    durationMs: 20000,
    won: false,
    stats: { jumps: 8 },
  };
  expect((await request.post('/api/results', { headers, data: r })).status()).toBe(200);
  expect((await (await request.post('/api/results', { headers, data: r })).json()).duplicate).toBe(
    true,
  );
  expect((await (await request.get('/api/progress')).json())[0].plays).toBe(1);
  expect(
    (
      await request.post('/api/results', {
        headers,
        data: { ...r, id: crypto.randomUUID(), mode: 'online', game: 'crossfire' },
      })
    ).status(),
  ).toBe(403);
  await request.post('/api/auth/logout', { headers });
  expect((await request.get('/api/progress')).status()).toBe(401);
});
test('Wordle e quiz caricano solo modulo richiesto', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Gioca a Parola', exact: true }).click();
  await page.getByRole('button', { name: 'Inizia', exact: false }).click();
  await expect(page.locator('.letter')).toHaveCount(30);
  await page.keyboard.type('cassa');
  await page.keyboard.press('Enter');
  await expect(page.locator('.word-row').first().locator('.letter').first()).toContainText('c');
  await page.getByRole('button', { name: 'Catalogo', exact: false }).first().click();
  await page.getByRole('button', { name: 'Gioca a Dieci domande', exact: true }).click();
  await page.getByRole('button', { name: 'Inizia', exact: false }).click();
  await expect(page.locator('.answers button')).toHaveCount(4);
  await page.locator('.answers button').first().click();
  await expect(page.getByRole('button', { name: 'Prossima domanda' })).toBeVisible();
});
test('checkpoint Wordle riprende dopo ricaricamento', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Gioca a Parola', exact: true }).click();
  await page.getByRole('button', { name: 'Inizia', exact: false }).click();
  await expect(page.locator('.letter')).toHaveCount(30);
  await page.keyboard.type('gatt');
  await expect(page.locator('.word-row').first()).toContainText('gatt');
  await page.reload();
  await page.getByRole('button', { name: 'Gioca a Parola', exact: true }).click();
  await page.getByRole('button', { name: 'Riprendi' }).click();
  await expect(page.locator('.word-row').first()).toContainText('gatt');
});
test('runner conclude e registra risultato ospite', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Gioca a Pulse Run', exact: true }).click();
  await page.getByRole('button', { name: 'Inizia', exact: false }).click();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByRole('heading', { name: '0 punti' })).toBeVisible({ timeout: 12000 });
  await page.getByRole('button', { name: 'Torna al catalogo' }).click();
  await page.getByRole('button', { name: 'I tuoi progressi' }).click();
  await expect(page.locator('.progress-list')).toContainText('Pulse Run');
});
test('Three.js si carica soltanto entrando nel gioco 3D', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('canvas')).toHaveCount(0);
  await page.getByRole('button', { name: 'Gioca a Night Circuit', exact: true }).click();
  await page.getByRole('button', { name: 'Inizia', exact: false }).click();
  await expect(page.locator('canvas')).toBeVisible();
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(700);
  await page.keyboard.up('KeyW');
  await expect(page.locator('.hud')).toContainText('km/h');
  expect(errors).toEqual([]);
});
test('checkpoint account isolato e protetto da CSRF', async ({ request }) => {
  const headers = { Origin: 'http://localhost:3000' };
  await request.post('/api/auth/register', {
    headers,
    data: {
      name: 'Checkpoint',
      email: `save-${Date.now()}@example.com`,
      password: 'secure-test-password',
    },
  });
  const data = { updatedAt: Date.now(), data: { target: 'cassa', guesses: [], input: 'ca' } };
  expect((await request.put('/api/checkpoints/parola', { headers, data })).status()).toBe(200);
  expect((await (await request.get('/api/checkpoints/parola')).json()).data.input).toBe('ca');
  expect(
    (
      await request.put('/api/checkpoints/parola', {
        headers: { Origin: 'https://evil.example' },
        data,
      })
    ).status(),
  ).toBe(403);
  await request.post('/api/auth/logout', { headers });
  expect((await request.get('/api/checkpoints/parola')).status()).toBe(401);
});
test('layout mobile senza scorrimento orizzontale e account accessibile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.game-card')).toHaveCount(12);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Accedi', exact: false }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({ path: 'docs/screenshots/mobile.png', fullPage: true });
});
test('tutti i moduli offline si avviano senza errori', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.district')).toHaveAttribute('data-ready', 'true');
  await page.screenshot({ path: 'docs/screenshots/home.png', fullPage: true, caret: 'initial' });
  for (const title of [
    'Neon Wing',
    'Frontier',
    'Flux Grid',
    'Prism Fall',
    'Altrove',
    'Flag Club',
  ]) {
    await page.getByRole('button', { name: `Gioca a ${title}`, exact: true }).click();
    await page.getByRole('button', { name: 'Inizia', exact: false }).click();
    if (['Altrove', 'Flag Club'].includes(title))
      await expect(page.locator('.answers button')).toHaveCount(4);
    else if (title === 'Frontier') {
      await page.getByRole('button', { name: 'Nuova partita', exact: true }).click();
      await expect(page.getByLabel('Mappa Frontier')).toBeVisible();
    } else await expect(page.locator('canvas')).toBeVisible();
    await page.getByRole('button', { name: 'Catalogo', exact: false }).first().click();
  }
  expect(errors).toEqual([]);
});
test('due browser entrano nell’arena FPS con utenti distinti', async ({ browser }) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  try {
    const pages = [];
    for (const [index, context] of [a, b].entries()) {
      await context.request.post('http://localhost:3000/api/auth/register', {
        headers: { Origin: 'http://localhost:3000' },
        data: {
          name: `Arena ${index}`,
          email: `arena-${Date.now()}-${index}@example.com`,
          password: 'secure-test-password',
        },
      });
      const page = await context.newPage();
      pages.push(page);
      await page.goto('/');
      await page.getByRole('button', { name: 'Gioca a Crossfire', exact: true }).click();
      await page.getByRole('button', { name: 'Inizia', exact: false }).click();
      await page.getByRole('button', { name: 'Partita rapida', exact: true }).click();
      await expect(page.locator('canvas')).toBeVisible();
    }
    for (const page of pages) {
      await expect(page.locator('.leaderboard')).toContainText('Arena 0');
      await expect(page.locator('.leaderboard')).toContainText('Arena 1');
      await expect(page.locator('.hud')).toContainText('HP');
    }
    await pages[0].screenshot({ path: 'docs/screenshots/crossfire.png' });
  } finally {
    await a.close();
    await b.close();
  }
});
