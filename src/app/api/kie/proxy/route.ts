import { NextResponse } from 'next/server'
import { withLogging } from '@/lib/api-logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/kie/proxy?url=…
 *
 * Streams a generated asset through this origin so the browser can save it
 * with a filename. Kie's CDN does not send permissive CORS headers, which
 * makes a client-side `fetch(...).blob()` download fail.
 *
 * Restricted to known Kie/provider hosts so this cannot be used as an open
 * relay for arbitrary URLs.
 */
const ALLOWED_HOST_SUFFIXES = [
  'kie.ai',
  'redpandaai.co',
  'aiquickdraw.com',
  'tempfile.aiquickdraw.com',
  'sunoapi.org',
  'suno.ai',
  'cdn1.suno.ai',
  'replicate.delivery',
  'googleapis.com',
  'googleusercontent.com',
  'bytedance.com',
  'byteintlapi.com',
  'volccdn.com',
  'klingai.com',
  'kwaicdn.com',
  'elevenlabs.io',
  'openai.com',
  'oaiusercontent.com',
  'bfl.ai',
  'ideogram.ai',
  'minimaxi.com',
  'minimax.io',
  'aliyuncs.com',
  'x.ai',
  'pixverse.ai',
  'topazlabs.com',
]

function isAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return ALLOWED_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  )
}

async function handleGET(req: Request) {
  const raw = new URL(req.url).searchParams.get('url')
  const download = new URL(req.url).searchParams.get('download') === '1'
  const filename = new URL(req.url).searchParams.get('filename')

  if (!raw) {
    return NextResponse.json({ error: 'url is required.' }, { status: 400 })
  }

  let target: URL
  try {
    target = new URL(raw)
  } catch {
    return NextResponse.json({ error: 'Malformed url.' }, { status: 400 })
  }

  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    return NextResponse.json({ error: 'Unsupported protocol.' }, { status: 400 })
  }
  if (!isAllowed(target.hostname)) {
    return NextResponse.json(
      { error: `Host not allowed: ${target.hostname}` },
      { status: 403 },
    )
  }

  const upstream = await fetch(target.toString(), { cache: 'no-store' })

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: `Upstream returned ${upstream.status}.` },
      { status: 502 },
    )
  }

  const headers = new Headers()
  headers.set(
    'Content-Type',
    upstream.headers.get('content-type') ?? 'application/octet-stream',
  )
  const length = upstream.headers.get('content-length')
  if (length) headers.set('Content-Length', length)
  // Generated assets are immutable at their URL.
  headers.set('Cache-Control', 'public, max-age=3600')

  if (download) {
    const safe = (filename ?? target.pathname.split('/').pop() ?? 'asset')
      .replace(/[^\w.\-]/g, '_')
      .slice(0, 120)
    headers.set('Content-Disposition', `attachment; filename="${safe}"`)
  }

  return new NextResponse(upstream.body, { status: 200, headers })
}

export const GET = withLogging(handleGET)
