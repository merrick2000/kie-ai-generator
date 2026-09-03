/**
 * Authentication.
 *
 * Sessions are opaque random tokens in an httpOnly cookie. Only a SHA-256
 * digest of each token is persisted, so a leaked database cannot be replayed
 * as a set of live sessions.
 */

import 'server-only'

import { createHash, randomBytes } from 'node:crypto'

import { cookies } from 'next/headers'

import { decryptValue, deriveKey, encryptValue } from '@/lib/kie/session-crypto'
import { createLogger } from '@/lib/logger'
import {
  hashPassword,
  normalizeEmail,
  validateEmail,
  validatePassword,
  verifyPassword,
} from './passwords'
import {
  countUsers,
  createSession,
  createUser,
  deleteSession,
  encryptionSecret,
  findUserByEmail,
  findUserBySessionToken,
  newId,
  touchLastLogin,
  updateApiKey,
  updatePasswordHash,
  type UserRecord,
} from './store'

const log = createLogger('auth')

const COOKIE_NAME = 'hf_session'
const SESSION_DAYS = 30
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000

/** What the app is allowed to know about the signed-in user. */
export interface CurrentUser {
  id: string
  email: string
  hasApiKey: boolean
  createdAt: number
}

export type AuthResult =
  | { ok: true; user: CurrentUser }
  | { ok: false; error: string; field?: 'email' | 'password' }

function publicUser(user: UserRecord): CurrentUser {
  return {
    id: user.id,
    email: user.email,
    hasApiKey: Boolean(user.apiKeyEnc),
    createdAt: user.createdAt,
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/* ────────────────────────────────────────────────────────────────────────────
 * Session cookie
 * ──────────────────────────────────────────────────────────────────────────*/

async function issueSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString('base64url')
  const now = Date.now()

  await createSession({
    tokenHash: hashToken(token),
    userId,
    createdAt: now,
    expiresAt: now + SESSION_MS,
  })

  const store = await cookies()
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  })
}

/** The signed-in user for this request, or null. */
export async function currentUser(): Promise<CurrentUser | null> {
  const record = await currentUserRecord()
  return record ? publicUser(record) : null
}

/** Internal variant that keeps the encrypted API key. */
async function currentUserRecord(): Promise<UserRecord | null> {
  const store = await cookies()
  const token = store.get(COOKIE_NAME)?.value
  if (!token) return null

  // Looked up by digest, so this is a primary-key hit. The token is random
  // 256-bit material rather than a guessable secret, and it is never compared
  // against a stored plaintext, so no constant-time compare is needed here.
  return findUserBySessionToken(hashToken(token))
}

export async function signOut(): Promise<void> {
  const store = await cookies()
  const token = store.get(COOKIE_NAME)?.value

  if (token) await deleteSession(hashToken(token))

  store.delete(COOKIE_NAME)
}

/* ────────────────────────────────────────────────────────────────────────────
 * Sign up / sign in
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * Whether a new account may be created.
 *
 * A deployed instance is reachable by anyone who knows the URL, so signups can
 * be closed once the intended users have accounts. The first account is always
 * allowed, otherwise a closed instance could never be bootstrapped.
 */
export async function signupsAllowed(): Promise<boolean> {
  if (process.env.SIGNUPS_ENABLED?.trim().toLowerCase() !== 'false') return true
  return (await countUsers()) === 0
}

export async function signUp(
  emailInput: string,
  password: string,
): Promise<AuthResult> {
  if (!(await signupsAllowed())) {
    return {
      ok: false,
      error: 'Sign-ups are closed on this instance. Ask an administrator for access.',
    }
  }

  const emailError = validateEmail(emailInput)
  if (emailError) return { ok: false, error: emailError, field: 'email' }

  const passwordError = validatePassword(password)
  if (passwordError) return { ok: false, error: passwordError, field: 'password' }

  const email = normalizeEmail(emailInput)
  const passwordHash = await hashPassword(password)

  const created = await createUser({
    id: newId(),
    email,
    passwordHash,
    apiKeyEnc: null,
    createdAt: Date.now(),
    lastLoginAt: Date.now(),
  })

  if (!created.ok) {
    log.info('signup rejected, email already registered', { email })
    return {
      ok: false,
      error: 'An account already exists for this email. Sign in instead.',
      field: 'email',
    }
  }

  await issueSession(created.user.id)
  log.info('account created', { userId: created.user.id, email })
  return { ok: true, user: publicUser(created.user) }
}

export async function signIn(
  emailInput: string,
  password: string,
): Promise<AuthResult> {
  const email = normalizeEmail(emailInput)
  const user = await findUserByEmail(email)

  // Same message and comparable work either way, so this cannot be used to
  // enumerate which emails have accounts.
  const valid = user
    ? await verifyPassword(password, user.passwordHash)
    : await verifyPassword(password, 'scrypt$65536$8$1$aaaa$bbbb')

  if (!user || !valid) {
    // Logged at warn: a burst of these is the signal for credential stuffing.
    log.warn('failed sign-in', { email, reason: user ? 'bad password' : 'unknown email' })
    return { ok: false, error: 'Incorrect email or password.' }
  }

  await touchLastLogin(user.id)
  await issueSession(user.id)
  log.info('signed in', { userId: user.id, email })
  return { ok: true, user: publicUser(user) }
}

/* ────────────────────────────────────────────────────────────────────────────
 * The user's Kie.ai key
 * ──────────────────────────────────────────────────────────────────────────*/

/** Decrypted Kie.ai key for the signed-in user, or null. */
export async function currentApiKey(): Promise<string | null> {
  const user = await currentUserRecord()
  if (!user?.apiKeyEnc) return null

  const key = deriveKey(await encryptionSecret())
  return decryptValue(user.apiKeyEnc, key)?.trim() || null
}

export async function setApiKey(value: string): Promise<boolean> {
  const user = await currentUserRecord()
  if (!user) return false

  const sealed = encryptValue(value.trim(), deriveKey(await encryptionSecret()))
  await updateApiKey(user.id, sealed)
  // The key itself is never logged, only that one was set.
  log.info('api key set', { userId: user.id })
  return true
}

export async function clearApiKey(): Promise<boolean> {
  const user = await currentUserRecord()
  if (!user) return false

  await updateApiKey(user.id, null)
  log.info('api key removed', { userId: user.id })
  return true
}

export async function changePassword(
  currentPassword: string,
  nextPassword: string,
): Promise<AuthResult> {
  const user = await currentUserRecord()
  if (!user) return { ok: false, error: 'Not signed in.' }

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    return { ok: false, error: 'Current password is incorrect.', field: 'password' }
  }

  const problem = validatePassword(nextPassword)
  if (problem) return { ok: false, error: problem, field: 'password' }

  const passwordHash = await hashPassword(nextPassword)
  await updatePasswordHash(user.id, passwordHash)

  return { ok: true, user: publicUser(user) }
}

/** Number of accounts on this instance, shown in settings. */
export { countUsers }
