import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { buildApp } from '../src/server/app.js';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface OperatorSocket {
  socket: WebSocket;
  messages: unknown[];
}

async function openOperator(
  app: FastifyInstance,
  headers: Record<string, string> = {},
): Promise<OperatorSocket> {
  await app.ready();
  const messages: unknown[] = [];
  const socket = await app.injectWS(
    '/operator/ws',
    { headers },
    {
      onInit(candidate) {
        candidate.on('message', (data) => messages.push(JSON.parse(data.toString())));
      },
    },
  );
  return { socket, messages };
}

async function waitForMessage(
  inbox: OperatorSocket,
  predicate: (message: JsonRecord) => boolean,
  timeoutMs = 2_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const index = inbox.messages.findIndex((message) => isRecord(message) && predicate(message));
    if (index >= 0) return inbox.messages.splice(index, 1)[0] as JsonRecord;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(
    `Timed out waiting for WebSocket message; received ${JSON.stringify(inbox.messages)}`,
  );
}

function send(socket: WebSocket, message: unknown) {
  socket.send(JSON.stringify(message));
}

function completionRequest(stream = false) {
  return {
    method: 'POST' as const,
    url: '/v1/chat/completions',
    payload: {
      model: 'artisanal-intelligence',
      messages: [{ role: 'user', content: 'Hello?' }],
      stream,
    },
  };
}

async function activeRequestFromEvent(inbox: OperatorSocket) {
  const message = await waitForMessage(
    inbox,
    (candidate) =>
      candidate.type === 'event' &&
      isRecord(candidate.event) &&
      candidate.event.type === 'request_started',
  );
  assert.ok(isRecord(message.request));
  assert.equal(typeof message.request.id, 'string');
  return message.request;
}

test('serves health and built UI while unknown API routes stay 404', async () => {
  const root = await mkdtemp(join(tmpdir(), 'artisanal-test-'));
  const app = buildApp({ staticRoot: root });
  try {
    await writeFile(join(root, 'index.html'), '<h1>Operator console</h1>');
    const health = await app.inject('/api/health');
    assert.equal(health.statusCode, 200);
    assert.equal(health.json().status, 'ok');
    const page = await app.inject('/');
    assert.equal(page.statusCode, 200);
    assert.match(page.headers['content-type'] ?? '', /text\/html/);
    assert.match(page.body, /Operator console/);
    const unknown = await app.inject('/v1/not-implemented');
    assert.equal(unknown.statusCode, 404);
    const invalidCompletion = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: { messages: 'not-an-array' },
    });
    assert.equal(invalidCompletion.statusCode, 400);
    assert.equal(invalidCompletion.json().error.code, 'invalid_request');
    const removedHttpTransport = await app.inject({
      method: 'POST',
      url: '/operator/requests/missing/delta',
      payload: { channel: 'final', text: 'legacy' },
    });
    assert.equal(removedHttpTransport.statusCode, 404);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('WebSocket drives a non-streaming completion with ordered ack and deduplication', async () => {
  const app = buildApp({ config: { requestTimeoutMs: 2_000 } });
  const operator = await openOperator(app);
  try {
    await waitForMessage(operator, (message) => message.type === 'hello');
    const completion = app.inject(completionRequest());
    const request = await activeRequestFromEvent(operator);
    const requestId = request.id as string;

    const thinking = {
      type: 'delta',
      commandId: 'thinking-1',
      requestId,
      channel: 'thinking',
      text: 'reasoning',
    };
    send(operator.socket, thinking);
    const thinkingAck = await waitForMessage(
      operator,
      (message) => message.type === 'ack' && message.commandId === 'thinking-1',
    );
    assert.equal(thinkingAck.duplicate, false);
    assert.equal(thinkingAck.sequence, 2);

    send(operator.socket, thinking);
    const duplicateAck = await waitForMessage(
      operator,
      (message) => message.type === 'ack' && message.commandId === 'thinking-1',
    );
    assert.equal(duplicateAck.duplicate, true);
    assert.equal(duplicateAck.eventId, thinkingAck.eventId);

    send(operator.socket, {
      type: 'delta',
      commandId: 'final-1',
      requestId,
      channel: 'final',
      text: 'answer',
    });
    await waitForMessage(
      operator,
      (message) => message.type === 'ack' && message.commandId === 'final-1',
    );
    send(operator.socket, { type: 'finish', commandId: 'finish-1', requestId });
    const finishAck = await waitForMessage(
      operator,
      (message) => message.type === 'ack' && message.commandId === 'finish-1',
    );
    assert.equal(finishAck.sequence, 4);

    const response = await completion;
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().choices[0], {
      index: 0,
      message: { role: 'assistant', content: 'answer', reasoning: 'reasoning' },
      finish_reason: 'stop',
    });
  } finally {
    operator.socket.terminate();
    await app.close();
  }
});

test('WebSocket resumes from sequence and rejects conflicting or malformed commands', async () => {
  const app = buildApp({ config: { requestTimeoutMs: 2_000 } });
  const operator = await openOperator(app);
  let reconnected: OperatorSocket | undefined;
  try {
    await waitForMessage(operator, (message) => message.type === 'hello');
    const completion = app.inject(completionRequest());
    const request = await activeRequestFromEvent(operator);
    const requestId = request.id as string;
    const command = {
      type: 'delta',
      commandId: 'stable-command',
      requestId,
      channel: 'final',
      text: 'a',
    };
    send(operator.socket, command);
    await waitForMessage(
      operator,
      (message) => message.type === 'ack' && message.commandId === 'stable-command',
    );

    operator.socket.terminate();
    reconnected = await openOperator(app);
    const hello = await waitForMessage(reconnected, (message) => message.type === 'hello');
    assert.ok(isRecord(hello.request));
    assert.equal(hello.request.id, requestId);
    assert.equal(hello.request.output, 'a');

    send(reconnected.socket, command);
    const duplicate = await waitForMessage(
      reconnected,
      (message) => message.type === 'ack' && message.commandId === 'stable-command',
    );
    assert.equal(duplicate.duplicate, true);

    send(reconnected.socket, { type: 'resume', requestId, afterSequence: 1 });
    const replay = await waitForMessage(reconnected, (message) => message.type === 'replay');
    assert.ok(Array.isArray(replay.events));
    assert.deepEqual(
      replay.events.map((event) => (isRecord(event) ? event.type : undefined)),
      ['text_delta'],
    );

    send(reconnected.socket, { ...command, text: 'b' });
    const conflict = await waitForMessage(
      reconnected,
      (message) => message.type === 'error' && message.commandId === 'stable-command',
    );
    assert.equal(conflict.code, 'command_conflict');
    reconnected.socket.send('{bad json');
    const malformed = await waitForMessage(
      reconnected,
      (message) => message.type === 'error' && !message.commandId,
    );
    assert.equal(malformed.code, 'invalid_command');

    send(reconnected.socket, { type: 'finish', commandId: 'finish', requestId });
    await completion;
  } finally {
    operator.socket.terminate();
    reconnected?.socket.terminate();
    await app.close();
  }
});

test('streams reasoning, final text, stop, and DONE through Chat Completions SSE', async () => {
  const app = buildApp({ config: { requestTimeoutMs: 2_000 } });
  const operator = await openOperator(app);
  try {
    await waitForMessage(operator, (message) => message.type === 'hello');
    const completion = app.inject(completionRequest(true));
    const request = await activeRequestFromEvent(operator);
    const requestId = request.id as string;

    send(operator.socket, {
      type: 'delta',
      commandId: 'sse-thinking',
      requestId,
      channel: 'thinking',
      text: 'why',
    });
    await waitForMessage(
      operator,
      (message) => message.type === 'ack' && message.commandId === 'sse-thinking',
    );
    send(operator.socket, {
      type: 'delta',
      commandId: 'sse-final',
      requestId,
      channel: 'final',
      text: 'result',
    });
    await waitForMessage(
      operator,
      (message) => message.type === 'ack' && message.commandId === 'sse-final',
    );
    send(operator.socket, { type: 'finish', commandId: 'sse-finish', requestId });

    const response = await completion;
    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'] ?? '', /text\/event-stream/);
    assert.match(response.body, /"reasoning":"why"/);
    assert.match(response.body, /"content":"result"/);
    assert.match(response.body, /"finish_reason":"stop"/);
    assert.match(response.body, /data: \[DONE\]/);
  } finally {
    operator.socket.terminate();
    await app.close();
  }
});

test('ends an SSE response with a structured timeout error and DONE', async () => {
  const app = buildApp({ config: { requestTimeoutMs: 30 } });
  const operator = await openOperator(app);
  try {
    await waitForMessage(operator, (message) => message.type === 'hello');
    const completion = app.inject(completionRequest(true));
    await activeRequestFromEvent(operator);
    const response = await completion;
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /"code":"request_timeout"/);
    assert.match(response.body, /data: \[DONE\]/);
  } finally {
    operator.socket.terminate();
    await app.close();
  }
});

test('returns busy, cancellation, and timeout errors and releases the active request', async () => {
  const app = buildApp({ config: { requestTimeoutMs: 40 } });
  const operator = await openOperator(app);
  try {
    await waitForMessage(operator, (message) => message.type === 'hello');
    const first = app.inject(completionRequest());
    const request = await activeRequestFromEvent(operator);
    const busy = await app.inject(completionRequest());
    assert.equal(busy.statusCode, 409);
    assert.equal(busy.json().error.code, 'operator_busy');

    send(operator.socket, {
      type: 'cancel',
      commandId: 'cancel-1',
      requestId: request.id,
      reason: 'operator declined',
    });
    await waitForMessage(
      operator,
      (message) => message.type === 'ack' && message.commandId === 'cancel-1',
    );
    const cancelled = await first;
    assert.equal(cancelled.statusCode, 499);
    assert.equal(cancelled.json().error.code, 'request_cancelled');

    const timedOut = await app.inject(completionRequest());
    assert.equal(timedOut.statusCode, 504);
    assert.equal(timedOut.json().error.code, 'request_timed_out');
    const current = await app.inject('/operator/request');
    assert.equal(current.json().request, null);
  } finally {
    operator.socket.terminate();
    await app.close();
  }
});

test('enforces independent API and operator authentication plus operator Origin checks', async () => {
  const app = buildApp({
    config: {
      apiKey: 'api-secret',
      operatorPassword: 'operator-secret',
      operatorOrigins: ['https://console.example'],
    },
  });
  try {
    const unauthenticatedApi = await app.inject('/v1/models');
    assert.equal(unauthenticatedApi.statusCode, 401);
    const authenticatedApi = await app.inject({
      url: '/v1/models',
      headers: { authorization: 'Bearer api-secret' },
    });
    assert.equal(authenticatedApi.statusCode, 200);

    const unauthenticatedOperator = await app.inject('/operator/request');
    assert.equal(unauthenticatedOperator.statusCode, 401);
    const badOrigin = await app.inject({
      method: 'POST',
      url: '/operator/login',
      headers: { origin: 'https://evil.example' },
      payload: { password: 'operator-secret' },
    });
    assert.equal(badOrigin.statusCode, 403);
    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/operator/login',
      headers: { origin: 'https://console.example' },
      payload: { password: 'wrong' },
    });
    assert.equal(wrongPassword.statusCode, 401);
    const login = await app.inject({
      method: 'POST',
      url: '/operator/login',
      headers: { origin: 'https://console.example' },
      payload: { password: 'operator-secret' },
    });
    assert.equal(login.statusCode, 200);
    assert.equal(login.headers['access-control-allow-origin'], 'https://console.example');
    const cookie = login.cookies[0];
    assert.ok(cookie);
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.sameSite, 'Strict');

    const authenticatedOperator = await app.inject({
      url: '/operator/request',
      headers: {
        origin: 'https://console.example',
        cookie: `${cookie.name}=${cookie.value}`,
      },
    });
    assert.equal(authenticatedOperator.statusCode, 200);

    await assert.rejects(app.injectWS('/operator/ws'));
    const operator = await openOperator(app, {
      origin: 'https://console.example',
      cookie: `${cookie.name}=${cookie.value}`,
    });
    await waitForMessage(operator, (message) => message.type === 'hello');
    operator.socket.terminate();

    const logout = await app.inject({
      method: 'POST',
      url: '/operator/logout',
      headers: {
        origin: 'https://console.example',
        cookie: `${cookie.name}=${cookie.value}`,
      },
    });
    assert.equal(logout.statusCode, 200);
    const loggedOutSession = await app.inject({
      url: '/operator/session',
      headers: { cookie: `${cookie.name}=${cookie.value}` },
    });
    assert.equal(loggedOutSession.json().authenticated, false);
  } finally {
    await app.close();
  }
});
