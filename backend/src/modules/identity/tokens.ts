import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

export type Role = 'admin' | 'viewer';

export interface AuthUser {
  id: string;
  role: Role;
}

export interface AuthConfig {
  jwtSecret: string;
  accessTtlSec: number;
  refreshTtlDays: number;
  cookieSecure: boolean;
}

const ISSUER = 'baruna-api';
const AUDIENCE = 'baruna-dashboard';
const key = (secret: string) => new TextEncoder().encode(secret);

export async function signAccessToken(user: AuthUser, cfg: AuthConfig): Promise<string> {
  return new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${cfg.accessTtlSec}s`)
    .sign(key(cfg.jwtSecret));
}

/** Throws when the token is invalid, expired, or not issued by this api. */
export async function verifyAccessToken(token: string, cfg: Pick<AuthConfig, 'jwtSecret'>): Promise<AuthUser> {
  const { payload } = await jwtVerify(token, key(cfg.jwtSecret), {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ['HS256'],
  });
  if (typeof payload.sub !== 'string' || (payload.role !== 'admin' && payload.role !== 'viewer')) {
    throw new Error('invalid claims');
  }
  return { id: payload.sub, role: payload.role };
}

/** Opaque refresh token; only its SHA-256 hash is stored. */
export const newRefreshToken = (): string => randomBytes(32).toString('base64url');
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
