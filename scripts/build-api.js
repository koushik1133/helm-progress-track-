import esbuild from 'esbuild';

console.log('[Build] Bundling api/index.ts into api/index.js for Vercel...');

esbuild.buildSync({
  entryPoints: ['api/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  outfile: 'api/index.js'
});

console.log('[Build] api/index.js generated successfully.');
