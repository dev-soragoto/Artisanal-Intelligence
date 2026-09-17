export type CookieSameSite = 'strict' | 'lax' | 'none';

export interface ServiceConfig {
  requestTimeoutMs: number;
  apiKey?: string;
  operatorPassword?: string;
  operatorOrigins: string[];
  operatorSessionTtlMs: number;
  operatorCookieSecure: boolean;
  operatorCookieSameSite: CookieSameSite;
}

export const defaultServiceConfig: ServiceConfig = {
  requestTimeoutMs: 300_000,
  operatorOrigins: [],
  operatorSessionTtlMs: 12 * 60 * 60 * 1_000,
  operatorCookieSecure: false,
  operatorCookieSameSite: 'strict',
};

function positiveInteger(value: string | undefined, fallback: number, name: string) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function readSameSite(value: string | undefined): CookieSameSite {
  if (!value) return defaultServiceConfig.operatorCookieSameSite;
  if (value === 'strict' || value === 'lax' || value === 'none') return value;
  throw new Error('ARTISANAL_OPERATOR_COOKIE_SAMESITE must be strict, lax, or none');
}

function isLoopback(host: string) {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

export function readServiceConfig(
  environment: NodeJS.ProcessEnv = process.env,
  host = environment.HOST ?? '127.0.0.1',
): ServiceConfig {
  const config: ServiceConfig = {
    requestTimeoutMs: positiveInteger(
      environment.ARTISANAL_REQUEST_TIMEOUT_MS,
      defaultServiceConfig.requestTimeoutMs,
      'ARTISANAL_REQUEST_TIMEOUT_MS',
    ),
    apiKey: environment.ARTISANAL_API_KEY || undefined,
    operatorPassword: environment.ARTISANAL_OPERATOR_PASSWORD || undefined,
    operatorOrigins: (environment.ARTISANAL_OPERATOR_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim().replace(/\/$/, ''))
      .filter(Boolean),
    operatorSessionTtlMs: positiveInteger(
      environment.ARTISANAL_OPERATOR_SESSION_TTL_MS,
      defaultServiceConfig.operatorSessionTtlMs,
      'ARTISANAL_OPERATOR_SESSION_TTL_MS',
    ),
    operatorCookieSecure: environment.ARTISANAL_OPERATOR_COOKIE_SECURE === '1',
    operatorCookieSameSite: readSameSite(environment.ARTISANAL_OPERATOR_COOKIE_SAMESITE),
  };

  if (!isLoopback(host) && (!config.apiKey || !config.operatorPassword)) {
    throw new Error(
      'ARTISANAL_API_KEY and ARTISANAL_OPERATOR_PASSWORD are required when HOST is not loopback',
    );
  }
  if (config.operatorCookieSameSite === 'none' && !config.operatorCookieSecure) {
    throw new Error('SameSite=None operator cookies require ARTISANAL_OPERATOR_COOKIE_SECURE=1');
  }
  return config;
}
