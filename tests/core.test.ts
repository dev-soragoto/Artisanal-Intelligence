import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CommandConflictError, RequestManager } from '../src/server/core/request-manager.js';
import {
  RequestSession,
  RequestTerminalError,
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
  assert.deepEqual(await session.waitForFinal(), { reasoning: 'think', content: 'answer' });
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
  assert.deepEqual(await session.waitForFinal(), { reasoning: '', content: 'once' });
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
