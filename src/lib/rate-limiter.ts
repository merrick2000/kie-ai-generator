/**
 * Token bucket.
 *
 * Kie allows 20 requests per 10 seconds per account. Anything above that comes
 * back as 429, and a naive poller reaches it with only a handful of jobs in
 * flight, so requests are spent from a budget rather than issued on demand.
 *
 * Isomorphic on purpose: the same limiter guards the browser-side poll
 * scheduler and the server-side Kie client.
 */

export interface TokenBucketOptions {
  /** Requests allowed per window. */
  capacity: number
  /** Window length in milliseconds. */
  windowMs: number
}

export class TokenBucket {
  private tokens: number
  private lastRefill: number
  private readonly capacity: number
  private readonly windowMs: number

  constructor({ capacity, windowMs }: TokenBucketOptions) {
    this.capacity = capacity
    this.windowMs = windowMs
    this.tokens = capacity
    this.lastRefill = Date.now()
  }

  /**
   * Refill continuously rather than in steps.
   *
   * Resetting the whole allowance on a window boundary lets a burst of
   * `capacity` fire twice back to back across the boundary, which is exactly
   * what trips the upstream limit.
   */
  private refill(): void {
    const now = Date.now()
    const elapsed = now - this.lastRefill
    if (elapsed <= 0) return

    const refillRate = this.capacity / this.windowMs
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * refillRate)
    this.lastRefill = now
  }

  /** Take a token if one is available. Never blocks. */
  tryTake(count = 1): boolean {
    this.refill()
    if (this.tokens < count) return false
    this.tokens -= count
    return true
  }

  /** Milliseconds until `count` tokens exist. */
  waitTime(count = 1): number {
    this.refill()
    if (this.tokens >= count) return 0
    const missing = count - this.tokens
    return Math.ceil(missing / (this.capacity / this.windowMs))
  }

  /** Wait for a token, then take it. */
  async take(count = 1): Promise<void> {
    for (;;) {
      if (this.tryTake(count)) return
      await new Promise((resolve) => setTimeout(resolve, this.waitTime(count) + 5))
    }
  }

  /** Whole tokens currently available, for diagnostics. */
  get available(): number {
    this.refill()
    return Math.floor(this.tokens)
  }
}

/**
 * Poll budget.
 *
 * Kie's ceiling is 20 requests per 10 seconds. A token bucket can burst up to
 * its capacity on top of a full window of refill, so the real worst case over
 * any 10s window is `2 * capacity`. A capacity of 12 therefore peaks at 24 and
 * breaches the limit, which is what a load test caught.
 *
 * Capacity 8 peaks at 16, leaving room for submissions and uploads. Sustained
 * throughput is 0.8 req/s, still enough for a single job to poll every 1.5s.
 */
export const KIE_POLL_BUDGET = { capacity: 8, windowMs: 10_000 } as const

/** The account-wide ceiling this budget has to stay under. */
export const KIE_ACCOUNT_LIMIT = { capacity: 20, windowMs: 10_000 } as const
