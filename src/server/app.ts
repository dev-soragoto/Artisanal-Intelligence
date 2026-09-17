import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { defaultServiceConfig, type ServiceConfig } from './config.js';
import { RequestManager } from './core/request-manager.js';
import { registerOpenAIRoutes } from './openai/routes.js';
import { registerOperatorRoutes } from './operator/routes.js';

export interface AppOptions {
  staticRoot?: string;
  logger?: boolean;
  config?: Partial<ServiceConfig>;
}

export function buildApp(options: AppOptions = {}) {
  const config: ServiceConfig = { ...defaultServiceConfig, ...options.config };
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 1_048_576 });
  const requests = new RequestManager({ requestTimeoutMs: config.requestTimeoutMs });

  app.register(fastifyCookie);
  app.register(fastifyCors, {
    origin: config.operatorOrigins.length ? config.operatorOrigins : false,
    credentials: true,
  });
  app.register(fastifyWebsocket, { options: { maxPayload: 1_048_576 } });

  app.addHook('onClose', async () => requests.shutdown());
  // The websocket plugin installs an onRoute hook during Fastify boot. Register routes only
  // after that plugin is ready or a websocket handler would be treated as a normal HTTP handler.
  app.after(() => {
    app.get('/api/health', async () => ({
      status: 'ok',
      service: 'artisanal-intelligence',
      stage: 'web-first-human-inference',
    }));

    registerOpenAIRoutes(app, requests, config);
    registerOperatorRoutes(app, requests, config);

    if (options.staticRoot) {
      app.register(fastifyStatic, { root: options.staticRoot });
    }
  });
  return app;
}
