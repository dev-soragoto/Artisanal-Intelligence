import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ServiceConfig } from '../config.js';
import { BusyError, RequestManager } from '../core/request-manager.js';
import {
  RequestTerminalError,
  type InferenceRequest,
  type RequestEvent,
  type RequestSession,
} from '../core/request-session.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function openAIError(reply: FastifyReply, status: number, message: string, code: string) {
  return reply.status(status).send({
    error: {
      message,
      type: 'invalid_request_error',
      param: null,
      code,
    },
  });
}

function equalSecret(actual: string, expected: string) {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function requireApiKey(request: FastifyRequest, reply: FastifyReply, expected?: string) {
  if (!expected) return;
  const authorization = request.headers.authorization;
  const actual = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!equalSecret(actual, expected)) {
    openAIError(reply, 401, 'Invalid or missing API key', 'invalid_api_key');
  }
}

function parseRequest(body: unknown): InferenceRequest | undefined {
  if (!isRecord(body) || !Array.isArray(body.messages)) return undefined;
  return {
    model:
      typeof body.model === 'string' && body.model.length > 0
        ? body.model
        : 'artisanal-intelligence',
    messages: body.messages,
    tools: Array.isArray(body.tools) ? body.tools : [],
    stream: body.stream === true,
  };
}

function completionId(session: RequestSession) {
  return `chatcmpl_${session.id}`;
}

function streamChunk(
  session: RequestSession,
  model: string,
  delta: Record<string, unknown>,
  finishReason: string | null,
) {
  return {
    id: completionId(session),
    object: 'chat.completion.chunk',
    created: Math.floor(session.createdAt / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function writeSse(response: NodeJS.WritableStream, value: unknown) {
  response.write(`data: ${JSON.stringify(value)}\n\n`);
}

function streamResponse(
  reply: FastifyReply,
  requests: RequestManager,
  session: RequestSession,
  model: string,
) {
  reply.hijack();
  const response = reply.raw;
  response.statusCode = 200;
  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.setHeader('X-Accel-Buffering', 'no');
  response.flushHeaders?.();

  writeSse(response, streamChunk(session, model, { role: 'assistant' }, null));

  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    unsubscribe();
    requests.release(session.id);
  };

  const onEvent = (event: RequestEvent) => {
    if (closed || response.writableEnded || response.destroyed) return;
    if (event.type === 'request_started') return;
    if (event.type === 'reasoning_delta') {
      // `reasoning` is an OpenAI-compatible ecosystem extension used by vLLM.
      // The core event remains protocol-neutral; Responses API gets its own adapter later.
      writeSse(response, streamChunk(session, model, { reasoning: event.text }, null));
      return;
    }
    if (event.type === 'text_delta') {
      writeSse(response, streamChunk(session, model, { content: event.text }, null));
      return;
    }
    if (event.type === 'finish') {
      writeSse(response, streamChunk(session, model, {}, 'stop'));
      response.write('data: [DONE]\n\n');
      response.end();
      finish();
      return;
    }
    writeSse(response, {
      error: {
        message: event.reason,
        type: 'server_error',
        code: event.type === 'timeout' ? 'request_timeout' : `request_${event.type}`,
      },
    });
    response.write('data: [DONE]\n\n');
    response.end();
    finish();
  };

  const unsubscribe = session.subscribe(onEvent);
  response.once('close', () => {
    if (!closed && !response.writableEnded) {
      requests.cancel(session.id, 'Client disconnected during streaming response', 'client');
    }
    finish();
  });
}

export function registerOpenAIRoutes(
  app: FastifyInstance,
  requests: RequestManager,
  config: ServiceConfig,
) {
  const guard = async (request: FastifyRequest, reply: FastifyReply) => {
    requireApiKey(request, reply, config.apiKey);
  };

  app.get('/v1/models', { preHandler: guard }, async () => ({
    object: 'list',
    data: [
      {
        id: 'artisanal-intelligence',
        object: 'model',
        created: 0,
        owned_by: 'biological-intelligence',
      },
    ],
  }));

  app.post('/v1/chat/completions', { preHandler: guard }, async (request, reply) => {
    const input = parseRequest(request.body);
    if (!input) return openAIError(reply, 400, '`messages` must be an array', 'invalid_request');

    let session;
    try {
      session = requests.create(input);
    } catch (error) {
      if (error instanceof BusyError) {
        return openAIError(reply, 409, error.message, 'operator_busy');
      }
      throw error;
    }

    if (input.stream) {
      streamResponse(reply, requests, session, input.model);
      return reply;
    }

    const onAborted = () =>
      requests.cancel(session.id, 'Client disconnected before completion', 'client');
    request.raw.once('aborted', onAborted);
    try {
      const output = await session.waitForFinal();
      return {
        id: completionId(session),
        object: 'chat.completion',
        created: Math.floor(session.createdAt / 1000),
        model: input.model,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: output.content,
              ...(output.reasoning ? { reasoning: output.reasoning } : {}),
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
      };
    } catch (error) {
      if (error instanceof RequestTerminalError) {
        const status = error.state === 'timed_out' ? 504 : error.state === 'cancelled' ? 499 : 500;
        return openAIError(reply, status, error.message, `request_${error.state}`);
      }
      throw error;
    } finally {
      request.raw.off('aborted', onAborted);
      requests.release(session.id);
    }
  });
}
