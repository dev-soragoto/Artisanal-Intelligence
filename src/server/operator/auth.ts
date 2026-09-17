import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ServiceConfig } from '../config.js';

export const operatorCookieName = 'artisanal_operator_session';

function equalSecret(actual: string, expected: string) {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export class OperatorAuth {
  private readonly sessions = new Map<string, number>();

  constructor(private readonly config: ServiceConfig) {}

  get enabled() {
    return Boolean(this.config.operatorPassword);
  }

  login(password: string) {
    if (!this.config.operatorPassword) return undefined;
    if (!equalSecret(password, this.config.operatorPassword)) return null;
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(token, Date.now() + this.config.operatorSessionTtlMs);
    return token;
  }

  logout(request: FastifyRequest) {
    const token = request.cookies[operatorCookieName];
    if (token) this.sessions.delete(token);
  }

  authenticated(request: FastifyRequest) {
    if (!this.enabled) return true;
    const token = request.cookies[operatorCookieName];
    if (!token) return false;
    const expiresAt = this.sessions.get(token);
    if (!expiresAt || expiresAt <= Date.now()) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }

  setSessionCookie(reply: FastifyReply, token: string) {
    reply.setCookie(operatorCookieName, token, {
      path: '/operator',
      httpOnly: true,
      sameSite: this.config.operatorCookieSameSite,
      secure: this.config.operatorCookieSecure,
      maxAge: Math.floor(this.config.operatorSessionTtlMs / 1_000),
    });
  }

  clearSessionCookie(reply: FastifyReply) {
    reply.clearCookie(operatorCookieName, {
      path: '/operator',
      httpOnly: true,
      sameSite: this.config.operatorCookieSameSite,
      secure: this.config.operatorCookieSecure,
    });
  }
}

export function isAllowedOperatorOrigin(request: FastifyRequest, config: ServiceConfig) {
  const origin = request.headers.origin;
  if (!origin) return true;
  const normalized = origin.replace(/\/$/, '');
  if (config.operatorOrigins.includes(normalized)) return true;
  const host = request.headers.host;
  return typeof host === 'string' && normalized === `${request.protocol}://${host}`;
}

export function requireOperator(
  request: FastifyRequest,
  reply: FastifyReply,
  auth: OperatorAuth,
  config: ServiceConfig,
) {
  if (!isAllowedOperatorOrigin(request, config)) {
    void reply.status(403).send({ error: 'Operator origin is not allowed' });
    return;
  }
  if (!auth.authenticated(request)) {
    void reply.status(401).send({ error: 'Operator authentication required' });
  }
}
