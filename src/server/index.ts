import { buildApp } from './app.js';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}
const app = buildApp({
  logger: true,
  staticRoot: fileURLToPath(new URL('../../dist/web/', import.meta.url)),
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.close().catch((error: unknown) => {
      app.log.error(error);
      process.exitCode = 1;
    });
  });
}
try {
  await app.listen({ host: '127.0.0.1', port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
