/**
 * Cookie value encryption.
 *
 * Kept free of next/headers so it can be exercised on its own: a bug here
 * silently locks every user out of their stored key.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const PREFIX = 'v1:'

/**
 * Derive a 32-byte key from the configured secret.
 *
 * A fixed salt is fine here: the secret is expected to be high-entropy random
 * material, so this derivation exists to reach the right key length rather
 * than to harden a low-entropy password.
 */
export function deriveKey(secret: string | undefined): Buffer | null {
  const raw = secret?.trim()
  if (!raw || raw.length < 16) return null
  return scryptSync(raw, 'highfield-session', 32)
}

/** Encrypt, or pass the value through unchanged when no secret is set. */
export function encryptValue(plain: string, key: Buffer | null): string {
  if (!key) return plain

  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return [
    `${PREFIX}${iv.toString('base64url')}`,
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

/**
 * Decrypt a stored value.
 *
 * Returns null when the value cannot be trusted (wrong secret, tampering, or
 * an encrypted value with no secret available), so callers treat it as "no
 * key stored" instead of surfacing a crash.
 */
export function decryptValue(stored: string, key: Buffer | null): string | null {
  if (!stored.startsWith(PREFIX)) {
    // Written before a secret was configured.
    return stored
  }
  if (!key) return null

  const [ivPart, tagPart, dataPart] = stored.slice(PREFIX.length).split('.')
  if (!ivPart || !tagPart || !dataPart) return null

  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    return null
  }
}

/**
 * Shape a key for display: enough to recognise which key is in use, never
 * enough to reconstruct it.
 */
export function maskKey(key: string): string {
  if (key.length <= 8) return '••••'
  return `${key.slice(0, 4)}${'•'.repeat(6)}${key.slice(-4)}`
}
