import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { runFpsReplay } from '../fps/replay';
test('FPS Step 1: stesso replay fisico, armi e protocollo in Node e Worker', async ({ page }) => {
  const bundle = await build({
    stdin: {
      contents:
        "import {runFpsReplay} from './tests/fps/replay.ts'; self.onmessage=()=>{try{self.postMessage({ok:true,result:runFpsReplay()});}catch(error){self.postMessage({ok:false,message:String(error)});}};",
      resolveDir: process.cwd(),
      sourcefile: 'fps-worker-test.ts',
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
  });
  await page.goto('/');
  const result = await page.evaluate(async (code) => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' })),
      worker = new Worker(url);
    try {
      return await new Promise<{ ok: boolean; result?: unknown; message?: string }>(
        (resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('FPS Worker timeout')), 10000);
          worker.onmessage = (event) => {
            clearTimeout(timeout);
            resolve(event.data);
          };
          worker.onerror = () => {
            clearTimeout(timeout);
            reject(new Error('FPS Worker failed'));
          };
          worker.postMessage('run');
        },
      );
    } finally {
      worker.terminate();
      URL.revokeObjectURL(url);
    }
  }, bundle.outputFiles[0]!.text);
  expect(result.ok).toBe(true);
  const expected = runFpsReplay(),
    actual = result.result as typeof expected;
  expect(actual.tick).toBe(expected.tick);
  expect(actual.shots).toBe(expected.shots);
  expect(actual.checksum).toBe(expected.checksum);
  expect(actual.grounded).toBe(expected.grounded);
  expect(actual.crouched).toBe(expected.crouched);
  expect(actual.eyeHeight).toBeCloseTo(expected.eyeHeight, 7);
  for (let i = 0; i < 3; i++) {
    expect(actual.position[i]).toBeCloseTo(expected.position[i]!, 6);
    expect(actual.velocity[i]).toBeCloseTo(expected.velocity[i]!, 6);
  }
});
