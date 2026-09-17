import type { FastifyInstance } from 'fastify';
import { RequestManager } from '../core/request-manager.js';

type OutputChannel = 'thinking' | 'final';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseText(body: unknown) {
  return isRecord(body) && typeof body.text === 'string' ? body.text : undefined;
}

function parseDelta(body: unknown): { text: string; channel: OutputChannel } | undefined {
  if (!isRecord(body) || typeof body.text !== 'string') return undefined;
  const channel = body.channel ?? 'final';
  if (channel !== 'thinking' && channel !== 'final') return undefined;
  return { text: body.text, channel };
}

export function registerOperatorRoutes(app: FastifyInstance, requests: RequestManager) {
  app.get('/operator/request', async () => ({
    request: requests.current()?.snapshot() ?? null,
  }));

  app.post('/operator/requests/:id/delta', async (request, reply) => {
    const params = request.params as { id?: unknown };
    const delta = parseDelta(request.body);
    if (typeof params.id !== 'string' || !delta) {
      return reply.status(400).send({ error: 'Invalid operator delta' });
    }
    try {
      const session =
        delta.channel === 'thinking'
          ? requests.appendReasoning(params.id, delta.text)
          : requests.appendText(params.id, delta.text);
      return { ok: true, request: session.snapshot() };
    } catch (error) {
      return reply.status(404).send({ error: String(error) });
    }
  });

  app.post('/operator/requests/:id/finish', async (request, reply) => {
    const params = request.params as { id?: unknown };
    if (typeof params.id !== 'string') {
      return reply.status(400).send({ error: 'Invalid operator request id' });
    }
    try {
      const session = requests.finish(params.id);
      return { ok: true, request: session.snapshot() };
    } catch (error) {
      return reply.status(404).send({ error: String(error) });
    }
  });

  app.post('/operator/requests/:id/final', async (request, reply) => {
    const params = request.params as { id?: unknown };
    const text = parseText(request.body);
    if (typeof params.id !== 'string' || text === undefined) {
      return reply.status(400).send({ error: 'Invalid operator response' });
    }
    try {
      const session = requests.submitFinal(params.id, text);
      return { ok: true, request: session.snapshot() };
    } catch (error) {
      return reply.status(404).send({ error: String(error) });
    }
  });
}
