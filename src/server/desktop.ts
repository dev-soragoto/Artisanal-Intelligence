import { buildApp } from './app.js';

// The desktop host owns stdin. EOF also cleans up after an unexpected host exit.
const app = buildApp();
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await app.close();
  process.exit(0);
}
process.stdin.resume();
process.stdin.on('end', () => void stop());
process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());

async function start() {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('PORT must be an integer between 0 and 65535');
  }
  await app.listen({ host: '127.0.0.1', port });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server address');
  process.stdout.write(`${JSON.stringify({ port: address.port })}\n`);
}

start().catch((error: unknown) => {
  process.stdout.write(`${JSON.stringify({ error: String(error) })}\n`, () => process.exit(1));
});
