import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/server/app.js';

test('serves health and UI while unknown API routes stay 404', async () => {
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
  } finally {
    await app.close();
    // root is created above by mkdtemp, never derived from user input.
    await rm(root, { recursive: true, force: true });
  }
});
