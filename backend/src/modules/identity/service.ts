import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import type { Sql } from '../../db/client.js';
import { AppError } from '../../shared/errors.js';
import { identityRepo, type UserRow } from './repo.js';
import { newRefreshToken, sha256, signAccessToken, type AuthConfig, type Role } from './tokens.js';

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface Session {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: PublicUser;
}

export const MIN_PASSWORD_LENGTH = 8;

const toPublic = (u: UserRow): PublicUser => ({ id: u.id, name: u.name, email: u.email, role: u.role });
const invalidCredentials = () => new AppError('INVALID_CREDENTIALS', 'Email atau password salah', 401);
const invalidSession = () => new AppError('INVALID_SESSION', 'Sesi tidak valid, silakan login kembali', 401);

// Verified when the email does not exist, so both cases take about the same time.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= argon2.hash('dummy-password-for-timing'));

export function identityService(sql: Sql, cfg: AuthConfig) {
  const repo = identityRepo(sql);

  async function issueSession(user: UserRow, familyId: string = randomUUID()): Promise<Session> {
    const refreshToken = newRefreshToken();
    const refreshExpiresAt = new Date(Date.now() + cfg.refreshTtlDays * 86_400_000);
    await repo.insertRefresh({ userId: user.id, tokenHash: sha256(refreshToken), familyId, expiresAt: refreshExpiresAt });
    return {
      accessToken: await signAccessToken({ id: user.id, role: user.role }, cfg),
      expiresIn: cfg.accessTtlSec,
      refreshToken,
      refreshExpiresAt,
      user: toPublic(user),
    };
  }

  return {
    async createUser(input: { email: string; name: string; role: Role; password: string }): Promise<PublicUser> {
      if (input.password.length < MIN_PASSWORD_LENGTH) {
        throw new AppError('WEAK_PASSWORD', `Password minimal ${MIN_PASSWORD_LENGTH} karakter`, 400);
      }
      const email = input.email.trim().toLowerCase();
      if (await repo.findUserByEmail(email)) throw new AppError('EMAIL_TAKEN', 'Email sudah terdaftar', 409);
      const user = await repo.insertUser({
        email,
        name: input.name.trim(),
        role: input.role,
        passwordHash: await argon2.hash(input.password),
      });
      return toPublic(user);
    },

    async resetPassword(email: string, password: string): Promise<void> {
      if (password.length < MIN_PASSWORD_LENGTH) {
        throw new AppError('WEAK_PASSWORD', `Password minimal ${MIN_PASSWORD_LENGTH} karakter`, 400);
      }
      const user = await repo.findUserByEmail(email.trim().toLowerCase());
      if (!user) throw new AppError('USER_NOT_FOUND', 'User tidak ditemukan', 404);
      await repo.setPassword(user.id, await argon2.hash(password));
      await repo.revokeAllForUser(user.id); // force re-login everywhere
    },

    async login(email: string, password: string): Promise<Session> {
      const user = await repo.findUserByEmail(email.trim().toLowerCase());
      if (!user || !user.isActive) {
        await argon2.verify(await getDummyHash(), password);
        throw invalidCredentials();
      }
      if (!(await argon2.verify(user.passwordHash, password))) throw invalidCredentials();
      await repo.touchLastLogin(user.id);
      return issueSession(user);
    },

    /** Rotates the refresh token. Re-using an already rotated token revokes the whole session family. */
    async refresh(refreshToken: string): Promise<Session> {
      const row = await repo.findRefreshByHash(sha256(refreshToken));
      if (!row) throw invalidSession();
      if (row.revokedAt) {
        await repo.revokeFamily(row.familyId);
        throw invalidSession();
      }
      if (row.expiresAt.getTime() <= Date.now()) throw invalidSession();

      const user = await repo.findUserById(row.userId);
      if (!user || !user.isActive) {
        await repo.revokeFamily(row.familyId);
        throw invalidSession();
      }
      // Claim the old token first so two parallel refreshes cannot both succeed.
      if (!(await repo.revokeRefresh(row.id))) {
        await repo.revokeFamily(row.familyId);
        throw invalidSession();
      }
      return issueSession(user, row.familyId);
    },

    async logout(refreshToken: string | undefined): Promise<void> {
      if (!refreshToken) return;
      const row = await repo.findRefreshByHash(sha256(refreshToken));
      if (row) await repo.revokeFamily(row.familyId);
    },

    async me(userId: string): Promise<PublicUser> {
      const user = await repo.findUserById(userId);
      if (!user || !user.isActive) throw invalidSession();
      return toPublic(user);
    },
  };
}

export type IdentityService = ReturnType<typeof identityService>;
