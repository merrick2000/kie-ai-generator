/**
 * Declarative field system.
 *
 * Every model in the catalog describes its `input` schema as a list of fields.
 * The studio form is generated from these descriptors, so adding a model is a
 * data change: never a UI change.
 */

export type FieldKind =
  | 'prompt' // multiline text, the headline input
  | 'text' // single-line text
  | 'textarea' // multiline, secondary (negative prompt, lyrics…)
  | 'select' // enum picker
  | 'ratio' // enum picker rendered as aspect-ratio tiles
  | 'toggle' // boolean
  | 'number' // integer/float with min/max
  | 'slider' // bounded float rendered as a range
  | 'seed' // integer + randomize affordance
  | 'image' // single asset URL (upload or paste)
  | 'images' // list of asset URLs
  | 'audio' // single audio URL
  | 'video' // single video URL
  | 'videos' // list of video URLs

export interface FieldOption {
  value: string
  label: string
  /** Optional hint shown under the option (e.g. "1K output"). */
  hint?: string
}

export interface BaseField {
  /** Key written into the request `input` object. */
  name: string
  kind: FieldKind
  label: string
  description?: string
  required?: boolean
  /** Hidden behind the "Advanced" disclosure. */
  advanced?: boolean
  /** Only show this field when another field holds one of these values. */
  showWhen?: { field: string; equals: unknown[] }
}

export interface PromptField extends BaseField {
  kind: 'prompt' | 'textarea' | 'text'
  maxLength?: number
  placeholder?: string
  default?: string
}

export interface SelectField extends BaseField {
  kind: 'select' | 'ratio'
  options: FieldOption[]
  default?: string
  /**
   * Submit the chosen value as a number.
   *
   * Several models declare an integer enum: a duration of 4, 6 or 8 seconds
   * is a menu to the reader and an integer to the API. Sending `"6"` where
   * the schema says integer is rejected.
   */
  asNumber?: boolean
}

export interface ToggleField extends BaseField {
  kind: 'toggle'
  default?: boolean
}

export interface NumberField extends BaseField {
  kind: 'number' | 'slider' | 'seed'
  min?: number
  max?: number
  step?: number
  default?: number
  /** Emit the value as a string rather than a number (some models want "5"). */
  asString?: boolean
}

export interface AssetField extends BaseField {
  kind: 'image' | 'images' | 'audio' | 'video' | 'videos'
  maxItems?: number
  /** Human-readable constraints, surfaced in the UI. */
  accepts?: string
  maxSizeMb?: number
}

export type Field =
  | PromptField
  | SelectField
  | ToggleField
  | NumberField
  | AssetField

/* ────────────────────────────────────────────────────────────────────────────
 * Shared field builders
 *
 * These keep the catalog terse and consistent. Each returns a fresh object so
 * catalog entries never share mutable state.
 * ──────────────────────────────────────────────────────────────────────────*/

export const opts = (...values: string[]): FieldOption[] =>
  values.map((v) => ({ value: v, label: v }))

export const prompt = (
  overrides: Partial<PromptField> = {},
): PromptField => ({
  name: 'prompt',
  kind: 'prompt',
  label: 'Prompt',
  required: true,
  maxLength: 5000,
  placeholder: 'Describe what you want to create…',
  ...overrides,
})

export const negativePrompt = (
  overrides: Partial<PromptField> = {},
): PromptField => ({
  name: 'negative_prompt',
  kind: 'textarea',
  label: 'Negative prompt',
  description: 'Traits to steer away from.',
  maxLength: 500,
  advanced: true,
  placeholder: 'blurry, low quality, distorted…',
  ...overrides,
})

export const ratio = (
  values: string[],
  def: string,
  overrides: Partial<SelectField> = {},
): SelectField => ({
  name: 'aspect_ratio',
  kind: 'ratio',
  label: 'Aspect ratio',
  options: opts(...values),
  default: def,
  ...overrides,
})

export const resolution = (
  values: string[],
  def: string,
  overrides: Partial<SelectField> = {},
): SelectField => ({
  name: 'resolution',
  kind: 'select',
  label: 'Resolution',
  options: opts(...values),
  default: def,
  ...overrides,
})

export const outputFormat = (
  values: string[] = ['png', 'jpeg'],
  def = 'png',
): SelectField => ({
  name: 'output_format',
  kind: 'select',
  label: 'Format',
  options: opts(...values),
  default: def,
  advanced: true,
})

export const nsfwChecker = (): ToggleField => ({
  name: 'nsfw_checker',
  kind: 'toggle',
  label: 'Content filter',
  description: 'Run Kie.ai’s NSFW check on the output.',
  default: false,
  advanced: true,
})

export const seed = (
  overrides: Partial<NumberField> = {},
): NumberField => ({
  name: 'seed',
  kind: 'seed',
  label: 'Seed',
  description: 'Reuse a seed to reproduce a result.',
  min: 0,
  max: 2147483647,
  step: 1,
  advanced: true,
  ...overrides,
})

/**
 * An optional reference on a text-to-X model.
 *
 * Filling it routes the submission to the model's image-to-X variant, so the
 * user never has to know Kie splits these into two slugs.
 */
export const optionalReference = (
  maxItems: number,
  overrides: Partial<AssetField> = {},
): AssetField => ({
  name: 'reference_images',
  kind: maxItems > 1 ? 'images' : 'image',
  label: 'Reference image',
  description: 'Optional. Adding one guides the result instead of generating from the prompt alone.',
  required: false,
  maxItems,
  accepts: 'JPEG, PNG, WebP',
  maxSizeMb: 10,
  ...overrides,
})

export const imageUrls = (
  maxItems: number,
  overrides: Partial<AssetField> = {},
): AssetField => ({
  name: 'image_urls',
  kind: 'images',
  label: 'Reference images',
  required: true,
  maxItems,
  accepts: 'JPEG, PNG, WebP',
  maxSizeMb: 10,
  ...overrides,
})

export const imageUrl = (
  overrides: Partial<AssetField> = {},
): AssetField => ({
  name: 'image_url',
  kind: 'image',
  label: 'Source image',
  required: true,
  accepts: 'JPEG, PNG, WebP',
  maxSizeMb: 10,
  ...overrides,
})

export const audioUrl = (
  overrides: Partial<AssetField> = {},
): AssetField => ({
  name: 'audio_url',
  kind: 'audio',
  label: 'Audio track',
  required: true,
  accepts: 'MP3, WAV, AAC, OGG, M4A',
  maxSizeMb: 100,
  ...overrides,
})

/**
 * Every voice Kie accepts, in the order its documentation lists them.
 *
 * Generated from the `voice` enum on the ElevenLabs endpoints rather than
 * typed out: an earlier hand-written list offered five IDs that are not in
 * that enum, so picking one of them had the request refused upstream. Both
 * speech models share the same roster.
 *
 * Preview any of them at
 * https://static.aiquickdraw.com/elevenlabs/voice/<id>.mp3
 */
export const ELEVENLABS_VOICES: FieldOption[] = [
  { value: 'EkK5I93UQWFDigLMpZcX', label: 'James', hint: 'Husky, Engaging and Bold' },
  { value: 'Z3R5wn05IrDiVCyEkUrK', label: 'Arabella', hint: 'Mysterious and Emotive' },
  { value: 'NNl6r8mD7vthiJatiJt1', label: 'Bradford', hint: 'Expressive and Articulate' },
  { value: 'YOq2y2Up4RgXP2HyXjE5', label: 'Xavier', hint: 'Dominating, Metallic Announcer' },
  { value: 'B8gJV1IhpuegLxdpXFOE', label: 'Kuon', hint: 'Cheerful, Clear and Steady' },
  { value: '2zRM7PkgwBPiau2jvVXc', label: 'Monika Sogam', hint: 'Deep and Natural' },
  { value: '1SM7GgM6IMuvQlz2BwM3', label: 'Mark', hint: 'Casual, Relaxed and Light' },
  { value: '5l5f8iK3YPeGga21rQIX', label: 'Adeline', hint: 'Feminine and Conversational' },
  { value: 'scOwDtmlUjD3prqpp97I', label: 'Sam', hint: 'Support Agent' },
  { value: 'NOpBlnGInO9m6vDvFkFC', label: 'Spuds Oxley', hint: 'Wise and Approachable' },
  { value: 'BZgkqPqms7Kj9ulSkVzn', label: 'Eve', hint: 'Authentic, Energetic and Happy' },
  { value: 'wo6udizrrtpIxWGp2qJk', label: 'Northern Terry gU0LNdkMOQCOrPrwtbee', hint: 'British Football Announcer' },
  { value: 'gU0LNdkMOQCOrPrwtbee', label: 'Voice gU0LNd' },
  { value: 'DGzg6RaUqxGRTHSBjfgF', label: 'Brock', hint: 'Commanding and Loud Sergeant' },
  { value: 'x70vRnQBMBu4FAYhjJbO', label: 'Nathan', hint: 'Virtual Radio Host' },
  { value: 'Sm1seazb4gs7RSlUVw7c', label: 'Anika', hint: 'Animated, Friendly and Engaging' },
  { value: 'P1bg08DkjqiVEzOn76yG', label: 'Viraj', hint: 'Rich and Soft' },
  { value: 'qDuRKMlYmrm8trt5QyBn', label: 'Taksh', hint: 'Calm, Serious and Smooth' },
  { value: 'qXpMhyvQqiRxWQs4qSSB', label: 'Horatius', hint: 'Energetic Character Voice' },
  { value: 'TX3LPaxmHKxFdv7VOQHJ', label: 'Liam', hint: 'Energetic, Social Media Creator' },
  { value: 'N2lVS1w4EtoT3dr4eOWO', label: 'Callum', hint: 'Husky Trickster' },
  { value: 'FGY2WhTYpPnrIDTdsKH5', label: 'Laura', hint: 'Enthusiast, Quirky Attitude' },
  { value: 'kPzsL2i3teMYv0FxEYQ6', label: 'Voice kPzsL2' },
  { value: 'UgBBYS2sOqTuMpoF3BR0', label: 'Mark', hint: 'Natural Conversations' },
  { value: 'hpp4J3VqNfWAUOO0d1Us', label: 'Bella', hint: 'Professional, Bright, Warm' },
  { value: 'nPczCjzI2devNBz1zQrb', label: 'Brian', hint: 'Deep, Resonant and Comforting' },
  { value: 'uYXf8XasLslADfZ2MB4u', label: 'Hope', hint: 'Bubbly, Gossipy and Girly' },
  { value: 'gs0tAILXbY5DNrJrsM6F', label: 'Jeff', hint: 'Classy, Resonating and Strong' },
  { value: 'DTKMou8ccj1ZaWGBiotd', label: 'Jamahal', hint: 'Young, Vibrant, and Natural' },
  { value: 'vBKc2FfBKJfcZNyEt1n6', label: 'Finn', hint: 'Youthful, Eager and Energetic' },
  { value: 'DYkrAHD8iwork3YSUBbs', label: 'Tom', hint: 'Conversations & Books' },
  { value: '56AoDkrOh6qfVPDXZ7Pt', label: 'Cassidy', hint: 'Crisp, Direct and Clear' },
  { value: 'eR40ATw9ArzDf9h3v7t7', label: 'Addison 2.0', hint: 'Australian Audiobook & Podcast' },
  { value: 'g6xIsTj2HwM6VR4iXFCw', label: 'Jessica Anne Bogart', hint: 'Chatty and Friendly' },
  { value: 'lcMyyd2HUfFzxdCaC4Ta', label: 'Lucy', hint: 'Fresh & Casual' },
  { value: '6aDn1KB0hjpdcocrUkmq', label: 'Tiffany', hint: 'Natural and Welcoming' },
  { value: 'Sq93GQT4X1lKDXsQcixO', label: 'Felix', hint: 'Warm, Positive & Contemporary RP' },
  { value: 'flHkNRp1BlvT73UL6gyz', label: 'Jessica Anne Bogart', hint: 'Eloquent Villain' },
  { value: '9yzdeviXkFddZ4Oz8Mok', label: 'Lutz', hint: 'Chuckling, Giggly and Cheerful' },
  { value: 'pPdl9cQBQq4p6mRkZy2Z', label: 'Emma', hint: 'Adorable and Upbeat' },
  { value: 'zYcjlYFOd3taleS0gkk3', label: 'Edward', hint: 'Loud, Confident and Cocky' },
  { value: 'nzeAacJi50IvxcyDnMXa', label: 'Marshal', hint: 'Friendly, Funny Professor' },
  { value: 'ruirxsoakN0GWmGNIo04', label: 'John Morgan', hint: 'Gritty, Rugged Cowboy' },
  { value: 'TC0Zp7WVFzhA8zpTlRqV', label: 'Aria', hint: 'Sultry Villain' },
  { value: 'ljo9gAlSqKOvF6D8sOsX', label: 'Viking Bjorn', hint: 'Epic Medieval Raider' },
  { value: 'PPzYpIqttlTYA83688JI', label: 'Voice PPzYpI' },
  { value: '8JVbfL6oEdmuxKn5DK2C', label: 'Johnny Kid', hint: 'Serious and Calm Narrator' },
  { value: 'iCrDUkL56s3C8sCRl7wb', label: 'Hope', hint: 'Poetic, Romantic and Captivating' },
  { value: 'wJqPPQ618aTW29mptyoc', label: 'Ana Rita', hint: 'Smooth, Expressive and Bright' },
  { value: 'EiNlNiXeDU1pqqOPrYMO', label: 'John Doe', hint: 'Deep' },
  { value: '4YYIPFl9wE5c4L2eu2Gb', label: 'Burt Reynolds™', hint: 'Deep, Smooth and Clear' },
  { value: '6F5Zhi321D3Oq7v1oNT4', label: 'Hank', hint: 'Deep and Engaging Narrator' },
  { value: 'YXpFCvM1S3JbWEJhoskW', label: 'Wyatt', hint: 'Wise Rustic Cowboy' },
  { value: 'LG95yZDEHg6fCZdQjLqj', label: 'Phil', hint: 'Explosive, Passionate Announcer' },
  { value: 'CeNX9CMwmxDxUF5Q2Inm', label: 'Johnny Dynamite', hint: 'Vintage Radio DJ' },
  { value: 'aD6riP1btT197c6dACmy', label: 'Rachel M', hint: 'Pro British Radio Presenter' },
  { value: 'mtrellq69YZsNwzUSyXh', label: 'Rex Thunder', hint: 'Deep N Tough' },
  { value: 'dHd5gvgSOzSfduK4CvEg', label: 'Ed', hint: 'Late Night Announcer' },
  { value: 'eVItLK1UvXctxuaRV2Oq', label: 'Jean', hint: 'Alluring and Playful Femme Fatale' },
  { value: 'esy0r39YPLQjOczyOib8', label: 'Britney', hint: 'Calm and Calculative Villain' },
  { value: 'Tsns2HvNFKfGiNjllgqo', label: 'Sven', hint: 'Emotional and Nice' },
  { value: '1U02n4nD6AdIZ9CjF053', label: 'Viraj', hint: 'Smooth and Gentle' },
  { value: 'AeRdCCKzvd23BpJoofzx', label: 'Nathaniel', hint: 'Engaging, British and Calm' },
  { value: 'LruHrtVF6PSyGItzMNHS', label: 'Benjamin', hint: 'Deep, Warm, Calming' },
  { value: '1wGbFxmAM3Fgw63G1zZJ', label: 'Allison', hint: 'Calm, Soothing and Meditative' },
  { value: 'hqfrgApggtO1785R4Fsn', label: 'Theodore HQ', hint: 'Serene and Grounded' },
  { value: 'MJ0RnG71ty4LH3dvNfSd', label: 'Voice MJ0RnG' },
]

export const elevenLabsVoice = (): SelectField => ({
  name: 'voice',
  kind: 'select',
  label: 'Voice',
  options: ELEVENLABS_VOICES,
  default: ELEVENLABS_VOICES[0].value,
})

/* ────────────────────────────────────────────────────────────────────────────
 * Language models
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * Standing instructions, separate from the prompt.
 *
 * Kept apart because the two change at different rates: the prompt is the
 * question of the moment, the system text is the role the model keeps for a
 * whole project.
 */
export const systemPrompt = (
  overrides: Partial<PromptField> = {},
): PromptField => ({
  name: 'system',
  kind: 'textarea',
  label: 'System instructions',
  description: 'Who the model is and how it should answer. Optional.',
  maxLength: 20000,
  placeholder: 'You are a senior copywriter working in French…',
  ...overrides,
})

/** How hard the model thinks before answering. */
export const reasoningEffort = (
  levels: string[],
  def = levels[levels.length - 1],
): SelectField => ({
  name: 'effort',
  kind: 'select',
  label: 'Reasoning effort',
  description: 'Higher is slower, and better on problems that need working out.',
  options: levels.map((value) => ({
    value,
    label: value.charAt(0).toUpperCase() + value.slice(1),
  })),
  default: def,
})

/** Lets the model look things up before answering. */
export const webSearchToggle = (): ToggleField => ({
  name: 'web_search',
  kind: 'toggle',
  label: 'Web search',
  description: 'Let the model look things up before it answers.',
  default: false,
})

export const maxTokens = (def = 8192, max = 64000): NumberField => ({
  name: 'max_tokens',
  kind: 'number',
  label: 'Answer length limit',
  description: 'Maximum tokens in the reply. Raise it for long documents.',
  min: 256,
  max,
  step: 256,
  default: def,
  advanced: true,
})

/* ────────────────────────────────────────────────────────────────────────────
 * Defaults & validation
 * ──────────────────────────────────────────────────────────────────────────*/

/** Build the initial form state for a field list. */
export function defaultsFor(fields: Field[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    switch (f.kind) {
      case 'prompt':
      case 'text':
      case 'textarea':
        out[f.name] = (f as PromptField).default ?? ''
        break
      case 'select':
      case 'ratio':
        out[f.name] = (f as SelectField).default ?? (f as SelectField).options[0]?.value ?? ''
        break
      case 'toggle':
        out[f.name] = (f as ToggleField).default ?? false
        break
      case 'number':
      case 'slider':
      case 'seed': {
        const n = f as NumberField
        out[f.name] = n.default ?? (n.kind === 'seed' ? '' : (n.min ?? 0))
        break
      }
      case 'images':
      case 'videos':
        out[f.name] = []
        break
      default:
        out[f.name] = ''
    }
  }
  return out
}

/** True when a conditional field should render given the current values. */
export function isVisible(f: Field, values: Record<string, unknown>): boolean {
  if (!f.showWhen) return true
  return f.showWhen.equals.includes(values[f.showWhen.field])
}

/**
 * Strip empty values and coerce types so the request body matches what each
 * model expects. Kie rejects `""` where it expects a number or a URI, so
 * blanks are dropped rather than sent.
 */
export function buildInput(
  fields: Field[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const input: Record<string, unknown> = {}

  for (const f of fields) {
    if (!isVisible(f, values)) continue
    const raw = values[f.name]

    switch (f.kind) {
      case 'prompt':
      case 'text':
      case 'textarea': {
        const s = typeof raw === 'string' ? raw.trim() : ''
        if (s) input[f.name] = s
        break
      }
      case 'select':
      case 'ratio': {
        if (typeof raw !== 'string' || !raw) break
        const select = f as SelectField
        if (select.asNumber) {
          const n = Number(raw)
          if (!Number.isNaN(n)) input[f.name] = n
          break
        }
        input[f.name] = raw
        break
      }
      case 'toggle': {
        // Booleans are always sent, `false` is meaningful.
        input[f.name] = Boolean(raw)
        break
      }
      case 'number':
      case 'slider':
      case 'seed': {
        if (raw === '' || raw === null || raw === undefined) break
        const n = Number(raw)
        if (Number.isNaN(n)) break
        input[f.name] = (f as NumberField).asString ? String(n) : n
        break
      }
      case 'images':
      case 'videos': {
        const arr = Array.isArray(raw) ? raw.filter(Boolean) : []
        if (arr.length) input[f.name] = arr
        break
      }
      case 'image':
      case 'audio':
      case 'video': {
        if (typeof raw === 'string' && raw.trim()) input[f.name] = raw.trim()
        break
      }
    }
  }

  return input
}

/** Returns a list of human-readable problems, empty when the form is valid. */
export function validate(
  fields: Field[],
  values: Record<string, unknown>,
): string[] {
  const errors: string[] = []

  for (const f of fields) {
    if (!f.required || !isVisible(f, values)) continue
    const raw = values[f.name]

    const empty =
      raw === undefined ||
      raw === null ||
      (typeof raw === 'string' && !raw.trim()) ||
      (Array.isArray(raw) && raw.length === 0)

    if (empty) {
      errors.push(`${f.label} is required.`)
      continue
    }

    if (
      (f.kind === 'prompt' || f.kind === 'text' || f.kind === 'textarea') &&
      typeof raw === 'string'
    ) {
      const max = (f as PromptField).maxLength
      if (max && raw.length > max) {
        errors.push(`${f.label} exceeds ${max} characters (${raw.length}).`)
      }
    }
  }

  return errors
}
