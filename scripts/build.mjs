import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as buildServer } from 'esbuild';
import { build as buildWeb } from 'vite';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');

await rm(dist, { recursive: true, force: true });

await buildServer({
  absWorkingDir: root,
  entryPoints: ['src/server/index.ts'],
  outfile: join(dist, 'server.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  sourcemap: true,
});

await buildWeb({
  root,
  configFile: join(root, 'vite.config.ts'),
});

console.log('Built dist/server.cjs and dist/web/');
