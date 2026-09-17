import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const port = process.env.PORT ?? '3000';
const jobs = [
  {
    name: 'server',
    script: join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    args: ['watch', 'src/server/index.ts'],
    env: { ...process.env, ARTISANAL_SERVE_WEB: '0' },
  },
  {
    name: 'web',
    script: join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
    args: ['--host', '127.0.0.1'],
    env: {
      ...process.env,
      ARTISANAL_API_TARGET: process.env.ARTISANAL_API_TARGET ?? `http://127.0.0.1:${port}`,
    },
  },
];

let stopping = false;
const children = jobs.map((job) => {
  const child = spawn(process.execPath, [job.script, ...job.args], {
    cwd: root,
    env: job.env,
    stdio: 'inherit',
  });
  child.once('exit', (code, signal) => {
    if (stopping) return;
    stopping = true;
    for (const other of children) {
      if (other !== child && other.exitCode === null) other.kill('SIGTERM');
    }
    process.exitCode = code ?? (signal ? 1 : 0);
  });
  return child;
});

function stop(signal) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill(signal);
  }
}

process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
