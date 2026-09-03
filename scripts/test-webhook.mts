/**
 * Article webhook checks: signature verification, payload parsing and the
 * sanitisation that stands between an external publisher and our origin.
 *
 *   node scripts/test-webhook.mts
 */

import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'

import { parseArticle, verifyWebhook } from '../src/lib/blog/webhook'
import { sanitizeArticleHtml, slugify } from '../src/lib/blog/sanitize'

const SECRET = 'whsec_test_secret_value'

let passed = 0
async function check(name: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`  ok  ${name}`)
}

const sign = (body: string, timestamp: string, secret = SECRET) =>
  'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')

const now = () => Math.floor(Date.now() / 1000).toString()

console.log('signature verification')

await check('accepts a correctly signed delivery', () => {
  const body = JSON.stringify({ event: 'article.published' })
  const ts = now()
  assert.deepEqual(verifyWebhook(body, { signature: sign(body, ts), timestamp: ts }, SECRET), {
    ok: true,
  })
})

await check('rejects a wrong secret', () => {
  const body = JSON.stringify({ event: 'article.published' })
  const ts = now()
  const result = verifyWebhook(
    body,
    { signature: sign(body, ts, 'other-secret'), timestamp: ts },
    SECRET,
  )
  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.status, 401)
})

await check('rejects a tampered body', () => {
  const body = JSON.stringify({ event: 'article.published', article: { id: '1' } })
  const ts = now()
  const signature = sign(body, ts)
  // The signature is valid for the original body, not the altered one.
  const tampered = JSON.stringify({ event: 'article.published', article: { id: '2' } })
  assert.equal(verifyWebhook(tampered, { signature, timestamp: ts }, SECRET).ok, false)
})

await check('rejects a replayed timestamp', () => {
  const body = '{}'
  // Six minutes old, past the five-minute window.
  const stale = (Math.floor(Date.now() / 1000) - 360).toString()
  const result = verifyWebhook(body, { signature: sign(body, stale), timestamp: stale }, SECRET)
  assert.equal(result.ok, false)
  assert.match(result.ok === false ? result.error : '', /window/i)
})

await check('rejects missing headers without throwing', () => {
  assert.equal(verifyWebhook('{}', { signature: null, timestamp: now() }, SECRET).ok, false)
  assert.equal(verifyWebhook('{}', { signature: 'sha256=x', timestamp: null }, SECRET).ok, false)
  assert.equal(
    verifyWebhook('{}', { signature: 'sha256=x', timestamp: 'not-a-number' }, SECRET).ok,
    false,
  )
})

await check('rejects a short signature without crashing', () => {
  // timingSafeEqual throws on length mismatch; the guard must catch it first.
  const ts = now()
  assert.equal(verifyWebhook('{}', { signature: 'sha256=ab', timestamp: ts }, SECRET).ok, false)
})

console.log('\nsanitisation')

await check('strips script tags and their contents', () => {
  const out = sanitizeArticleHtml('<p>Safe</p><script>alert(document.cookie)</script>')
  assert.ok(out.includes('Safe'))
  assert.ok(!out.includes('script'))
  assert.ok(!out.includes('alert'))
})

await check('strips event handlers', () => {
  const out = sanitizeArticleHtml('<img src="https://x.test/a.png" onerror="alert(1)">')
  assert.ok(!out.includes('onerror'))
  assert.ok(out.includes('https://x.test/a.png'))
})

await check('strips javascript: urls', () => {
  const out = sanitizeArticleHtml('<a href="javascript:alert(1)">click</a>')
  assert.ok(!out.includes('javascript:'))
})

await check('strips inline styles', () => {
  const out = sanitizeArticleHtml('<p style="position:fixed;top:0">x</p>')
  assert.ok(!out.includes('style'))
})

await check('keeps legitimate formatting', () => {
  const out = sanitizeArticleHtml(
    '<h2>Title</h2><p>Some <strong>bold</strong> and <a href="https://x.test">a link</a>.</p><ul><li>one</li></ul>',
  )
  for (const fragment of ['<h2>', '<strong>', '<li>', 'https://x.test']) {
    assert.ok(out.includes(fragment), `expected ${fragment}`)
  }
})

await check('hardens outbound links', () => {
  const out = sanitizeArticleHtml('<a href="https://x.test">link</a>')
  assert.ok(out.includes('rel="noopener noreferrer nofollow"'))
  assert.ok(out.includes('target="_blank"'))
})

await check('demotes a body h1 so the page keeps one', () => {
  assert.ok(sanitizeArticleHtml('<h1>Body title</h1>').includes('<h2>'))
})

console.log('\npayload parsing')

const validPayload = {
  event: 'article.published',
  article: {
    id: 'uuid-1',
    title: 'How to prompt video models',
    content: 'Plain text version.',
    htmlContent: '<p>Real body with <strong>markup</strong>.</p>',
    coverImageUrl: 'https://cdn.test/cover.png',
    coverImageAlt: 'A cover',
    keyword: 'video prompting',
    language: 'en',
    seo: {
      title: 'SEO title',
      description: 'SEO description',
      slug: 'how-to-prompt-video-models',
      keywords: ['prompting', 'video'],
    },
    metaDescription: 'Meta description',
  },
  project: { id: 'proj-1', name: 'Highfield' },
  timestamp: '1711234567',
}

await check('maps a full payload', () => {
  const result = parseArticle(validPayload)
  assert.ok(result.ok)
  if (!result.ok) return
  const a = result.article
  assert.equal(a.id, 'uuid-1')
  assert.equal(a.slug, 'how-to-prompt-video-models')
  assert.equal(a.seoTitle, 'SEO title')
  assert.deepEqual(a.seoKeywords, ['prompting', 'video'])
  assert.equal(a.projectName, 'Highfield')
  assert.ok(a.html.includes('<strong>'))
  assert.ok(a.readingMinutes >= 1)
})

await check('converts a seconds timestamp to milliseconds', () => {
  const result = parseArticle(validPayload)
  assert.ok(result.ok)
  if (!result.ok) return
  assert.equal(result.article.publishedAt, 1711234567000)
})

await check('prefers htmlContent over content', () => {
  const result = parseArticle(validPayload)
  assert.ok(result.ok && result.article.html.includes('Real body'))
})

await check('falls back to content as paragraphs', () => {
  const result = parseArticle({
    ...validPayload,
    article: { ...validPayload.article, htmlContent: undefined },
  })
  assert.ok(result.ok)
  if (!result.ok) return
  assert.ok(result.article.html.includes('<p>'))
  assert.ok(result.article.html.includes('Plain text version'))
})

await check('escapes html arriving through the plain-text field', () => {
  const result = parseArticle({
    ...validPayload,
    article: {
      ...validPayload.article,
      htmlContent: undefined,
      content: 'Before <script>alert(1)</script> after',
    },
  })
  assert.ok(result.ok)
  if (!result.ok) return
  assert.ok(!result.article.html.includes('<script'))
})

await check('derives a slug when none is sent', () => {
  const result = parseArticle({
    ...validPayload,
    article: { ...validPayload.article, seo: { ...validPayload.article.seo, slug: undefined } },
  })
  assert.ok(result.ok && result.article.slug === 'how-to-prompt-video-models')
})

await check('drops a non-http cover image', () => {
  const result = parseArticle({
    ...validPayload,
    article: { ...validPayload.article, coverImageUrl: 'javascript:alert(1)' },
  })
  assert.ok(result.ok && result.article.coverImageUrl === null)
})

await check('rejects payloads that cannot be published', () => {
  assert.equal(parseArticle({}).ok, false)
  assert.equal(parseArticle({ article: { title: 'No id' } }).ok, false)
  assert.equal(parseArticle({ article: { id: 'x' } }).ok, false)
  assert.equal(
    parseArticle({ article: { id: 'x', title: 'T', htmlContent: '<script>x</script>' } }).ok,
    false,
    'a body that is empty once sanitised must be refused',
  )
})

await check('slugifies accents and punctuation', () => {
  assert.equal(slugify('Événement: à «Paris»!'), 'evenement-a-paris')
})

console.log(`\n${passed} passed`)
