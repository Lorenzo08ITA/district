import { test, expect } from '@playwright/test';
for (const map of ['depot', 'bastion', 'cedar'])
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
    await expect(page.getByLabel('Mappa FPS').locator('option')).toHaveCount(5);
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
    await expect(page.locator('.fps-game')).toHaveAttribute('data-render-scale', '1.00');
    const buffer = await page.locator('.fps-canvas canvas').evaluate((canvas) => {
      const element = canvas as HTMLCanvasElement,
        rect = element.getBoundingClientRect();
      return {
        width: element.width,
        height: element.height,
        cssWidth: rect.width,
        cssHeight: rect.height,
      };
    });
    expect(buffer.width).toBeGreaterThanOrEqual(Math.floor(buffer.cssWidth));
    expect(buffer.height).toBeGreaterThanOrEqual(Math.floor(buffer.cssHeight));
    await page.getByLabel('Qualità grafica FPS').selectOption('auto');
    if (map === 'depot') {
      await page.getByRole('button', { name: 'Schermo intero', exact: true }).click();
      await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    }
    await page.getByRole('button', { name: 'Entra nell’arena' }).click();
    await page.keyboard.press('Digit1');
    await page.screenshot({ path: `docs/screenshots/crossfire-${map}.png`, fullPage: true });
    await page.keyboard.press('Escape');
    await page.evaluate(async () => {
      if (document.fullscreenElement) await document.exitFullscreen();
    });
    await page.getByRole('button', { name: 'Concludi e salva' }).click();
    await expect(page.getByText('Partita conclusa. Risultato salvato.')).toBeVisible();
    expect(errors).toEqual([]);
  });
