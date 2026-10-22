import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { runReplay } from '../rts/replay';

test('RTS: stesso replay in Node e Web Worker Chromium', async ({ page }) => {
  const bundle = await build({
    stdin: {
      contents: `import {runReplay} from './tests/rts/replay.ts'; self.onmessage=()=>{try{self.postMessage({ok:true,result:runReplay()});}catch(error){self.postMessage({ok:false,message:String(error)});}};`,
      resolveDir: process.cwd(),
      sourcefile: 'rts-worker-test.ts',
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
  });
  const source = bundle.outputFiles[0]!.text;
  await page.goto('/');
  const actual = await page.evaluate(
    (source) =>
      new Promise((resolve, reject) => {
        const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        const worker = new Worker(url);
        const timer = setTimeout(() => {
          worker.terminate();
          URL.revokeObjectURL(url);
          reject(new Error('Worker timeout'));
        }, 10000);
        worker.onmessage = (event) => {
          clearTimeout(timer);
          worker.terminate();
          URL.revokeObjectURL(url);
          if (event.data.ok) resolve(event.data.result);
          else reject(new Error(event.data.message));
        };
        worker.onerror = (event) => {
          clearTimeout(timer);
          worker.terminate();
          URL.revokeObjectURL(url);
          reject(new Error(event.message));
        };
        worker.postMessage('run');
      }),
    source,
  );
  expect(actual).toEqual(runReplay());
});

test('RTS Step 2: mondo completo identico fra Node e Web Worker', async ({ page }) => {
  const bundle = await build({
    stdin: {
      contents: `import {runWorldReplay} from './tests/rts/world-replay.ts';self.onmessage=()=>{try{self.postMessage({ok:true,result:runWorldReplay()});}catch(error){self.postMessage({ok:false,message:String(error)});}};`,
      resolveDir: process.cwd(),
      sourcefile: 'rts-world-worker.ts',
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
  });
  const { runWorldReplay } = await import('../rts/world-replay');
  await page.goto('/');
  const actual = await page.evaluate(
    (source) =>
      new Promise((resolve, reject) => {
        const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' })),
          worker = new Worker(url);
        const timer = setTimeout(() => {
          worker.terminate();
          URL.revokeObjectURL(url);
          reject(new Error('World Worker timeout'));
        }, 15000);
        worker.onmessage = (event) => {
          clearTimeout(timer);
          worker.terminate();
          URL.revokeObjectURL(url);
          if (event.data.ok) resolve(event.data.result);
          else reject(new Error(event.data.message));
        };
        worker.onerror = (e) => {
          clearTimeout(timer);
          worker.terminate();
          URL.revokeObjectURL(url);
          reject(new Error(e.message));
        };
        worker.postMessage('run');
      }),
    bundle.outputFiles[0]!.text,
  );
  expect(actual).toEqual(runWorldReplay());
});
