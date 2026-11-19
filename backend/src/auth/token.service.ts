import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';

export type Role = 'SUPERVISOR' | 'HSE' | 'ADMIN';

export interface AuthUser {
  id: string;
  orgId: string;
  role: Role;
}

interface Payload {
  sub: string;
  org: string;
  role: Role;
  exp: number;
}

/** A worker's sign-in link. It carries no role and unlocks only that worker's own data. */
interface WorkerPayload {
  sub: string;
  kind: 'worker';
  /** The worker's linkVersion when the link was issued. */
  v: number;
  exp: number;
}

export interface AuthWorker {
  id: string;
  linkVersion: number;
}

const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const TTL_SECONDS = 12 * 60 * 60;
const WORKER_TTL_SECONDS = 30 * 24 * 60 * 60;
const ROLES: Role[] = ['SUPERVISOR', 'HSE', 'ADMIN'];

/** Signs and checks HS256 JSON Web Tokens with JWT_SECRET. */
@Injectable()
export class TokenService {
  private readonly secret: string;

  constructor() {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) {
      throw new Error('JWT_SECRET must be set to at least 32 characters');
    }
    this.secret = secret;
  }

  sign(user: AuthUser, now: Date = new Date()): { token: string; expiresAt: Date } {
    const exp = Math.floor(now.getTime() / 1000) + TTL_SECONDS;
    const payload: Payload = { sub: user.id, org: user.orgId, role: user.role, exp };
    const body = `${HEADER}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
    return { token: `${body}.${this.signature(body)}`, expiresAt: new Date(exp * 1000) };
  }

  signWorker(worker: AuthWorker, now: Date = new Date()): { token: string; expiresAt: Date } {
    const exp = Math.floor(now.getTime() / 1000) + WORKER_TTL_SECONDS;
    const payload: WorkerPayload = { sub: worker.id, kind: 'worker', v: worker.linkVersion, exp };
    const body = `${HEADER}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
    return { token: `${body}.${this.signature(body)}`, expiresAt: new Date(exp * 1000) };
  }

  /**
   * Returns the worker a sign-in link was issued to. The caller must still
   * check linkVersion against the worker's current one, so that issuing a new
   * link can revoke the old ones.
   */
  verifyWorker(token: string, now: Date = new Date()): AuthWorker | null {
    const payload = this.payloadOf(token, now) as Partial<WorkerPayload> | null;
    if (!payload || payload.kind !== 'worker') return null;
    if (typeof payload.sub !== 'string' || typeof payload.v !== 'number') return null;
    return { id: payload.sub, linkVersion: payload.v };
  }

  /** Returns the user a token was issued to, or null if it is malformed, forged or expired. */
  verify(token: string, now: Date = new Date()): AuthUser | null {
    const payload = this.payloadOf(token, now) as (Partial<Payload> & { kind?: string }) | null;
    // A worker's link must never pass as a staff token.
    if (!payload || payload.kind === 'worker') return null;
    if (typeof payload.sub !== 'string' || typeof payload.org !== 'string') return null;
    if (!payload.role || !ROLES.includes(payload.role)) return null;
    return { id: payload.sub, orgId: payload.org, role: payload.role };
  }

  /** Checks the signature and expiry, and returns the payload. */
  private payloadOf(token: string, now: Date): Record<string, unknown> | null {
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== HEADER) return null;
    const expected = Buffer.from(this.signature(`${parts[0]}.${parts[1]}`));
    const given = Buffer.from(parts[2]);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
      if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now.getTime()) return null;
      return payload;
    } catch {
      return null;
    }
  }

  private signature(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url');
  }
}
