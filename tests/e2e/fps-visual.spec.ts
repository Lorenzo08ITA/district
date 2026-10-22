import { test, expect } from '@playwright/test';
for (const map of ['bastion', 'cedar'])
  test(`Crossfire ${map}: nuova mappa, materiali, camera e qualità adattiva`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && /THREE|shader|GL_INVALID/i.test(m.text())) errors.push(m.text());
    });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.request.post('/api/auth/register', {
      headers: { Origin: 'http://localhost:3000' },
      data: {
        name: 'Visual QA',
        email: `visual-${map}-${Date.now()}@example.com`,
        password: 'secure-test-password',
      },
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Gioca a Crossfire', exact: true }).click();
    await page.getByRole('button', { name: 'Inizia', exact: false }).click();
    await expect(page.getByLabel('Mappa FPS').locator('option')).toHaveCount(4);
    await page.getByLabel('Mappa FPS').selectOption(map);
    await page.getByLabel('Bot iniziali').selectOption('1');
    await page.getByRole('button', { name: 'Crea lobby', exact: true }).click();
    await page.getByRole('button', { name: 'Avvia partita' }).click();
    await page.getByRole('button', { name: 'Entra nell’arena' }).click();
    await expect
      .poll(async () => Number(await page.locator('.fps-game').getAttribute('data-draw-calls')))
      .toBeGreaterThan(0);
    await expect
      .poll(async () => Number(await page.locator('.fps-game').getAttribute('data-draw-calls')))
      .toBeLessThan(150);
    await page.keyboard.press('Escape');
    await page.getByLabel('Qualità grafica FPS').selectOption('performance');
    await expect(page.locator('.fps-game')).toHaveAttribute('data-render-scale', '0.65');
    await page.getByLabel('Qualità grafica FPS').selectOption('auto');
    await page.getByRole('button', { name: 'Entra nell’arena' }).click();
    await page.keyboard.press('Digit1');
    await page.screenshot({ path: `docs/screenshots/crossfire-${map}.png`, fullPage: true });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Concludi e salva' }).click();
    await expect(page.getByText('Partita conclusa. Risultato salvato.')).toBeVisible();
    expect(errors).toEqual([]);
  });
