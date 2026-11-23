import { build } from 'esbuild';
await build({ entryPoints: ['cloud/service.ts'], bundle: true, platform: 'node', target: 'node18', format: 'cjs', outfile: 'cloudfunctions/diary-sync/service.cjs' });
