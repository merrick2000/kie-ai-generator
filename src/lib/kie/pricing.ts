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
 * Reference prices
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * Published prices, so a cost can be shown before a model has ever run.
 *
 * Taken from kie.ai's own pricing display. They are billed **per unit**, not
 * per generation: a video is priced by the second, so its cost moves with the
 * duration you pick. A single flat number per model would be wrong for most
 * of them.
 *
 * Only models Kie actually publishes a price for are listed. The rest show
 * nothing until a real charge is observed, which is more honest than a guess.
 * A measured cost always wins over anything here.
 */
export type PriceUnit = 'second' | 'image' | 'request' | 'thousand-chars'

export interface ReferencePrice {
  usd: number
  unit: PriceUnit
}

const REFERENCE_PRICES: Record<string, ReferencePrice> = {
  // Video, billed per second of output.
  'bytedance/seedance-2': { usd: 0.057, unit: 'second' },
  'bytedance/seedance-2-fast': { usd: 0.057, unit: 'second' },
  'kling/v3-turbo-text-to-video': { usd: 0.07, unit: 'second' },
  'kling/v3-turbo-image-to-video': { usd: 0.07, unit: 'second' },
  'kling/v3-omni-text-to-video': { usd: 0.07, unit: 'second' },

  // Video, billed per request.
  veo3: { usd: 0.025, unit: 'request' },

  // Images, billed per image.
  'gpt-image-2-text-to-image': { usd: 0.03, unit: 'image' },
  'gpt-image-2-image-to-image': { usd: 0.03, unit: 'image' },
  'nano-banana-2': { usd: 0.04, unit: 'image' },

  // Audio.
  suno: { usd: 0.002, unit: 'request' },
  'elevenlabs/text-to-speech-multilingual-v2': { usd: 0.07, unit: 'thousand-chars' },
  'elevenlabs/text-to-speech-turbo-2-5': { usd: 0.07, unit: 'thousand-chars' },
}

export function referencePrice(modelId: string): ReferencePrice | undefined {
  return REFERENCE_PRICES[modelId]
}

/**
 * Estimate a run from its published unit price and the chosen settings.
 *
 * Returns null when the price is unknown, or when the driving quantity cannot
 * be read from the form: a number that ignores a 15s duration would be
 * misleading in exactly the case where cost matters most.
 */
export function estimateFromReference(
  modelId: string,
  values: Record<string, unknown>,
): { usd: number; basis: string } | null {
  const price = referencePrice(modelId)
  if (!price) return null

  switch (price.unit) {
    case 'second': {
      const seconds = Number(values.duration)
      if (!Number.isFinite(seconds) || seconds <= 0) return null
      return { usd: price.usd * seconds, basis: `${seconds}s at ${formatUsd(price.usd)}/s` }
    }

    case 'image': {
      const count =
        Number(values.max_images) || Number(values.num_images) || 1
      return {
        usd: price.usd * count,
        basis: count > 1 ? `${count} images at ${formatUsd(price.usd)} each` : `${formatUsd(price.usd)} per image`,
      }
    }

    case 'thousand-chars': {
      const text = typeof values.text === 'string' ? values.text : ''
      if (!text.length) return null
      const thousands = text.length / 1000
      return {
        usd: price.usd * thousands,
        basis: `${text.length} characters at ${formatUsd(price.usd)}/1K`,
      }
    }

    case 'request':
      return { usd: price.usd, basis: 'per request' }
  }
}
