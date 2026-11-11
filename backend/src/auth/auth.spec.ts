import { randomBytes, scryptSync } from 'node:crypto';
import { verifyPassword } from './password.js';
import { TokenService } from './token.service.js';

describe('verifyPassword', () => {
  const salt = randomBytes(16);
  const stored = `scrypt:${salt.toString('hex')}:${scryptSync('correct horse', salt, 64).toString('hex')}`;

  it('accepts the right password and rejects a wrong one', () => {
    expect(verifyPassword('correct horse', stored)).toBe(true);
    expect(verifyPassword('wrong', stored)).toBe(false);
  });

  it('rejects malformed stored values', () => {
    expect(verifyPassword('x', 'plain-text')).toBe(false);
    expect(verifyPassword('x', 'scrypt::')).toBe(false);
  });
});

describe('TokenService', () => {
  const user = { id: 'u1', orgId: 'o1', role: 'SUPERVISOR' as const };
  const withSecret = (secret: string | undefined) => {
    const before = process.env.JWT_SECRET;
    if (secret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = secret;
    try {
      return new TokenService();
    } finally {
      if (before === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = before;
    }
  };
  const tokens = withSecret('a'.repeat(48));

  it('round-trips a user', () => {
    expect(tokens.verify(tokens.sign(user).token)).toEqual(user);
  });

  it('rejects an expired token', () => {
    const { token } = tokens.sign(user, new Date('2026-01-01T00:00:00Z'));
    expect(tokens.verify(token, new Date('2026-01-01T11:59:00Z'))).toEqual(user);
    expect(tokens.verify(token, new Date('2026-01-01T12:00:01Z'))).toBeNull();
  });

  it('rejects a tampered payload and a token signed with another secret', () => {
    const { token } = tokens.sign(user);
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'u1', org: 'o1', role: 'ADMIN', exp: 9999999999 })).toString('base64url');
    expect(tokens.verify(`${header}.${forged}.${signature}`)).toBeNull();
    expect(withSecret('b'.repeat(48)).verify(token)).toBeNull();
  });

  it('rejects junk and unsigned tokens', () => {
    expect(tokens.verify('')).toBeNull();
    expect(tokens.verify('a.b.c')).toBeNull();
    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'u1', org: 'o1', role: 'ADMIN', exp: 9999999999 })).toString('base64url');
    expect(tokens.verify(`${none}.${payload}.`)).toBeNull();
  });

  it('refuses to start without a long enough secret', () => {
    expect(() => withSecret(undefined)).toThrow('JWT_SECRET');
    expect(() => withSecret('short')).toThrow('JWT_SECRET');
  });
});
