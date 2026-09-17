import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import type { ServiceConfig } from '../config.js';
import {
  CommandConflictError,
  type OperatorCommand,
  type RequestManager,
} from '../core/request-manager.js';
import { ToolCallValidationError } from '../core/request-session.js';
import { isAllowedOperatorOrigin, OperatorAuth, requireOperator } from './auth.js';

interface ResumeCommand {
  type: 'resume';
  requestId: string;
  afterSequence: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maximum = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function parseFrame(value: unknown): OperatorCommand | ResumeCommand | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') return undefined;
  if (value.type === 'resume') {
    if (
      !boundedString(value.requestId) ||
      !Number.isSafeInteger(value.afterSequence) ||
      (value.afterSequence as number) < 0
    ) {
      return undefined;
    }
    return {
      type: 'resume',
      requestId: value.requestId,
      afterSequence: value.afterSequence as number,
    };
  }
  if (!boundedString(value.commandId, 128) || !boundedString(value.requestId)) return undefined;
  if (value.type === 'delta') {
    if (
      (value.channel !== 'thinking' && value.channel !== 'final') ||
      !boundedString(value.text, 1_000_000)
    ) {
      return undefined;
    }
    return {
      type: 'delta',
      commandId: value.commandId,
      requestId: value.requestId,
      channel: value.channel,
      text: value.text,
    };
  }
  if (value.type === 'correction') {
    if (
      (value.channel !== 'thinking' && value.channel !== 'final') ||
      !boundedString(value.deleted, 1_000_000)
    ) {
      return undefined;
    }
    return {
      type: 'correction',
      commandId: value.commandId,
      requestId: value.requestId,
      channel: value.channel,
      deleted: value.deleted,
    };
  }
  if (value.type === 'tool_call') {
    if (!boundedString(value.name) || value.arguments === undefined) return undefined;
    return {
      type: 'tool_call',
      commandId: value.commandId,
      requestId: value.requestId,
      name: value.name,
      arguments: value.arguments,
    };
  }
  if (value.type === 'finish') {
    return { type: 'finish', commandId: value.commandId, requestId: value.requestId };
  }
  if (value.type === 'cancel') {
    if (value.reason !== undefined && typeof value.reason !== 'string') return undefined;
    return {
      type: 'cancel',
      commandId: value.commandId,
      requestId: value.requestId,
      ...(value.reason ? { reason: value.reason.slice(0, 1_000) } : {}),
    };
  }
  return undefined;
}

function send(socket: WebSocket, value: unknown) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(value));
}

function commandError(socket: WebSocket, error: unknown, commandId?: string) {
  const conflict = error instanceof CommandConflictError;
  const toolCall = error instanceof ToolCallValidationError;
  send(socket, {
    type: 'error',
    ...(commandId ? { commandId } : {}),
    code: conflict ? 'command_conflict' : toolCall ? 'invalid_tool_call' : 'invalid_command',
    error: error instanceof Error ? error.message : String(error),
  });
}

export function registerOperatorRoutes(
  app: FastifyInstance,
  requests: RequestManager,
  config: ServiceConfig,
) {
  const auth = new OperatorAuth(config);
  const guard = async (request: FastifyRequest, reply: FastifyReply) => {
    requireOperator(request, reply, auth, config);
  };

  app.post('/operator/login', async (request, reply) => {
    if (!isAllowedOperatorOrigin(request, config)) {
      return reply.status(403).send({ error: 'Operator origin is not allowed' });
    }
    if (!auth.enabled) return { authenticated: true, authRequired: false };
    const password = isRecord(request.body) ? request.body.password : undefined;
    if (typeof password !== 'string') {
      return reply.status(400).send({ error: 'A password is required' });
    }
    const token = auth.login(password);
    if (!token) return reply.status(401).send({ error: 'Invalid operator credentials' });
    auth.setSessionCookie(reply, token);
    return { authenticated: true, authRequired: true };
  });

  app.get('/operator/session', async (request) => ({
    authenticated: auth.authenticated(request),
    authRequired: auth.enabled,
  }));

  app.post('/operator/logout', { preHandler: guard }, async (request, reply) => {
    auth.logout(request);
    auth.clearSessionCookie(reply);
    return { ok: true };
  });

  app.get('/operator/request', { preHandler: guard }, async () => ({
    request: requests.current()?.snapshot() ?? null,
  }));

  app.get(
    '/operator/ws',
    {
      websocket: true,
      preValidation: guard,
    },
    (socket) => {
      send(socket, {
        type: 'hello',
        protocolVersion: 2,
        request: requests.current()?.snapshot() ?? null,
      });
      const unsubscribe = requests.subscribe((event) => send(socket, { type: 'event', ...event }));

      socket.on('message', (data) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(data.toString());
        } catch {
          commandError(socket, new Error('Message must be valid JSON'));
          return;
        }
        const frame = parseFrame(parsed);
        if (!frame) {
          commandError(
            socket,
            new Error('Message does not match the operator protocol'),
            isRecord(parsed) && typeof parsed.commandId === 'string' ? parsed.commandId : undefined,
          );
          return;
        }
        if (frame.type === 'resume') {
          send(socket, {
            type: 'replay',
            request: requests.current()?.snapshot() ?? null,
            events: requests.eventsAfter(frame.requestId, frame.afterSequence),
          });
          return;
        }
        try {
          send(socket, requests.execute(frame));
        } catch (error) {
          commandError(socket, error, frame.commandId);
        }
      });
      socket.once('close', unsubscribe);
      socket.once('error', unsubscribe);
    },
  );
}
