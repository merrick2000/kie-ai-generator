import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

/**
 * Kie's own pricing table.
 *
 * Served from an undocumented but public endpoint their pricing page uses. It
 * needs no API key, so it is proxied here rather than called from the browser:
 * that keeps it same-origin, cacheable, and swappable if the endpoint moves.
 *
 * Cached for an hour. Prices move when upstream providers change theirs, which
 * is not something that needs to be seen within the minute.
 */
export const revalidate = 3600

const KIE_PRICING_URL = 'https://api.kie.ai/client/v1/model-pricing/page'
const PAGE_SIZE = 100
const MAX_PAGES = 10

export interface PriceRow {
  /** Human label, e.g. "kling 3.0 turbo, image-to-video, 1080P". */
  label: string
  /** 'image' | 'video' | 'music' | 'chat' */
  modality: string
  provider: string
  credits: number
  /** "per image", "per second", "per video", "per 1000 characters"… */
  unit: string
  usd: number
}

interface KieRecord {
  modelDescription?: string
  interfaceType?: string
  provider?: string
  creditPrice?: string
  creditUnit?: string
  usdPrice?: string
}

export async function GET() {
  try {
    const rows: PriceRow[] = []

    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await fetch(KIE_PRICING_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageNum: page,
          pageSize: PAGE_SIZE,
          modelDescription: '',
          interfaceType: '',
        }),
        // Let Next cache this for us rather than hammering Kie per visitor.
        next: { revalidate },
      })

      if (!res.ok) break

      const payload = (await res.json()) as {
        data?: { records?: KieRecord[]; total?: number }
      }
      const records = payload.data?.records ?? []
      if (!records.length) break

      for (const r of records) {
        const credits = Number(r.creditPrice)
        const usd = Number(r.usdPrice)
        if (!r.modelDescription) continue

        rows.push({
          label: r.modelDescription.trim(),
          modality: r.interfaceType?.trim() || 'other',
          provider: r.provider?.trim() || '',
          credits: Number.isFinite(credits) ? credits : 0,
          unit: r.creditUnit?.trim() || 'per generation',
          usd: Number.isFinite(usd) ? usd : 0,
        })
      }

      if (rows.length >= (payload.data?.total ?? rows.length)) break
    }

    if (!rows.length) {
      return NextResponse.json({ error: 'No pricing returned by Kie.' }, { status: 502 })
    }

    return NextResponse.json({ rows, fetchedAt: Date.now() })
  } catch (err) {
    console.error('[pricing] could not load Kie pricing:', err)
    return NextResponse.json({ error: 'Pricing is unavailable.' }, { status: 502 })
  }
}
