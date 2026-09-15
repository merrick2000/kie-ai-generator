/**
 * Gemini Omni voices and characters, as Kie exposes them.
 *
 * A voice here is designed, not cloned: one of Gemini's thirty base voices,
 * shaped by a written description of timbre, pace and mood. The endpoint takes
 * no audio at all. A character binds a face, a description and those voices
 * into one id that Gemini Omni video accepts.
 *
 * Free of `server-only` so the checks below are testable. Names and limits
 * from docs.kie.ai/market/gemini-omni-audio and gemini-omni-character.
 */

export const OMNI_BASE_VOICES: { value: string; hint: string }[] = [
  { value: 'achernar', hint: 'female, soft, high pitch' },
  { value: 'achird', hint: 'male, friendly, mid pitch' },
  { value: 'algenib', hint: 'male, raspy, low pitch' },
  { value: 'algieba', hint: 'male, easygoing, mid-low pitch' },
  { value: 'alnilam', hint: 'male, steady, mid-low pitch' },
  { value: 'aoede', hint: 'female, brisk, mid pitch' },
  { value: 'autonoe', hint: 'female, bright, mid pitch' },
  { value: 'callirrhoe', hint: 'female, easygoing, mid pitch' },
  { value: 'charon', hint: 'male, intellectual, low pitch' },
  { value: 'despina', hint: 'female, smooth, mid pitch' },
  { value: 'enceladus', hint: 'male, breathy, low pitch' },
  { value: 'erinome', hint: 'female, clear, mid pitch' },
  { value: 'fenrir', hint: 'male, lively, younger pitch' },
  { value: 'gacrux', hint: 'female, mature, mid pitch' },
  { value: 'iapetus', hint: 'male, clear, mid-low pitch' },
  { value: 'kore', hint: 'female, capable, mid pitch' },
  { value: 'laomedeia', hint: 'female, cheerful, mid-high pitch' },
  { value: 'leda', hint: 'female, young, mid-high pitch' },
  { value: 'orus', hint: 'male, steady, mid-low pitch' },
  { value: 'puck', hint: 'male, cheerful, mid pitch' },
  { value: 'pulcherrima', hint: 'genderless, forward, mid-high pitch' },
  { value: 'rasalgethi', hint: 'male, intellectual, mid pitch' },
  { value: 'sadachbia', hint: 'male, vivid, low pitch' },
  { value: 'sadaltager', hint: 'male, knowledgeable, mid pitch' },
  { value: 'schedar', hint: 'male, smooth, mid-low pitch' },
  { value: 'sulafat', hint: 'female, warm, mid pitch' },
  { value: 'umbriel', hint: 'male, smooth, low pitch' },
  { value: 'vindemiatrix', hint: 'female, gentle, mid pitch' },
  { value: 'zephyr', hint: 'female, bright, mid-high pitch' },
  { value: 'zubenelgenubi', hint: 'male, casual, mid-low pitch' },
]

export const OMNI_LIMITS = {
  voiceName: 210,
  voiceDescription: 20000,
  exampleDialogue: 120,
  characterName: 80,
  characterDescription: 5000,
} as const

export interface VoiceDraft {
  baseVoice: unknown
  name: unknown
  voiceDescription?: unknown
  exampleDialogue?: unknown
}

export interface CharacterDraft {
  name?: unknown
  description: unknown
  portraitUrl: unknown
  bodyUrl?: unknown
  voiceIds?: unknown
}

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** Refuses a voice before it costs a request. Null when it is fine. */
export function checkVoice(draft: VoiceDraft): string | null {
  const base = clean(draft.baseVoice)
  if (!OMNI_BASE_VOICES.some((v) => v.value === base)) return 'Pick a base voice.'
  const name = clean(draft.name)
  if (!name) return 'Give the voice a name.'
  if (name.length > OMNI_LIMITS.voiceName) return `The name is over ${OMNI_LIMITS.voiceName} characters.`
  if (clean(draft.voiceDescription).length > OMNI_LIMITS.voiceDescription) {
    return `The description is over ${OMNI_LIMITS.voiceDescription.toLocaleString()} characters.`
  }
  if (clean(draft.exampleDialogue).length > OMNI_LIMITS.exampleDialogue) {
    return `The example line is over ${OMNI_LIMITS.exampleDialogue} characters.`
  }
  return null
}

export function voiceBody(draft: VoiceDraft) {
  const body: { audio_id: string; name: string; voice_description?: string; example_dialogue?: string } = {
    audio_id: clean(draft.baseVoice),
    name: clean(draft.name),
  }
  const description = clean(draft.voiceDescription)
  const example = clean(draft.exampleDialogue)
  if (description) body.voice_description = description
  if (example) body.example_dialogue = example
  return body
}

/** Refuses a character before it costs a request. Null when it is fine. */
export function checkCharacter(draft: CharacterDraft): string | null {
  const description = clean(draft.description)
  if (!description) return 'Describe the character.'
  if (description.length > OMNI_LIMITS.characterDescription) {
    return `The description is over ${OMNI_LIMITS.characterDescription.toLocaleString()} characters.`
  }
  if (!/^https:\/\//.test(clean(draft.portraitUrl))) return 'Add a portrait of the character.'
  const body = clean(draft.bodyUrl)
  if (body && !/^https:\/\//.test(body)) return 'The full-body image could not be read.'
  if (clean(draft.name).length > OMNI_LIMITS.characterName) {
    return `The name is over ${OMNI_LIMITS.characterName} characters.`
  }
  return null
}

/**
 * The character request.
 *
 * The description goes out under both spellings. Kie's schema requires
 * `descriptions` and its own example sends `description`; one of the two is
 * what the server reads, and sending both costs nothing while guessing wrong
 * would refuse every character.
 */
export function characterBody(draft: CharacterDraft, kieAudioIds: string[]) {
  const description = clean(draft.description)
  const images = [clean(draft.portraitUrl)]
  const body = clean(draft.bodyUrl)
  // Portrait first: index 0 is the portrait, index 1 the body, per the docs.
  if (body) images.push(body)

  const out: {
    descriptions: string
    description: string
    image_urls: string[]
    audio_ids?: string[]
    character_name?: string
  } = { descriptions: description, description, image_urls: images }

  if (kieAudioIds.length) out.audio_ids = kieAudioIds
  const name = clean(draft.name)
  if (name) out.character_name = name
  return out
}
