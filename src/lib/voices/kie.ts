/**
 * Suno Voice, as Kie exposes it.
 *
 * The only voice cloning Kie offers. It clones a *singing* voice for use in
 * Suno songs, not a speaking voice for text to speech, and it is built in
 * steps with the owner of the voice in the middle:
 *
 *   1. validation-phrase  a recording and the stretch of it to learn from
 *                         -> a phrase for the owner to read back
 *   2. create-voice       that reading
 *                         -> a voiceId
 *   3. check-voice        is the voiceId usable yet
 *
 * The reading is the point of the design. Anyone can find a clip of someone
 * singing; far fewer can get that person to read a sentence they have never
 * seen. regenerate-phrase exists for when the phrase expires or the reading
 * fails.
 *
 * Deliberately free of `server-only` so the parsing below is testable. Field
 * names are taken from docs.kie.ai/suno-api/suno-voice-*, current as of the
 * move to the market job API.
 */

export const VOICE_MODELS = {
  phrase: 'ai-music-api/validation-phrase',
  regenerate: 'ai-music-api/regenerate-phrase',
  create: 'ai-music-api/create-voice',
  check: 'ai-music-api/check-voice',
} as const

/** The phrase languages Kie lists. Anything else is refused. */
export const VOICE_LANGUAGES: { value: string; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Français' },
  { value: 'es', label: 'Español' },
  { value: 'pt', label: 'Português' },
  { value: 'de', label: 'Deutsch' },
  { value: 'zh', label: '中文' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'hi', label: 'हिन्दी' },
  { value: 'ru', label: 'Русский' },
]

export const SINGER_LEVELS = ['beginner', 'intermediate', 'advanced', 'professional'] as const
export type SingerLevel = (typeof SINGER_LEVELS)[number]

export type VoiceStatus =
  /** Waiting for Kie to write the phrase. */
  | 'phrase_pending'
  /** Phrase ready, waiting for the owner to read it. */
  | 'phrase_ready'
  /** Reading submitted, waiting for the voice. */
  | 'creating'
  /** voiceId in hand and usable in Suno. */
  | 'ready'
  | 'failed'

/**
 * Checks the stretch of the recording before it costs a request.
 *
 * Kie documents integers and `end > start` and nothing else, so nothing else
 * is invented here. A minimum length would be a guess, and a wrong guess
 * refuses a sample Kie would have accepted.
 */
export function checkSegment(start: unknown, end: unknown): string | null {
  const s = Number(start)
  const e = Number(end)
  if (!Number.isInteger(s) || !Number.isInteger(e)) {
    return 'The start and end of the sample must be whole seconds.'
  }
  if (s < 0) return 'The sample cannot start before the beginning of the recording.'
  if (e <= s) return 'The end of the sample has to come after its start.'
  return null
}

export function phraseInput(args: {
  sourceUrl: string
  startS: number
  endS: number
  language: string
}): Record<string, unknown> {
  return {
    voice_url: args.sourceUrl,
    vocal_start_s: args.startS,
    vocal_end_s: args.endS,
    language: args.language,
  }
}

export function createInput(args: {
  phraseTaskId: string
  verifyUrl: string
  name: string
  description?: string | null
  style?: string | null
  singerSkillLevel?: string | null
}): Record<string, unknown> {
  const input: Record<string, unknown> = {
    task_id: args.phraseTaskId,
    verify_url: args.verifyUrl,
    voice_name: args.name,
  }
  if (args.description?.trim()) input.description = args.description.trim()
  if (args.style?.trim()) input.style = args.style.trim()
  if (args.singerSkillLevel && (SINGER_LEVELS as readonly string[]).includes(args.singerSkillLevel)) {
    input.singer_skill_level = args.singerSkillLevel
  }
  return input
}

export interface VoiceResult {
  phrase?: string
  voiceId?: string
  available?: boolean
}

/**
 * Finds what a voice step returned, wherever it was put.
 *
 * The callbacks are documented (`data.validateInfo`, `data.voiceId`,
 * `data.isAvailable`); the polled result is not. Kie's task-detail page shows
 * only the generic `{"resultUrls": [...]}`, so the exact place these land in
 * `resultJson` cannot be read off the docs. Rather than bet on one shape, this
 * looks for the documented names, in both casings, at any depth. A key that
 * never turns up is reported as missing by the caller, with the raw payload
 * logged, so the first real run says where it actually is.
 */
export function readVoiceResult(resultJson: string | null | undefined): VoiceResult {
  if (!resultJson) return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(resultJson)
  } catch {
    return {}
  }

  const out: VoiceResult = {}

  const visit = (node: unknown, depth: number) => {
    if (depth > 6 || node == null) return
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1)
      return
    }
    if (typeof node !== 'object') return

    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const k = key.toLowerCase().replace(/_/g, '')
      if (out.phrase === undefined && (k === 'validateinfo' || k === 'validationphrase') && typeof value === 'string' && value.trim()) {
        out.phrase = value.trim()
      } else if (out.voiceId === undefined && k === 'voiceid' && typeof value === 'string' && value.trim()) {
        out.voiceId = value.trim()
      } else if (out.available === undefined && k === 'isavailable' && typeof value === 'boolean') {
        out.available = value
      } else if (value && typeof value === 'object') {
        visit(value, depth + 1)
      }
    }
  }

  visit(parsed, 0)
  return out
}
