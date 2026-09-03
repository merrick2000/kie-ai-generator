/**
 * Credits and money.
 *
 * Kie bills in credits. The rate is not exposed by any API, so it is a
 * constant here, checked against two figures Kie publishes: Veo 3 Fast at 80
 * credits for $0.40, and Veo 3 Quality at 400 credits for $2.00. Both give
 * $0.005 per credit.
 *
 * Kie also states that pricing changes as upstream providers adjust theirs, so
 * the rate is overridable without a code change.
 */

/** USD per credit. Override with NEXT_PUBLIC_CREDIT_USD_RATE. */
export const CREDIT_USD_RATE = (() => {
  const raw = Number(process.env.NEXT_PUBLIC_CREDIT_USD_RATE)
  return Number.isFinite(raw) && raw > 0 ? raw : 0.005
})()

export function creditsToUsd(credits: number): number {
  return credits * CREDIT_USD_RATE
}

/**
 * Format a dollar amount.
 *
 * Generations routinely cost fractions of a cent, so the precision follows the
 * magnitude: rounding $0.004 to $0.00 would read as free.
 */
export function formatUsd(amount: number): string {
  if (amount === 0) return '$0'
  if (amount < 0.01) return `$${amount.toFixed(4)}`
  if (amount < 1) return `$${amount.toFixed(3)}`
  return `$${amount.toFixed(2)}`
}

export function formatCredits(credits: number): string {
  return credits % 1 === 0 ? credits.toLocaleString() : credits.toFixed(1)
}

/** "120 credits (~$0.60)" */
export function formatCost(credits: number): string {
  return `${formatCredits(credits)} credits (${formatUsd(creditsToUsd(credits))})`
}

/* ────────────────────────────────────────────────────────────────────────────
 * Observed costs
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * What a model costs, learned from what it actually charged.
 *
 * Kie publishes no per-model price list through the API, and hardcoding one
 * for 55 models would be wrong the moment a price changed. Instead the real
 * `creditsConsumed` from each completed job is recorded, so an estimate only
 * ever appears once it has been earned.
 */
export interface ModelCost {
  /** Mean credits across observed runs. */
  averageCredits: number
  /** Cheapest and dearest seen, since options change the price. */
  minCredits: number
  maxCredits: number
  samples: number
  lastSeenAt: number
}

export function recordCost(
  existing: ModelCost | undefined,
  credits: number,
): ModelCost {
  if (!existing) {
    return {
      averageCredits: credits,
      minCredits: credits,
      maxCredits: credits,
      samples: 1,
      lastSeenAt: Date.now(),
    }
  }

  const samples = existing.samples + 1
  return {
    // Running mean, so the whole history need not be kept.
    averageCredits:
      existing.averageCredits + (credits - existing.averageCredits) / samples,
    minCredits: Math.min(existing.minCredits, credits),
    maxCredits: Math.max(existing.maxCredits, credits),
    samples,
    lastSeenAt: Date.now(),
  }
}

/**
 * How an estimate should be worded.
 *
 * One sample is a data point, not an average, and a model whose cost varies
 * with resolution or duration should not be quoted as a single number.
 */
export function describeEstimate(cost: ModelCost): string {
  if (cost.samples === 1) {
    return `Last run cost ${formatCost(cost.averageCredits)}`
  }
  if (cost.maxCredits - cost.minCredits > 0.01) {
    return `${formatCredits(cost.minCredits)} to ${formatCredits(cost.maxCredits)} credits (${formatUsd(creditsToUsd(cost.minCredits))} to ${formatUsd(creditsToUsd(cost.maxCredits))})`
  }
  return `About ${formatCost(cost.averageCredits)}`
}

/* ────────────────────────────────────────────────────────────────────────────
 * Published prices
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * Prices as Kie publishes them, so a cost can be shown before a model has
 * ever run.
 *
 * Transcribed from Kie's own pricing table (the same data /api/kie/pricing
 * serves live). Two things make this a hand-written map rather than an
 * automatic lookup:
 *
 *   Their labels are prose, not slugs. "Google nano banana 2, 4K" has to be
 *   tied to `nano-banana-2` by hand.
 *
 *   Fuzzy matching those labels produced confident wrong answers: it paired
 *   `nano-banana-2` with the cheaper "nano-banana-2-lite" row, and
 *   `seedream/5-lite` with "seedream 5 Pro". A wrong price is worse than no
 *   price, so only verified pairings are listed.
 *
 * Prices vary by resolution and tier, so each entry is a function of the
 * settings actually chosen. A measured charge always wins over anything here.
 */

export type PriceUnit =
  | 'image'
  | 'second'
  | 'video'
  | 'request'
  | 'thousand-chars'

export interface PricePoint {
  credits: number
  unit: PriceUnit
}

/** Reads the chosen settings and returns the unit price, or null if unknown. */
type PriceResolver = (values: Record<string, unknown>) => PricePoint | null

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Picks a price from a resolution-keyed table. */
const byKey = (
  table: Record<string, number>,
  key: string,
  unit: PriceUnit,
  fallbackKey?: string,
): PriceResolver => {
  return (values) => {
    const chosen = str(values[key]).toUpperCase()
    const credits = table[chosen] ?? (fallbackKey ? table[fallbackKey] : undefined)
    return credits === undefined ? null : { credits, unit }
  }
}

const flat = (credits: number, unit: PriceUnit): PriceResolver => () => ({ credits, unit })

/** True when the form carries a reference video, which Kie prices lower. */
const hasVideoInput = (v: Record<string, unknown>): boolean => {
  const refs = v.reference_video_urls
  return Array.isArray(refs) && refs.filter(Boolean).length > 0
}

const PUBLISHED: Record<string, PriceResolver> = {
  // Images, per image.
  'nano-banana-2': byKey({ '1K': 8, '2K': 12, '4K': 18 }, 'resolution', 'image', '1K'),
  'google/nano-banana': flat(4, 'image'),
  'google/nano-banana-edit': flat(4, 'image'),
  'seedream/5-pro-text-to-image': (v) => ({
    // "basic" is 1K, "high" is 2K.
    credits: str(v.quality) === 'high' ? 14 : 7,
    unit: 'image',
  }),
  'seedream/5-pro-image-to-image': (v) => ({
    credits: str(v.quality) === 'high' ? 14 : 7,
    unit: 'image',
  }),
  'z-image': flat(0.8, 'image'),
  'flux-2/pro-text-to-image': byKey({ '1K': 5, '2K': 7 }, 'resolution', 'image', '1K'),
  'flux-2/pro-image-to-image': byKey({ '1K': 5, '2K': 7 }, 'resolution', 'image', '1K'),
  'flux-2/flex-text-to-image': byKey({ '1K': 14, '2K': 24 }, 'resolution', 'image', '1K'),
  'flux-2/flex-image-to-image': byKey({ '1K': 14, '2K': 24 }, 'resolution', 'image', '1K'),
  'topaz/image-upscale': byKey({ '1': 10, '2': 20, '4': 40 }, 'upscale_factor', 'image', '2'),

  // Video, per second of output.
  'kling/v3-turbo-text-to-video': byKey(
    { '720P': 18, '1080P': 22.5 },
    'resolution',
    'second',
    '720P',
  ),
  'kling/v3-turbo-image-to-video': byKey(
    { '720P': 18, '1080P': 22.5 },
    'resolution',
    'second',
    '720P',
  ),
  'topaz/video-upscale': byKey({ '1': 8, '2': 8, '4': 14 }, 'upscale_factor', 'second', '2'),

  // Video, per finished video. Veo prices by tier and resolution together.
  veo3: (v) => {
    const tier = str(v.model) || 'veo3_fast'
    const res = str(v.resolution).toLowerCase() || '720p'
    const table: Record<string, Record<string, number>> = {
      veo3: { '720p': 250, '1080p': 255, '4k': 380 },
      veo3_fast: { '720p': 60, '1080p': 65, '4k': 180 },
      veo3_lite: { '720p': 30, '1080p': 35, '4k': 150 },
    }
    const credits = table[tier]?.[res]
    return credits === undefined ? null : { credits, unit: 'video' }
  },

  'gpt-image-2-text-to-image': byKey(
    { '1K': 6, '2K': 10, '4K': 16 },
    'resolution',
    'image',
    '1K',
  ),
  'gpt-image-2-image-to-image': byKey(
    { '1K': 6, '2K': 10, '4K': 16 },
    'resolution',
    'image',
    '1K',
  ),

  // Qwen image 3.0 charges the same at 1K and 2K.
  'qwen3/text-to-image': flat(4.8, 'image'),
  'qwen3/image-to-image': flat(4.8, 'image'),

  // Ideogram prices by rendering speed rather than resolution.
  'ideogram/v3-text-to-image': byKey(
    { TURBO: 3.5, BALANCED: 7, QUALITY: 10 },
    'rendering_speed',
    'image',
    'BALANCED',
  ),
  'ideogram/character': byKey(
    { TURBO: 12, BALANCED: 18, QUALITY: 24 },
    'rendering_speed',
    'image',
    'BALANCED',
  ),

  'google/imagen4': flat(8, 'request'),
  'google/imagen4-ultra': flat(12, 'image'),

  // Video, per second.
  //
  // Seedance charges roughly 40% less when a reference video is supplied,
  // so the presence of one is part of the price.
  'bytedance/seedance-2': (v) => {
    const res = str(v.resolution).toLowerCase() || '720p'
    const withVideo = hasVideoInput(v)
    const table: Record<string, [number, number]> = {
      // [no video input, with video input]
      '480p': [19, 11.5],
      '720p': [41, 25],
      '1080p': [102, 62],
      '4k': [208, 128],
    }
    const pair = table[res]
    return pair ? { credits: withVideo ? pair[1] : pair[0], unit: 'second' } : null
  },
  'bytedance/seedance-2-fast': (v) => {
    const res = str(v.resolution).toLowerCase() || '720p'
    const withVideo = hasVideoInput(v)
    const table: Record<string, [number, number]> = {
      '480p': [11.7, 6.8],
      '720p': [24.8, 15],
    }
    const pair = table[res]
    return pair ? { credits: withVideo ? pair[1] : pair[0], unit: 'second' } : null
  },

  // Motion control's `mode` maps to resolution: std is 720P, pro is 1080P.
  'kling-3.0/motion-control': (v) => ({
    credits: str(v.mode) === 'pro' ? 27 : 20,
    unit: 'second',
  }),

  'wan/2-7-text-to-video': byKey(
    { '720P': 16, '1080P': 24 },
    'resolution',
    'second',
    '1080P',
  ),
  'wan/2-7-image-to-video': byKey(
    { '720P': 16, '1080P': 24 },
    'resolution',
    'second',
    '1080P',
  ),
  'wan/2-2-animate-replace': byKey(
    { '480P': 6, '720P': 12.5 },
    'resolution',
    'second',
    '720P',
  ),

  'minimax-h3/text-to-video': byKey(
    { '768P': 8, '2K': 13 },
    'resolution',
    'second',
    '2K',
  ),
  'minimax-h3/image-to-video': byKey(
    { '768P': 8, '2K': 13 },
    'resolution',
    'second',
    '2K',
  ),

  // Pixverse prices per second by resolution. The audio-bearing tiers cost
  // more, but this model exposes no audio switch, so the quieter tier is used.
  'pixverse/text-to-video': byKey(
    { '360P': 4, '540P': 5.6, '720P': 7.2, '1080P': 14.4 },
    'resolution',
    'second',
    '720P',
  ),
  'pixverse/image-to-video': byKey(
    { '360P': 4, '540P': 5.6, '720P': 7.2, '1080P': 14.4 },
    'resolution',
    'second',
    '720P',
  ),

  // Lip sync, billed per second of the audio track. Duration comes from the
  // uploaded file, so no total can be quoted before the run.
  'omnihuman-1-5': flat(27, 'second'),

  // Video, per finished video. Hailuo prices duration and resolution
  // together, and 10s at 1080p is not offered.
  'hailuo/2-3-image-to-video-pro': (v) => {
    const duration = str(v.duration) || '6'
    const res = str(v.resolution).toUpperCase() || '768P'
    const table: Record<string, number> = {
      '6-768P': 45,
      '6-1080P': 80,
      '10-768P': 90,
    }
    const credits = table[`${duration}-${res}`]
    return credits === undefined ? null : { credits, unit: 'video' }
  },
  'hailuo/02-text-to-video-pro': (v) => {
    const duration = str(v.duration) || '6'
    const res = str(v.resolution).toUpperCase() || '768P'
    // Only the 6s 1080p Pro tier is published for this one.
    return duration === '6' && res === '1080P'
      ? { credits: 57, unit: 'video' }
      : null
  },

  // Audio.
  suno: flat(12, 'request'),
  'elevenlabs/text-to-speech-multilingual-v2': flat(12, 'thousand-chars'),
  'elevenlabs/text-to-speech-turbo-2-5': flat(6, 'thousand-chars'),

  /*
   * Deliberately absent, because Kie's table has no row that can be tied to
   * them with confidence:
   *
   *   seedream 5 Lite and Seedream v4   only "seedream 4.5" is listed
   *   gpt-image 1.5                     priced by high/medium, we expose 1K/2K
   *   grok-imagine, image and video     no rows at all
   *   Kling avatars and Kling 3 Omni    no rows at all
   *   InfiniTalk, ElevenLabs isolation  no rows at all
   *   Recraft, layer decomposition      no rows at all
   *   Seedance 1 Pro image-to-video     only 1.5-pro rows, a different model
   *
   * These fall back to the cost measured from a real run.
   */
}

export function hasPublishedPrice(modelId: string): boolean {
  return modelId in PUBLISHED
}

/**
 * Estimate a run from the published price and the chosen settings.
 *
 * Returns null when the price is unknown, or when the quantity that drives it
 * cannot be read: a figure that ignored a 15s duration would mislead in
 * exactly the case where cost matters most.
 */
export function estimateFromReference(
  modelId: string,
  values: Record<string, unknown>,
): { credits: number; usd: number; basis: string } | null {
  const resolver = PUBLISHED[modelId]
  if (!resolver) return null

  const point = resolver(values)
  if (!point) return null

  const perUnit = point.credits

  switch (point.unit) {
    case 'second': {
      const seconds = Number(values.duration)
      if (!Number.isFinite(seconds) || seconds <= 0) return null
      const credits = perUnit * seconds
      return {
        credits,
        usd: creditsToUsd(credits),
        basis: `${seconds}s at ${formatCredits(perUnit)} cr/s`,
      }
    }

    case 'image': {
      const count = Number(values.max_images) || Number(values.num_images) || 1
      const credits = perUnit * count
      return {
        credits,
        usd: creditsToUsd(credits),
        basis:
          count > 1
            ? `${count} images at ${formatCredits(perUnit)} cr each`
            : `${formatCredits(perUnit)} cr per image`,
      }
    }

    case 'thousand-chars': {
      const text = str(values.text)
      if (!text.length) return null
      const credits = perUnit * (text.length / 1000)
      return {
        credits,
        usd: creditsToUsd(credits),
        basis: `${text.length} characters at ${formatCredits(perUnit)} cr/1K`,
      }
    }

    case 'video':
    case 'request':
      return {
        credits: perUnit,
        usd: creditsToUsd(perUnit),
        basis: point.unit === 'video' ? 'per video' : 'per request',
      }
  }
}
