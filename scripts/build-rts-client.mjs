import { build } from 'esbuild';
await build({
  entryPoints: ['packages/client/src/worker.ts'],
  outfile: 'public/generated/rts-worker.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
});

await build({entryPoints:['packages/client/src/fps/worker.ts'],outfile:'public/generated/fps-worker.js',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true});
