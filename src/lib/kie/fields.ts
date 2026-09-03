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
        if (typeof raw === 'string' && raw) input[f.name] = raw
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
