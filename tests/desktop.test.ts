import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../src-tauri/resources/server.cjs', import.meta.url));

test(
  'bundled desktop backend starts, rejects a busy port, and exits when its host closes',
  { timeout: 20000 },
  async () => {
    const child = spawn(process.execPath, [entry], {
      env: { ...process.env, PORT: '0' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const exited = once(child, 'exit');
    const lines = createInterface({ input: child.stdout });
    let second: ReturnType<typeof spawn> | undefined;
    try {
      const [line] = await once(lines, 'line');
      const { port, error } = JSON.parse(line);
      assert.equal(error, undefined);
      assert.ok(port > 0);
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).service, 'artisanal-intelligence');

      second = spawn(process.execPath, [entry], {
        env: { ...process.env, PORT: String(port) },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const secondExit = once(second, 'exit');
      const secondLines = createInterface({ input: second.stdout! });
      const [failure] = await once(secondLines, 'line');
      assert.match(JSON.parse(failure).error, /EADDRINUSE/);
      const [failureCode] = await secondExit;
      assert.equal(failureCode, 1);
      secondLines.close();

      child.stdin.end();
      const [exitCode] = await exited;
      assert.equal(exitCode, 0);
      await assert.rejects(fetch(`http://127.0.0.1:${port}/api/health`));
    } finally {
      lines.close();
      child.kill();
      second?.kill();
    }
  },
);
