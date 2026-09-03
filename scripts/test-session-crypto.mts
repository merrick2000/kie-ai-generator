/**
 * Round-trip checks for cookie encryption.
 *
 * Run with: node scripts/test-session-crypto.ts
 */

import assert from 'node:assert/strict'

import {
  decryptValue,
  deriveKey,
  encryptValue,
  maskKey,
} from '../src/lib/kie/session-crypto'

const SECRET = 'a-test-secret-of-sufficient-length-000'
const KEY = 'sk-live-abcdef0123456789abcdef0123456789'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok  ${name}`)
}

console.log('session-crypto')

check('round-trips a key with a secret', () => {
  const k = deriveKey(SECRET)
  assert.notEqual(k, null)
  const sealed = encryptValue(KEY, k)
  assert.notEqual(sealed, KEY, 'value must not be stored in the clear')
  assert.equal(decryptValue(sealed, k), KEY)
})

check('produces a different ciphertext each time', () => {
  const k = deriveKey(SECRET)
  assert.notEqual(encryptValue(KEY, k), encryptValue(KEY, k))
})

check('passes through when no secret is configured', () => {
  assert.equal(deriveKey(undefined), null)
  assert.equal(encryptValue(KEY, null), KEY)
  assert.equal(decryptValue(KEY, null), KEY)
})

check('rejects a short secret rather than weakly deriving', () => {
  assert.equal(deriveKey('too-short'), null)
})

check('returns null under the wrong secret instead of garbage', () => {
  const sealed = encryptValue(KEY, deriveKey(SECRET))
  assert.equal(decryptValue(sealed, deriveKey('a-different-secret-entirely-000')), null)
})

check('returns null when the ciphertext is tampered with', () => {
  const sealed = encryptValue(KEY, deriveKey(SECRET))
  const flipped = sealed.slice(0, -2) + (sealed.endsWith('A') ? 'B' : 'A')
  assert.equal(decryptValue(flipped, deriveKey(SECRET)), null)
})

check('returns null for an encrypted value once the secret is removed', () => {
  const sealed = encryptValue(KEY, deriveKey(SECRET))
  assert.equal(decryptValue(sealed, null), null)
})

check('survives a key written before encryption was enabled', () => {
  assert.equal(decryptValue(KEY, deriveKey(SECRET)), KEY)
})

check('masks without leaking the middle', () => {
  const masked = maskKey(KEY)
  assert.ok(masked.startsWith('sk-l'))
  assert.ok(masked.endsWith('6789'))
  assert.ok(!masked.includes('abcdef0123'))
  assert.equal(maskKey('short'), '••••')
})

console.log(`\n${passed} passed`)
