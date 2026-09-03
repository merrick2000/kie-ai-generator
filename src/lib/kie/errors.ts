/**
 * Turning failures into something the user can act on.
 *
 * A raw upstream message like "402" or "Invalid parameter" tells someone
 * nothing about what to do next. Every failure is mapped to a plain sentence
 * and, where one exists, a concrete next step.
 */

import { KIE_CODE } from './types'

export type ErrorAction =
  | { kind: 'top-up' }
  | { kind: 'open-settings'; tab: 'key' | 'billing' }
  | { kind: 'retry'; afterMs?: number }
  | { kind: 'check-inputs' }
  | { kind: 'none' }

export interface FriendlyError {
  /** One sentence, no jargon, no error code. */
  message: string
  /** What to do about it, when there is something. */
  hint?: string
  action: ErrorAction
  /** Worth trying again unchanged. */
  retryable: boolean
}

/**
 * Map an upstream failure.
 *
 * `status` is the HTTP status our own route returned, which already reflects
 * the Kie code; `code` is Kie's own when we have it.
 */
export function explainError(
  status: number,
  code?: number,
  raw?: string,
): FriendlyError {
  const effective = code ?? status

  switch (effective) {
    case KIE_CODE.UNAUTHORIZED:
      return {
        message: 'Your Kie.ai API key was rejected.',
        hint: 'It may have been revoked or regenerated. Add a fresh one in Settings.',
        action: { kind: 'open-settings', tab: 'key' },
        retryable: false,
      }

    case KIE_CODE.INSUFFICIENT_CREDITS:
      return {
        message: 'Not enough credits on your Kie.ai account.',
        hint: 'Top up on kie.ai, then run this again. Nothing was charged.',
        action: { kind: 'top-up' },
        retryable: false,
      }

    case KIE_CODE.RATE_LIMITED:
      return {
        message: 'Kie.ai is rate limiting your account.',
        hint: 'Too many requests at once. This retries on its own in a few seconds.',
        action: { kind: 'retry', afterMs: 10_000 },
        retryable: true,
      }

    case KIE_CODE.VALIDATION_ERROR:
    case KIE_CODE.BAD_REQUEST:
      return {
        message: raw?.trim() || 'The model rejected these settings.',
        hint: 'Check the prompt length and any reference files, then try again.',
        action: { kind: 'check-inputs' },
        retryable: false,
      }

    case KIE_CODE.NOT_FOUND:
      return {
        message: 'Kie.ai could not find this task.',
        hint: 'It may have expired. Check kie.ai/logs for the original run.',
        action: { kind: 'none' },
        retryable: false,
      }

    case 413:
      return {
        message: 'That file is too large.',
        hint: 'Kie accepts up to 100MB, and most models want far less.',
        action: { kind: 'check-inputs' },
        retryable: false,
      }

    case 503:
      return {
        message: 'The service is temporarily unavailable.',
        hint: 'Usually brief. Try again shortly.',
        action: { kind: 'retry', afterMs: 15_000 },
        retryable: true,
      }

    case KIE_CODE.SERVER_ERROR:
    default:
      if (status >= 500) {
        return {
          message: 'Kie.ai had a problem completing this.',
          hint: 'Their side, not yours. Retrying often works.',
          action: { kind: 'retry' },
          retryable: true,
        }
      }
      return {
        message: raw?.trim() || 'Something went wrong.',
        action: { kind: 'none' },
        retryable: false,
      }
  }
}

/**
 * Failures reported by the model itself, after the job was accepted.
 *
 * These arrive as `failMsg` on a completed task, so no HTTP status applies.
 * Matching is on substrings because the wording varies between providers.
 */
export function explainTaskFailure(failMsg?: string | null): FriendlyError {
  const text = (failMsg ?? '').toLowerCase()

  if (/nsfw|content policy|safety|blocked|violat/.test(text)) {
    return {
      message: 'The model refused this on content grounds.',
      hint: 'Rewording the prompt, or swapping the reference image, usually clears it.',
      action: { kind: 'check-inputs' },
      retryable: false,
    }
  }

  if (/timeout|timed out/.test(text)) {
    return {
      message: 'The generation timed out upstream.',
      hint: 'Long videos at high resolution are the usual cause. Try shorter or smaller.',
      action: { kind: 'retry' },
      retryable: true,
    }
  }

  if (/download|fetch|url|image_url|not accessible|invalid url/.test(text)) {
    return {
      message: 'The model could not read one of your files.',
      hint: 'Uploaded references expire after about a day. Re-upload and run it again.',
      action: { kind: 'check-inputs' },
      retryable: false,
    }
  }

  if (/credit|balance|insufficient/.test(text)) {
    return {
      message: 'Not enough credits to finish this generation.',
      action: { kind: 'top-up' },
      retryable: false,
    }
  }

  return {
    message: failMsg?.trim() || 'The generation failed.',
    action: { kind: 'retry' },
    retryable: true,
  }
}
