import esbuild from 'esbuild';

console.log('[Build] Bundling server/api-handler.ts for Vercel...');

esbuild.buildSync({
  entryPoints: ['server/api-handler.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  outfile: 'api/index.js'
});

console.log('[Build] api/index.js generated successfully.');
