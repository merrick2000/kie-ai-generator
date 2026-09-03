/**
 * Upload behaviour against a stand-in for Kie's file API.
 *
 * The two documented response shapes disagree, and the endpoint has moved
 * hosts, so both are exercised here rather than trusted.
 *
 *   bun --preload ./scripts/preload.ts scripts/test-upload.mts
 */

import assert from 'node:assert/strict'

let passed = 0
async function check(name: string, fn: () => Promise<void>) {
  await fn()
  passed++
  console.log(`  ok  ${name}`)
}

/** Mirrors publicUrlFrom in lib/kie/client.ts. */
function publicUrlFrom(data: Record<string, unknown>): string | null {
  for (const candidate of [data.downloadUrl, data.fileUrl, data.filePath]) {
    if (typeof candidate === 'string' && /^https?:\/\//.test(candidate)) return candidate
  }
  return null
}

console.log('response shapes')

await check('accepts the reference-page shape (downloadUrl)', async () => {
  const data = {
    fileName: 'a.png',
    filePath: 'images/a.png',
    downloadUrl: 'https://tempfile.aiquickdraw.com/s/a.png',
    fileSize: 1024,
    mimeType: 'image/png',
    uploadedAt: '2026-01-01T00:00:00Z',
  }
  assert.equal(publicUrlFrom(data), 'https://tempfile.aiquickdraw.com/s/a.png')
})

await check('accepts the quickstart shape (fileUrl)', async () => {
  const data = {
    fileId: 'file_1',
    fileName: 'a.png',
    fileUrl: 'https://kieai.redpandaai.co/files/images/a.png',
    downloadUrl: undefined,
  }
  assert.equal(publicUrlFrom(data), 'https://kieai.redpandaai.co/files/images/a.png')
})

await check('prefers downloadUrl when both are present', async () => {
  assert.equal(
    publicUrlFrom({ downloadUrl: 'https://a.test/x', fileUrl: 'https://b.test/x' }),
    'https://a.test/x',
  )
})

await check('rejects a relative filePath rather than passing it to a model', async () => {
  // A model given "images/a.png" would fail with an unhelpful error, so this
  // must be treated as no usable URL.
  assert.equal(publicUrlFrom({ filePath: 'images/a.png' }), null)
})

await check('accepts filePath when it is already absolute', async () => {
  assert.equal(publicUrlFrom({ filePath: 'https://c.test/a.png' }), 'https://c.test/a.png')
})

await check('returns null on an empty payload', async () => {
  assert.equal(publicUrlFrom({}), null)
})

console.log('\nhost failover')

// A tiny server that 404s the first path and succeeds on the second, standing
// in for an endpoint that has moved.
const { serve } = await import('bun')

let hitsPrimary = 0
let hitsFallback = 0

const primary = serve({
  port: 0,
  fetch() {
    hitsPrimary++
    return new Response('not found', { status: 404 })
  },
})

const fallback = serve({
  port: 0,
  async fetch(req) {
    hitsFallback++
    const auth = req.headers.get('authorization')
    return Response.json({
      code: auth === 'Bearer test-key' ? 200 : 401,
      msg: auth === 'Bearer test-key' ? 'ok' : 'bad key',
      data: { fileName: 'a.png', downloadUrl: 'https://cdn.test/a.png', fileSize: 10 },
    })
  },
})

await check('falls through a 404 to the next host', async () => {
  const hosts = [`http://localhost:${primary.port}`, `http://localhost:${fallback.port}`]
  let url: string | null = null

  for (const host of hosts) {
    const res = await fetch(`${host}/api/file-stream-upload`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-key' },
      body: 'x',
    })
    if (res.status === 404 || res.status === 405) continue
    const payload = (await res.json()) as { code: number; data: Record<string, unknown> }
    if (payload.code === 200) url = publicUrlFrom(payload.data)
    break
  }

  assert.equal(hitsPrimary, 1, 'primary host must be tried first')
  assert.equal(hitsFallback, 1, 'fallback must be tried after a 404')
  assert.equal(url, 'https://cdn.test/a.png')
})

primary.stop(true)
fallback.stop(true)

console.log(`\n${passed} passed`)
