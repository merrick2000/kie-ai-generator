/**
 * Logging, with the emphasis on what must never be written.
 *
 * This app handles Kie API keys, passwords and session tokens. A log file is
 * exactly where they should not end up, so redaction is asserted rather than
 * assumed.
 *
 *   bun --preload ./scripts/preload.ts scripts/test-logger.mts
 */

import assert from 'node:assert/strict'

import { __internal, createLogger, since } from '../src/lib/logger'

const { redact, isSecret } = __internal

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok  ${name}`)
}

console.log('redaction')

check('recognises secret-bearing key names', () => {
  for (const key of [
    'password', 'newPassword', 'passwordHash',
    'apiKey', 'api_key', 'KIE_API_KEY',
    'token', 'tokenHash', 'sessionToken',
    'secret', 'APP_SECRET', 'webhookSecret',
    'authorization', 'Authorization', 'cookie', 'signature',
  ]) {
    assert.equal(isSecret(key), true, `${key} must be treated as secret`)
  }
})

check('leaves ordinary keys alone', () => {
  for (const key of ['email', 'userId', 'model', 'status', 'ms', 'slug', 'taskId']) {
    assert.equal(isSecret(key), false, `${key} must not be redacted`)
  }
})

check('redacts a secret value anywhere in the object', () => {
  const out = redact({
    userId: 'u1',
    apiKey: 'sk-live-abcdef0123456789',
    nested: { password: 'hunter2', email: 'a@b.co' },
  }) as Record<string, unknown>

  assert.equal(out.apiKey, '[redacted]')
  assert.equal((out.nested as Record<string, unknown>).password, '[redacted]')
  // Non-secrets survive, otherwise the log would be useless.
  assert.equal(out.userId, 'u1')
  assert.equal((out.nested as Record<string, unknown>).email, 'a@b.co')

  const serialised = JSON.stringify(out)
  assert.ok(!serialised.includes('sk-live-abcdef0123456789'))
  assert.ok(!serialised.includes('hunter2'))
})

check('keeps booleans readable even under a secret-sounding name', () => {
  // `hasSignature: true` is exactly the field worth logging on a webhook, and
  // redacting it would leave the line saying nothing.
  const out = redact({ hasSignature: true, tokenPresent: false }) as Record<string, unknown>
  assert.equal(out.hasSignature, true)
  assert.equal(out.tokenPresent, false)

  // The string forms are still redacted.
  const strings = redact({ signature: 'sha256=abc', token: 'tok_live' }) as Record<string, unknown>
  assert.equal(strings.signature, '[redacted]')
  assert.equal(strings.token, '[redacted]')
})

check('truncates long strings so one prompt cannot flood a log', () => {
  const out = redact({ prompt: 'x'.repeat(5000) }) as Record<string, string>
  assert.ok(out.prompt.length < 400, `got ${out.prompt.length} chars`)
  assert.ok(out.prompt.endsWith('...'))
})

check('caps long arrays', () => {
  const out = redact({ urls: Array.from({ length: 50 }, (_, i) => `u${i}`) }) as {
    urls: unknown[]
  }
  assert.equal(out.urls.length, 11)
  assert.equal(out.urls[10], '+40 more')
})

check('stops at depth rather than serialising a whole graph', () => {
  const out = redact({ a: { b: { c: { d: { e: 'deep' } } } } }) as Record<string, unknown>
  assert.equal(JSON.stringify(out).includes('deep'), false)
})

check('renders an Error without losing the message', () => {
  const out = redact(new Error('database unreachable')) as Record<string, unknown>
  assert.equal(out.name, 'Error')
  assert.equal(out.message, 'database unreachable')
})

check('passes through null and undefined untouched', () => {
  assert.equal(redact(null), null)
  assert.equal(redact(undefined), undefined)
})

console.log('\nformat')

check('defaults to readable text, even in production', () => {
  const previousEnv = process.env.NODE_ENV
  const previousFormat = process.env.LOG_FORMAT
  const captured: string[] = []
  const realOut = process.stdout.write.bind(process.stdout)

  // @ts-expect-error NODE_ENV is readonly in the types, writable at runtime.
  process.env.NODE_ENV = 'production'
  delete process.env.LOG_FORMAT
  process.stdout.write = ((s: string) => (captured.push(s), true)) as typeof process.stdout.write

  try {
    createLogger('http').info('request', { method: 'GET', path: '/x', status: 200, ms: 5 })
  } finally {
    process.stdout.write = realOut
    // @ts-expect-error restoring the runtime value
    process.env.NODE_ENV = previousEnv
    if (previousFormat) process.env.LOG_FORMAT = previousFormat
  }

  // JSON is unreadable in a plain-text log panel, which is what most
  // self-hosted deployments give you.
  assert.ok(!captured[0].trim().startsWith('{'), 'must not default to JSON')
  assert.ok(captured[0].includes('/x'))
})

check('emits JSON when asked for it', () => {
  const previous = process.env.LOG_FORMAT
  const captured: string[] = []
  const realOut = process.stdout.write.bind(process.stdout)

  process.env.LOG_FORMAT = 'json'
  process.stdout.write = ((s: string) => (captured.push(s), true)) as typeof process.stdout.write

  try {
    createLogger('kie').info('submitted', { taskId: 't_1' })
  } finally {
    process.stdout.write = realOut
    if (previous) process.env.LOG_FORMAT = previous
    else delete process.env.LOG_FORMAT
  }

  const parsed = JSON.parse(captured[0])
  assert.equal(parsed.scope, 'kie')
  assert.equal(parsed.msg, 'submitted')
  assert.equal(parsed.taskId, 't_1')
  // No ANSI in structured output, or the collector chokes on it.
  assert.ok(!captured[0].includes('\x1b'))
})

console.log('\noutput')

check('writes to stdout for info and stderr for errors', () => {
  const log = createLogger('test')
  const captured: { out: string[]; err: string[] } = { out: [], err: [] }

  const realOut = process.stdout.write.bind(process.stdout)
  const realErr = process.stderr.write.bind(process.stderr)
  process.stdout.write = ((s: string) => (captured.out.push(s), true)) as typeof process.stdout.write
  process.stderr.write = ((s: string) => (captured.err.push(s), true)) as typeof process.stderr.write

  try {
    log.info('hello', { userId: 'u1' })
    log.error('boom', { apiKey: 'sk-secret-value-here' })
  } finally {
    process.stdout.write = realOut
    process.stderr.write = realErr
  }

  assert.equal(captured.out.length, 1)
  assert.equal(captured.err.length, 1)
  assert.ok(captured.out[0].includes('hello'))
  assert.ok(captured.out[0].includes('u1'))
  // The whole point: the key never reaches the stream.
  assert.ok(!captured.err[0].includes('sk-secret-value-here'))
  assert.ok(captured.err[0].includes('[redacted]'))
})

check('omits fields that were never set, keeps explicit nulls', () => {
  const captured: string[] = []
  const realOut = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((s: string) => (captured.push(s), true)) as typeof process.stdout.write

  try {
    createLogger('test').info('received', {
      event: undefined,
      timestamp: null,
      bytes: 2,
    })
  } finally {
    process.stdout.write = realOut
  }

  const line = captured[0]
  assert.ok(!line.includes('event='), 'an unset field is noise')
  // null is the diagnosis: the header was looked for and was not there.
  assert.ok(line.includes('timestamp=null'))
  assert.ok(line.includes('bytes=2'))
})

check('a child logger carries its context onto every line', () => {
  const captured: string[] = []
  const realOut = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((s: string) => (captured.push(s), true)) as typeof process.stdout.write

  try {
    createLogger('test').child({ id: 'req-1' }).info('done')
  } finally {
    process.stdout.write = realOut
  }

  assert.ok(captured[0].includes('req-1'))
})

check('since() measures elapsed time', () => {
  assert.ok(since(Date.now() - 50) >= 50)
})

console.log(`\n${passed} passed`)
