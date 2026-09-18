import { spawn } from 'node:child_process';
import { hostname, networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const port = process.env.PORT ?? '3000';
const host = process.env.HOST ?? '0.0.0.0';
const webHost = process.env.ARTISANAL_WEB_HOST ?? host;
const webPort = '5173';
const apiKey = process.env.ARTISANAL_API_KEY ?? 'sk-artisanal-intelligence';
const operatorPassword = process.env.ARTISANAL_OPERATOR_PASSWORD ?? 'artisanal-operator';
const lanOrigins = Object.values(networkInterfaces())
  .flat()
  .filter((address) => address?.family === 'IPv4' && !address.internal)
  .map((address) => `http://${address.address}:${webPort}`);
const operatorOrigins = [
  process.env.ARTISANAL_OPERATOR_ORIGINS,
  `http://127.0.0.1:${webPort}`,
  `http://localhost:${webPort}`,
  `http://${hostname()}:${webPort}`,
  ...lanOrigins,
]
  .filter(Boolean)
  .join(',');
const jobs = [
  {
    name: 'server',
    script: join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    args: ['watch', 'src/server/index.ts'],
    env: {
      ...process.env,
      HOST: host,
      ARTISANAL_API_KEY: apiKey,
      ARTISANAL_OPERATOR_PASSWORD: operatorPassword,
      ARTISANAL_SERVE_WEB: '0',
      ARTISANAL_OPERATOR_ORIGINS: operatorOrigins,
    },
  },
  {
    name: 'web',
    script: join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
    args: ['--host', webHost],
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
