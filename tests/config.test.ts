import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readServiceConfig } from '../src/server/config.js';

test('loopback development can run without credentials', () => {
  const config = readServiceConfig({}, '127.0.0.1');
  assert.equal(config.apiKey, undefined);
  assert.equal(config.operatorPassword, undefined);
});

test('non-loopback binding fails closed without both authentication boundaries', () => {
  assert.throws(
    () => readServiceConfig({}, '0.0.0.0'),
    /ARTISANAL_API_KEY and ARTISANAL_OPERATOR_PASSWORD/,
  );
  assert.throws(
    () => readServiceConfig({ ARTISANAL_API_KEY: 'api' }, '0.0.0.0'),
    /ARTISANAL_OPERATOR_PASSWORD/,
  );
  const config = readServiceConfig(
    { ARTISANAL_API_KEY: 'api', ARTISANAL_OPERATOR_PASSWORD: 'operator' },
    '0.0.0.0',
  );
  assert.equal(config.apiKey, 'api');
  assert.equal(config.operatorPassword, 'operator');
});

test('cross-site operator cookies require the Secure attribute', () => {
  assert.throws(
    () =>
      readServiceConfig(
        {
          ARTISANAL_OPERATOR_COOKIE_SAMESITE: 'none',
          ARTISANAL_OPERATOR_COOKIE_SECURE: '0',
        },
        '127.0.0.1',
      ),
    /require ARTISANAL_OPERATOR_COOKIE_SECURE=1/,
  );
});
