/**
 * Password hashing.
 *
 * scrypt from node:crypto: memory-hard, in the standard library, and no native
 * build step. Parameters are recorded alongside each hash so they can be
 * raised later without invalidating existing accounts.
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>

/** OWASP's floor for scrypt. Roughly 64MB and ~100ms per hash. */
const PARAMS = { N: 2 ** 16, r: 8, p: 1 } as const
const KEY_LENGTH = 64
const SALT_BYTES = 16

/** scrypt needs headroom above 128 * N * r bytes. */
const MAX_MEM = 128 * PARAMS.N * PARAMS.r * 2

export const MIN_PASSWORD_LENGTH = 8

/** Encoded as `scrypt$N$r$p$salt$hash`, both parts base64url. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const derived = await scryptAsync(password, salt, KEY_LENGTH, {
    ...PARAMS,
    maxmem: MAX_MEM,
  })

  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$')
}

/**
 * Verify a password against a stored hash.
 *
 * Never throws on a malformed hash: a corrupt record should fail the login,
 * not crash the request.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false

  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts
  const N = Number(nRaw)
  const r = Number(rRaw)
  const p = Number(pRaw)

  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false
  }
  // Refuse absurd parameters from a tampered record rather than trying to
  // allocate gigabytes to satisfy them.
  if (N > 2 ** 20 || r > 32 || p > 16) return false

  try {
    const salt = Buffer.from(saltRaw, 'base64url')
    const expected = Buffer.from(hashRaw, 'base64url')
    const derived = await scryptAsync(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: 128 * N * r * 2,
    })

    return derived.length === expected.length && timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}

/** Returns a problem to show the user, or null when the password is usable. */
export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  if (password.length > 200) {
    return 'That password is too long.'
  }
  return null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function validateEmail(email: string): string | null {
  const value = normalizeEmail(email)
  if (!value) return 'Enter your email address.'
  if (value.length > 254 || !EMAIL_RE.test(value)) {
    return 'Enter a valid email address.'
  }
  return null
}
