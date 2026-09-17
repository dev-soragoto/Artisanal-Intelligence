import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';

export function buildApp(options: { staticRoot?: string; logger?: boolean } = {}) {
  const app = Fastify({ logger: options.logger ?? false });
  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'artisanal-intelligence',
    stage: 'scaffold',
  }));
  if (options.staticRoot) {
    app.register(fastifyStatic, { root: options.staticRoot });
  }
  return app;
}
