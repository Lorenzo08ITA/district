import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
const map = process.argv[2] ?? 'depot',
  output = process.argv[3] ?? 'docs/benchmarks/fps-visual.json';
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
      baseURL: 'http://localhost:3000',
      viewport: { width: 1440, height: 960 },
    }),
    page = await context.newPage();
  await context.request.post('http://localhost:3000/api/auth/register', {
    headers: { Origin: 'http://localhost:3000' },
    data: {
      name: 'Render benchmark',
      email: `render-${Date.now()}@example.com`,
      password: 'secure-test-password',
    },
  });
  await page.addInitScript(() => {
    const samples = new Float64Array(1800);
    let count = 0,
      last = 0,
      active = false,
      calls = 0,
      total = 0,
      frames = 0;
    for (const name of [
      'drawElements',
      'drawArrays',
      'drawElementsInstanced',
      'drawArraysInstanced',
    ]) {
      const native = WebGL2RenderingContext.prototype[name];
      WebGL2RenderingContext.prototype[name] = function (...args) {
        calls++;
        return Reflect.apply(native, this, args);
      };
    }
    function collect(now) {
      if (active && last) {
        samples[count++ % 1800] = now - last;
        total += calls;
        frames++;
      }
      calls = 0;
      last = now;
      requestAnimationFrame(collect);
    }
    requestAnimationFrame(collect);
    window.startSample = () => {
      count = 0;
      frames = 0;
      total = 0;
      last = 0;
      active = true;
    };
    window.readSample = () => {
      active = false;
      return {
        frames: Math.min(count, 1800),
        dt: Array.from(samples.subarray(0, Math.min(count, 1800))),
        drawCalls: total / Math.max(1, frames),
      };
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Gioca a Crossfire', exact: true }).click();
  await page.getByRole('button', { name: 'Inizia', exact: false }).click();
  await page.getByLabel('Mappa FPS').selectOption(map);
  await page.getByLabel('Bot iniziali').selectOption('5');
  await page.getByRole('button', { name: 'Crea lobby', exact: true }).click();
  await page.getByRole('button', { name: 'Avvia partita' }).click();
  await page.getByRole('button', { name: 'Entra nell’arena' }).click();
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.startSample());
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2000);
  await page.keyboard.up('KeyW');
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(1000);
  await page.keyboard.up('KeyD');
  await page.waitForTimeout(3000);
  const sample = await page.evaluate(() => window.readSample());
  sample.dt.sort((a, b) => a - b);
  const result = {
    map,
    driver: 'Chromium headless / software WebGL',
    viewport: [1440, 960],
    bots: 5,
    movement: 'W for 2s, D for 1s, idle for 3s',
    buffer: await page.locator('.fps-canvas canvas').evaluate((canvas) => {
      const rect = canvas.getBoundingClientRect();
      return {
        width: canvas.width,
        height: canvas.height,
        cssWidth: rect.width,
        cssHeight: rect.height,
      };
    }),
    frames: sample.frames,
    p50Ms: sample.dt[Math.floor(sample.frames * 0.5)],
    p95Ms: sample.dt[Math.floor(sample.frames * 0.95)],
    meanDrawCalls: Math.round(sample.drawCalls),
    note: 'Synthetic local capture; not a hardware GPU or internet-latency guarantee.',
  };
  mkdirSync('docs/benchmarks', { recursive: true });
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Concludi e salva' }).click();
  await context.close();
} finally {
  await browser.close();
}
