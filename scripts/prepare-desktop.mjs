import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const resources = join(root, 'src-tauri/resources');
await mkdir(resources, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ['src/server/desktop.ts'],
  outfile: join(resources, 'server.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
});
await copyFile(
  process.execPath,
  join(resources, process.platform === 'win32' ? 'node.exe' : 'node'),
);
await copyFile(join(dirname(process.execPath), 'LICENSE'), join(resources, 'NODE-LICENSE.txt'));
console.log(
  `Desktop backend prepared with Node ${process.version} (${process.platform}/${process.arch})`,
);
