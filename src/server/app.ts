import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { RequestManager } from './core/request-manager.js';
import { registerOpenAIRoutes } from './openai/routes.js';
import { registerOperatorRoutes } from './operator/routes.js';

export function buildApp(options: { staticRoot?: string; logger?: boolean } = {}) {
  const app = Fastify({ logger: options.logger ?? false });
  const requests = new RequestManager();

  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'artisanal-intelligence',
    stage: 'web-first-human-inference',
  }));

  registerOpenAIRoutes(app, requests);
  registerOperatorRoutes(app, requests);

  if (options.staticRoot) {
    app.register(fastifyStatic, { root: options.staticRoot });
  }
  return app;
}
