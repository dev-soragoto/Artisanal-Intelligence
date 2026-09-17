import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CommandConflictError, RequestManager } from '../src/server/core/request-manager.js';
import {
  RequestSession,
  RequestTerminalError,
  ToolCallValidationError,
  type RequestEvent,
} from '../src/server/core/request-session.js';

const input = {
  model: 'artisanal-intelligence',
  messages: [{ role: 'user', content: 'Hello' }],
  tools: [],
  stream: false,
};

test('RequestSession records ordered immutable lifecycle events and completed output', async () => {
  const session = new RequestSession(input);
  const observed: RequestEvent[] = [];
  session.subscribe((event) => observed.push(event));

  session.activate();
  session.appendReasoning('think');
  session.appendText('answer');
  session.finish();

  assert.deepEqual(
    observed.map((event) => [event.sequence, event.type]),
    [
      [1, 'request_started'],
      [2, 'reasoning_delta'],
      [3, 'text_delta'],
      [4, 'finish'],
    ],
  );
  assert.equal(new Set(observed.map((event) => event.eventId)).size, 4);
  assert.deepEqual(await session.waitForFinal(), {
    reasoning: 'think',
    content: 'answer',
    corrections: [],
    toolCalls: [],
  });
  assert.deepEqual(session.eventsAfter(2), observed.slice(2));
  assert.equal(session.snapshot().state, 'finished');
  assert.throws(() => session.appendText('late'), /state finished/);
});

test('RequestManager acknowledges duplicate commands without applying them twice', async () => {
  const manager = new RequestManager({ requestTimeoutMs: 0 });
  const session = manager.create(input);
  const command = {
    type: 'delta' as const,
    commandId: 'cmd-1',
    requestId: session.id,
    channel: 'final' as const,
    text: 'once',
  };

  const first = manager.execute(command);
  const duplicate = manager.execute(command);

  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.eventId, first.eventId);
  assert.equal(session.snapshot().output, 'once');
  assert.throws(() => manager.execute({ ...command, text: 'different' }), CommandConflictError);
  manager.execute({ type: 'finish', commandId: 'cmd-2', requestId: session.id });
  assert.deepEqual(await session.waitForFinal(), {
    reasoning: '',
    content: 'once',
    corrections: [],
    toolCalls: [],
  });
});

test('RequestSession keeps corrections append-only and validates tool calls against JSON Schema', async () => {
  const session = new RequestSession({
    ...input,
    tools: [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          parameters: {
            type: 'object',
            properties: { city: { type: 'string' }, days: { type: 'integer', minimum: 1 } },
            required: ['city'],
            additionalProperties: false,
          },
        },
      },
    ],
  });
  session.activate();
  session.appendText('draft');
  const correction = session.correct('final', 'aft');
  assert.equal(correction?.type, 'correction');
  assert.equal(session.snapshot().output, 'draft');
  assert.deepEqual(session.snapshot().corrections, [
    { channel: 'final', deleted: 'aft', source: 'human' },
  ]);

  assert.throws(
    () => session.appendToolCall('get_weather', { city: 'Shanghai', days: 0 }),
    ToolCallValidationError,
  );
  assert.throws(() => session.appendToolCall('missing', {}), /Unknown tool/);
  const event = session.appendToolCall('get_weather', '{"city":"Shanghai","days":2}');
  assert.equal(event.type, 'tool_call');
  assert.equal(event.index, 0);
  assert.deepEqual(event.toolCall.function, {
    name: 'get_weather',
    arguments: '{"city":"Shanghai","days":2}',
  });
  session.finish();
  const completed = await session.waitForFinal();
  assert.equal(completed.content, 'draft');
  assert.equal(completed.corrections[0].deleted, 'aft');
  assert.equal(completed.toolCalls[0].function.name, 'get_weather');
});

test('RequestManager times out an unanswered request and permits a later request after release', async () => {
  const manager = new RequestManager({ requestTimeoutMs: 10 });
  const first = manager.create(input);

  await assert.rejects(
    first.waitForFinal(),
    (error: unknown) => error instanceof RequestTerminalError && error.state === 'timed_out',
  );
  assert.equal(first.snapshot().state, 'timed_out');
  manager.release(first.id);

  const second = manager.create(input);
  assert.equal(second.snapshot().state, 'active');
  manager.shutdown();
  await assert.rejects(second.waitForFinal(), RequestTerminalError);
});

test('RequestSession reports an explicit failure without an unhandled rejection', async () => {
  const session = new RequestSession(input);
  session.activate();
  const event = session.fail('output sink failed');

  assert.equal(event?.type, 'failure');
  assert.equal(session.snapshot().state, 'failed');
  await assert.rejects(
    session.waitForFinal(),
    (error: unknown) => error instanceof RequestTerminalError && error.state === 'failed',
  );
});
