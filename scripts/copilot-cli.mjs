import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const agentDirectory = resolve(process.env.ARTISANAL_AGENT_DIR?.trim() || join(root, 'agent'));
const copilotHome = resolve(
  process.env.ARTISANAL_COPILOT_HOME?.trim() || join(agentDirectory, 'run', 'copilot'),
);
const providerBaseUrl = normalizeProviderBaseUrl(
  process.env.ARTISANAL_API_BASE_URL?.trim() || 'http://127.0.0.1:3000',
);
const apiKey = process.env.ARTISANAL_API_KEY?.trim() || 'sk-artisanal-intelligence';

await mkdir(agentDirectory, { recursive: true });
await mkdir(copilotHome, { recursive: true });

const environment = {
  ...process.env,
  COPILOT_HOME: copilotHome,
  COPILOT_OFFLINE: process.env.ARTISANAL_COPILOT_OFFLINE === '0' ? 'false' : 'true',
  COPILOT_PROVIDER_BASE_URL: providerBaseUrl,
  COPILOT_PROVIDER_BEARER_TOKEN: apiKey,
  COPILOT_PROVIDER_TYPE: 'openai',
  COPILOT_PROVIDER_WIRE_API: 'completions',
  COPILOT_PROVIDER_MODEL_ID: process.env.ARTISANAL_COPILOT_MODEL_ID?.trim() || 'gpt-4.1',
  COPILOT_PROVIDER_WIRE_MODEL:
    process.env.ARTISANAL_COPILOT_WIRE_MODEL?.trim() || 'artisanal-intelligence',
};

delete environment.COPILOT_MODEL;
delete environment.COPILOT_PROVIDER_API_KEY;

const executable = process.env.ARTISANAL_COPILOT_BIN?.trim() || 'copilot';
const child = spawn(executable, process.argv.slice(2), {
  cwd: agentDirectory,
  env: environment,
  stdio: 'inherit',
});

child.once('error', (error) => {
  console.error(`Unable to start GitHub Copilot CLI (${executable}): ${error.message}`);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  if (signal) {
    console.error(`GitHub Copilot CLI exited after signal ${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});

function normalizeProviderBaseUrl(value) {
  const url = new URL(value);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/v1`.replace(/\/v1\/v1$/, '/v1');
  return url.toString().replace(/\/$/, '');
}
