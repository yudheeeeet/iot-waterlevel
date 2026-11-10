import type { Sql } from '../../db/client.js';
import type { Role } from './tokens.js';

export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  passwordHash: string;
}

export interface RefreshRow {
  id: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

const userCols = (sql: Sql) =>
  sql`id, email, name, role, is_active as "isActive", password_hash as "passwordHash"`;

export const identityRepo = (sql: Sql) => ({
  async findUserByEmail(email: string): Promise<UserRow | undefined> {
    const [row] = await sql<UserRow[]>`select ${userCols(sql)} from users where email = ${email}`;
    return row;
  },

  async findUserById(id: string): Promise<UserRow | undefined> {
    const [row] = await sql<UserRow[]>`select ${userCols(sql)} from users where id = ${id}`;
    return row;
  },

  async insertUser(u: { email: string; name: string; role: Role; passwordHash: string }): Promise<UserRow> {
    const [row] = await sql<UserRow[]>`
      insert into users (email, name, role, password_hash)
      values (${u.email}, ${u.name}, ${u.role}, ${u.passwordHash})
      returning ${userCols(sql)}`;
    return row!;
  },

  async setPassword(userId: string, passwordHash: string): Promise<void> {
    await sql`update users set password_hash = ${passwordHash}, updated_at = now() where id = ${userId}`;
  },

  async touchLastLogin(userId: string): Promise<void> {
    await sql`update users set last_login_at = now() where id = ${userId}`;
  },

  async insertRefresh(r: { userId: string; tokenHash: string; familyId: string; expiresAt: Date }): Promise<string> {
    const [row] = await sql<{ id: string }[]>`
      insert into refresh_tokens (user_id, token_hash, family_id, expires_at)
      values (${r.userId}, ${r.tokenHash}, ${r.familyId}, ${r.expiresAt})
      returning id`;
    return row!.id;
  },

  async findRefreshByHash(tokenHash: string): Promise<RefreshRow | undefined> {
    const [row] = await sql<RefreshRow[]>`
      select id, user_id as "userId", family_id as "familyId", expires_at as "expiresAt", revoked_at as "revokedAt"
      from refresh_tokens where token_hash = ${tokenHash}`;
    return row;
  },

  /** Revokes one token only if it is still active; returns false if someone else already rotated it. */
  async revokeRefresh(id: string, replacedBy: string | null = null): Promise<boolean> {
    const rows = await sql`
      update refresh_tokens set revoked_at = now(), replaced_by = ${replacedBy}
      where id = ${id} and revoked_at is null returning id`;
    return rows.length === 1;
  },

  async revokeFamily(familyId: string): Promise<void> {
    await sql`update refresh_tokens set revoked_at = now() where family_id = ${familyId} and revoked_at is null`;
  },

  async revokeAllForUser(userId: string): Promise<void> {
    await sql`update refresh_tokens set revoked_at = now() where user_id = ${userId} and revoked_at is null`;
  },
});

export type IdentityRepo = ReturnType<typeof identityRepo>;
