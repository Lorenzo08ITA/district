import { test, expect } from '@playwright/test';
test('PWA: home e gioco già visitato funzionano dopo ricaricamento senza rete', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((r) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => r(), { once: true }),
      );
  });
  await page.getByRole('button', { name: 'Gioca a Pulse Run', exact: true }).click();
  await page.getByRole('button', { name: 'Inizia', exact: false }).click();
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Catalogo', exact: false }).first().click();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Entra in gioco.' })).toBeVisible();
  await page.getByRole('button', { name: 'Gioca a Pulse Run', exact: true }).click();
  await page.getByRole('button', { name: 'Riprendi' }).click();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByRole('heading', { name: '0 punti' })).toBeVisible({ timeout: 12000 });
  await context.setOffline(false);
});

test('PWA: Frontier riprende con Worker e mappa senza rete', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
          once: true,
        }),
      );
  });
  await page.getByRole('button', { name: 'Gioca a Frontier', exact: true }).click();
  await page.getByRole('button', { name: 'Inizia', exact: false }).click();
  await page.getByRole('button', { name: 'Nuova partita', exact: true }).click();
  await expect(page.locator('.rts-hud')).toBeVisible();
  await expect
    .poll(async () => Number(await page.locator('.rts-game').getAttribute('data-tick')))
    .toBeGreaterThan(20);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: 'Gioca a Frontier', exact: true }).click();
  await page.getByRole('button', { name: 'Inizia', exact: false }).click();
  await page.getByRole('button', { name: 'Riprendi mondo', exact: false }).click();
  await expect(page.locator('.rts-hud')).toBeVisible();
  await expect
    .poll(async () => Number(await page.locator('.rts-game').getAttribute('data-tick')))
    .toBeGreaterThan(25);
  await context.setOffline(false);
});
