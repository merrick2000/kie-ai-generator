/**
 * One-time import of the previous JSON store.
 *
 * Earlier builds kept accounts in `.data/highfield.json`. Anyone who signed up
 * then would otherwise find their account gone after the move to a database,
 * so the file is drained into the tables on first boot and renamed.
 *
 * This can be deleted once no deployment still holds a JSON file.
 */

import 'server-only'

import { readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'

import type { DatabaseClient } from '@/lib/db'

interface LegacyUser {
  id?: string
  email?: string
  passwordHash?: string
  apiKeyEnc?: string | null
  createdAt?: number
  lastLoginAt?: number | null
}

interface LegacyDb {
  users?: LegacyUser[]
}

function legacyPath(): string {
  const dir = process.env.HIGHFIELD_DATA_DIR?.trim() || join(process.cwd(), '.data')
  return join(dir, 'highfield.json')
}

/** Import runs at most once per process, and is a no-op without a file. */
let done = false

export async function importLegacyJson(db: DatabaseClient): Promise<void> {
  if (done) return
  done = true

  const path = legacyPath()

  let parsed: LegacyDb
  try {
    parsed = JSON.parse(await readFile(path, 'utf8')) as LegacyDb
  } catch {
    // No legacy file, which is the normal case.
    return
  }

  const users = (parsed.users ?? []).filter(
    (u): u is LegacyUser & { id: string; email: string; passwordHash: string } =>
      Boolean(u.id && u.email && u.passwordHash),
  )

  if (users.length) {
    await db.transaction(async (tx) => {
      for (const user of users) {
        // Skip anyone already present so a partially-completed import can be
        // safely repeated.
        const existing = await tx.get<{ id: string }>(
          'SELECT id FROM users WHERE email = ? OR id = ?',
          [user.email, user.id],
        )
        if (existing) continue

        await tx.run(
          `INSERT INTO users (id, email, password_hash, api_key_enc, created_at, last_login_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            user.id,
            user.email,
            user.passwordHash,
            user.apiKeyEnc ?? null,
            user.createdAt ?? Date.now(),
            user.lastLoginAt ?? null,
          ],
        )
      }
    })
  }

  // Sessions are deliberately not carried over: they are cheap to re-establish
  // and everyone signing in again is the safer outcome of a storage change.
  await rename(path, `${path}.imported`).catch(() => {})

  console.log(
    `[auth] imported ${users.length} account(s) from the legacy JSON store`,
  )
}
