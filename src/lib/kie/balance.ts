/**
 * Refusing a run that cannot be paid for.
 *
 * Kie rejects a submission when the balance is short, which is correct but
 * arrives one job at a time: asking for eight variations on an empty account
 * produced eight rows, eight failures and eight error toasts, all saying the
 * same thing. Worse, a batch that runs out halfway leaves half a set.
 *
 * So the balance is read before anything is submitted and the whole batch is
 * refused at once, with the shortfall named.
 */

import 'server-only'

import { getCredits, runWithApiKey } from './client'
import { createLogger } from '../logger'

const log = createLogger('billing')

/**
 * How long a balance reading is trusted.
 *
 * Long enough that submitting a batch does not mean one credit check per run,
 * short enough that a top-up in another tab is picked up quickly. Generations
 * spend from it as they finish, so this is a guard against the obvious case
 * rather than an accounting ledger.
 */
const TTL_MS = 20_000

const cache = new Map<string, { credits: number; readAt: number }>()

/** Forget a reading, after something is known to have changed it. */
export function forgetBalance(userId: string): void {
  cache.delete(userId)
}

async function balanceFor(userId: string, key: string): Promise<number | null> {
  const cached = cache.get(userId)
  if (cached && Date.now() - cached.readAt < TTL_MS) return cached.credits

  try {
    const credits = await runWithApiKey(key, () => getCredits())
    cache.set(userId, { credits, readAt: Date.now() })
    return credits
  } catch (err) {
    // A balance we cannot read is not a reason to block a run. Kie will still
    // refuse it if there is really nothing there.
    log.debug('could not read the balance', { userId, error: err })
    return null
  }
}

export type Affordable =
  | { ok: true; balance: number | null }
  | { ok: false; balance: number; needed: number; message: string }

/**
 * Whether a batch can be paid for.
 *
 * `needed` is an estimate and is treated as one: only a shortfall large
 * enough to be certain refuses the run, because a wrong refusal is worse than
 * a wrong warning. When there is no published price for a model, the check
 * falls back to "is there anything left at all".
 */
export async function canAfford(
  userId: string,
  key: string,
  needed: number | null,
): Promise<Affordable> {
  const balance = await balanceFor(userId, key)
  if (balance === null) return { ok: true, balance: null }

  if (balance <= 0) {
    return {
      ok: false,
      balance,
      needed: needed ?? 0,
      message:
        'Your Kie.ai balance is empty, so nothing would run. Top up at kie.ai/billing.',
    }
  }

  if (needed !== null && needed > balance) {
    return {
      ok: false,
      balance,
      needed,
      message:
        `This needs about ${Math.ceil(needed)} credits and you have ${Math.floor(balance)}. ` +
        'Reduce the run count, pick a cheaper model, or top up at kie.ai/billing.',
    }
  }

  return { ok: true, balance }
}
