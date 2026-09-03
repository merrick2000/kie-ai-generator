/**
 * Password hashing checks.
 *
 * Run with: node scripts/test-auth.ts
 */

import assert from 'node:assert/strict'

import {
  hashPassword,
  normalizeEmail,
  validateEmail,
  validatePassword,
  verifyPassword,
} from '../src/lib/auth/passwords'

let passed = 0
async function check(name: string, fn: () => Promise<void> | void) {
  await fn()
  passed++
  console.log(`  ok  ${name}`)
}

console.log('passwords')

await check('accepts the correct password', async () => {
  const hash = await hashPassword('correct horse battery')
  assert.equal(await verifyPassword('correct horse battery', hash), true)
})

await check('rejects a wrong password', async () => {
  const hash = await hashPassword('correct horse battery')
  assert.equal(await verifyPassword('correct horse batteryy', hash), false)
  assert.equal(await verifyPassword('', hash), false)
})

await check('salts, so equal passwords differ on disk', async () => {
  assert.notEqual(await hashPassword('same-password'), await hashPassword('same-password'))
})

await check('never stores the password itself', async () => {
  const hash = await hashPassword('my-secret-password')
  assert.ok(!hash.includes('my-secret-password'))
  assert.ok(hash.startsWith('scrypt$'))
})

await check('fails closed on a malformed hash', async () => {
  for (const bad of ['', 'nonsense', 'scrypt$only$three', 'bcrypt$1$2$3$4$5']) {
    assert.equal(await verifyPassword('anything', bad), false)
  }
})

await check('refuses absurd parameters from a tampered record', async () => {
  // Would otherwise try to allocate an enormous amount of memory.
  assert.equal(await verifyPassword('x', 'scrypt$99999999$8$1$aaaa$bbbb'), false)
})

console.log('\nvalidation')

await check('enforces a minimum password length', () => {
  assert.notEqual(validatePassword('short'), null)
  assert.equal(validatePassword('long-enough-1'), null)
})

await check('normalises and validates emails', () => {
  assert.equal(normalizeEmail('  User@Example.COM '), 'user@example.com')
  assert.equal(validateEmail('user@example.com'), null)
  for (const bad of ['', 'nope', 'a@b', 'a b@c.com', '@example.com']) {
    assert.notEqual(validateEmail(bad), null)
  }
})

console.log(`\n${passed} passed`)
