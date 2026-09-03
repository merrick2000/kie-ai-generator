/**
 * Account storage.
 *
 * Backed by SQLite or Postgres through `lib/db`. Repository functions only,
 * so the auth layer never writes SQL.
 */

import 'server-only'

import { randomBytes } from 'node:crypto'

import { getDb } from '@/lib/db'
import type { DatabaseClient } from '@/lib/db'
import { importLegacyJson } from './legacy-import'

export interface UserRecord {
  id: string
  email: string
  passwordHash: string
  /** Kie.ai key, encrypted at rest. Null until the user configures one. */
  apiKeyEnc: string | null
  createdAt: number
  lastLoginAt: number | null
}

export interface SessionRecord {
  tokenHash: string
  userId: string
  createdAt: number
  expiresAt: number
}

/** Column names differ from the field names, so rows are mapped explicitly. */
interface UserRow {
  id: string
  email: string
  password_hash: string
  api_key_enc: string | null
  created_at: number | string
  last_login_at: number | string | null
}

/**
 * Postgres returns BIGINT as a string to avoid precision loss in JS. Epoch
 * milliseconds are far below Number.MAX_SAFE_INTEGER, so converting is safe.
 */
function toNumber(value: number | string | null): number | null {
  if (value === null) return null
  return typeof value === 'number' ? value : Number(value)
}

function toUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    apiKeyEnc: row.api_key_enc,
    createdAt: toNumber(row.created_at) ?? 0,
    lastLoginAt: toNumber(row.last_login_at),
  }
}

export function newId(): string {
  return randomBytes(12).toString('base64url')
}

/** Ready database, with any legacy JSON accounts imported once. */
async function db(): Promise<DatabaseClient> {
  const client = await getDb()
  await importLegacyJson(client)
  return client
}

/* ────────────────────────────────────────────────────────────────────────────
 * Users
 * ──────────────────────────────────────────────────────────────────────────*/

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const row = await (await db()).get<UserRow>(
    'SELECT * FROM users WHERE email = ?',
    [email],
  )
  return row ? toUser(row) : null
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  const row = await (await db()).get<UserRow>('SELECT * FROM users WHERE id = ?', [id])
  return row ? toUser(row) : null
}

/**
 * Insert a user, or report the email as taken.
 *
 * The uniqueness check and the insert share one transaction, so two
 * simultaneous signups for the same address cannot both succeed. The unique
 * index is the real guarantee; this only turns the violation into a message.
 */
export async function createUser(
  user: Omit<UserRecord, 'id'> & { id?: string },
): Promise<{ ok: true; user: UserRecord } | { ok: false; reason: 'email_taken' }> {
  const client = await db()
  const record: UserRecord = { ...user, id: user.id ?? newId() }

  return client.transaction(async (tx) => {
    const existing = await tx.get<{ id: string }>(
      'SELECT id FROM users WHERE email = ?',
      [record.email],
    )
    if (existing) return { ok: false as const, reason: 'email_taken' as const }

    await tx.run(
      `INSERT INTO users (id, email, password_hash, api_key_enc, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.email,
        record.passwordHash,
        record.apiKeyEnc,
        record.createdAt,
        record.lastLoginAt,
      ],
    )

    return { ok: true as const, user: record }
  })
}

export async function touchLastLogin(userId: string): Promise<void> {
  await (await db()).run('UPDATE users SET last_login_at = ? WHERE id = ?', [
    Date.now(),
    userId,
  ])
}

export async function updateApiKey(
  userId: string,
  apiKeyEnc: string | null,
): Promise<void> {
  await (await db()).run('UPDATE users SET api_key_enc = ? WHERE id = ?', [
    apiKeyEnc,
    userId,
  ])
}

export async function updatePasswordHash(
  userId: string,
  passwordHash: string,
): Promise<void> {
  await (await db()).run('UPDATE users SET password_hash = ? WHERE id = ?', [
    passwordHash,
    userId,
  ])
}

export async function countUsers(): Promise<number> {
  const row = await (await db()).get<{ count: number | string }>(
    'SELECT COUNT(*) AS count FROM users',
  )
  return Number(row?.count ?? 0)
}

/* ────────────────────────────────────────────────────────────────────────────
 * Sessions
 * ──────────────────────────────────────────────────────────────────────────*/

export async function createSession(session: SessionRecord): Promise<void> {
  const client = await db()

  await client.transaction(async (tx) => {
    // Sweep expired rows on write so the table cannot grow without bound.
    await tx.run('DELETE FROM sessions WHERE expires_at <= ?', [Date.now()])
    await tx.run(
      `INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
       VALUES (?, ?, ?, ?)`,
      [session.tokenHash, session.userId, session.createdAt, session.expiresAt],
    )
  })
}

/**
 * Resolve a session to its user.
 *
 * Looked up by the token's digest rather than scanned, so this stays a single
 * primary-key hit no matter how many sessions exist.
 */
export async function findUserBySessionToken(
  tokenHash: string,
): Promise<UserRecord | null> {
  const row = await (await db()).get<UserRow>(
    `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`,
    [tokenHash, Date.now()],
  )
  return row ? toUser(row) : null
}

export async function deleteSession(tokenHash: string): Promise<void> {
  await (await db()).run('DELETE FROM sessions WHERE token_hash = ?', [tokenHash])
}

export async function deleteSessionsForUser(userId: string): Promise<void> {
  await (await db()).run('DELETE FROM sessions WHERE user_id = ?', [userId])
}

/* ────────────────────────────────────────────────────────────────────────────
 * Settings
 * ──────────────────────────────────────────────────────────────────────────*/

export async function readSetting(name: string): Promise<string | null> {
  const row = await (await db()).get<{ value: string }>(
    'SELECT value FROM app_settings WHERE name = ?',
    [name],
  )
  return row?.value ?? null
}

/**
 * Write a setting only if absent, returning whichever value ends up stored.
 *
 * Used for the generated encryption secret: if two requests race on first
 * boot, both must end up with the same secret or one of them would encrypt
 * keys that the other cannot read.
 */
export async function readOrCreateSetting(
  name: string,
  create: () => string,
): Promise<string> {
  const client = await db()

  return client.transaction(async (tx) => {
    const existing = await tx.get<{ value: string }>(
      'SELECT value FROM app_settings WHERE name = ?',
      [name],
    )
    if (existing) return existing.value

    const value = create()
    await tx.run(
      'INSERT INTO app_settings (name, value, created_at) VALUES (?, ?, ?)',
      [name, value, Date.now()],
    )
    return value
  })
}

/* ────────────────────────────────────────────────────────────────────────────
 * Encryption secret
 * ──────────────────────────────────────────────────────────────────────────*/

const SECRET_SETTING = 'api_key_encryption_secret'

let cachedSecret: string | null = null

/**
 * Secret used to encrypt stored API keys.
 *
 * APP_SECRET wins. Otherwise one is generated and kept in the database, so it
 * travels with a backup or a migration instead of being stranded on a disk.
 * Setting APP_SECRET explicitly is still preferable: it can be rotated, and it
 * keeps the secret out of the same store as the data it protects.
 */
export async function encryptionSecret(): Promise<string> {
  if (cachedSecret) return cachedSecret

  const fromEnv = process.env.APP_SECRET?.trim()
  if (fromEnv && fromEnv.length >= 16) {
    cachedSecret = fromEnv
    return cachedSecret
  }

  cachedSecret = await readOrCreateSetting(SECRET_SETTING, () =>
    randomBytes(32).toString('base64url'),
  )
  return cachedSecret
}

/** True when the secret came from the environment rather than being generated. */
export function secretFromEnv(): boolean {
  const fromEnv = process.env.APP_SECRET?.trim()
  return Boolean(fromEnv && fromEnv.length >= 16)
}
