import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildApp } from './app.js';
import { readServiceConfig } from './config.js';

function readPort() {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return port;
}

async function main() {
  const port = readPort();
  const host = process.env.HOST ?? '127.0.0.1';
  const config = readServiceConfig(process.env, host);
  const serveWeb = process.env.ARTISANAL_SERVE_WEB !== '0';
  const staticRoot = resolve(process.env.ARTISANAL_WEB_ROOT ?? 'dist/web');

  if (serveWeb && !existsSync(staticRoot)) {
    throw new Error(`Web assets not found at ${staticRoot}. Run npm run build first.`);
  }

  const app = buildApp({
    config,
    logger: true,
    staticRoot: serveWeb ? staticRoot : undefined,
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void app.close().catch((error: unknown) => {
        app.log.error(error);
        process.exitCode = 1;
      });
    });
  }

  await app.listen({ host, port });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
