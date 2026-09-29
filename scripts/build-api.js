import esbuild from 'esbuild';
import fs from 'node:fs';

console.log('[Build] Bundling api/index.ts for Vercel...');

esbuild.buildSync({
  entryPoints: ['api/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  outfile: 'api/index.js'
});

fs.copyFileSync('api/index.js', 'api/[...path].js');

console.log('[Build] api/index.js and api/[...path].js generated successfully.');
