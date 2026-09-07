/**
 * Turn Kie's schemas into catalog entries.
 *
 *   bun --preload ./scripts/preload.ts scripts/generate-models.mts > out.ts
 *
 * Every model in the catalog used to be transcribed from a documentation page
 * by hand, which is how four ended up with a slug Kie has never heard of and
 * ten more sent fields that do not exist. Deriving the fields from the schema
 * removes that whole class of mistake: the enums, defaults, bounds and
 * required flags come from the same document the API validates against.
 *
 * What it cannot derive is the part that is a judgement: the name people read,
 * the family, the one-line description of what a model is good at. Those are
 * curated in `scripts/curation.json`, and anything missing falls back to
 * something honest rather than invented.
 */

import { readFileSync } from 'node:fs'

interface FieldSpec {
  type?: string
  enum?: (string | number)[]
  default?: unknown
  minimum?: number
  maximum?: number
  maxLength?: number
  maxItems?: number
  description?: string
  items?: { type?: string }
}

interface ModelSpec {
  doc: string
  path: string
  title: string
  summary: string
  description: string
  required: string[]
  fields: Record<string, FieldSpec>
}

const schemas = JSON.parse(
  readFileSync(new URL('./kie/schemas.json', import.meta.url), 'utf8'),
) as Record<string, ModelSpec>

const curation = JSON.parse(
  readFileSync(new URL('./curation.json', import.meta.url), 'utf8'),
) as Record<
  string,
  {
    name?: string
    family?: string
    category?: string
    mode?: string
    output?: string
    tagline?: string
    speed?: string
    featured?: boolean
    badges?: string[]
  }
>

/* ────────────────────────────────────────────────────────────────────────────
 * Guessing the shape of a model
 * ──────────────────────────────────────────────────────────────────────────*/

/** Fields that mean "this takes a picture in". */
const IMAGE_INPUTS = new Set([
  'image_url', 'image_urls', 'input_urls', 'input_image_urls', 'first_frame_url',
  'last_frame_url', 'reference_image_urls', 'reference_image', 'reference_images',
  'image_input', 'subject_image_url', 'character_image_url', 'start_image_url',
  'end_image_url',
])

const VIDEO_INPUTS = new Set([
  'video_url', 'video_urls', 'input_video_url', 'driving_video_url', 'first_clip_url',
])

const AUDIO_INPUTS = new Set([
  'audio_url', 'audio_urls', 'driving_audio_url', 'voice_audio_url',
])

function guessOutput(slug: string, spec: ModelSpec): string {
  const s = `${slug} ${spec.path}`.toLowerCase()
  const names = Object.keys(spec.fields)

  if (/video|animate|lip-sync|motion|clip/.test(s)) return 'video'

  // A duration alongside a resolution or a soundtrack switch means output
  // that runs in time. `kling-3.0-omni/transformation` says nothing about
  // video in its name and takes clips in and puts clips out.
  const timed =
    names.includes('duration') &&
    names.some((n) => ['resolution', 'aspect_ratio', 'audio', 'video_urls'].includes(n))
  if (timed) return 'video'

  if (/tts|speech|voice|audio|music|dialogue/.test(s)) return 'audio'
  return 'image'
}

function guessMode(slug: string, spec: ModelSpec, output: string): string {
  // Only the inputs a model demands. An optional reference on a
  // text-to-image model does not make it an image-to-image one, and the
  // studio filters by this.
  const names = spec.required.length
    ? spec.required
    : Object.keys(spec.fields)
  const hasImage = names.some((n) => IMAGE_INPUTS.has(n))
  const hasVideo = names.some((n) => VIDEO_INPUTS.has(n))
  const hasAudio = names.some((n) => AUDIO_INPUTS.has(n))

  if (output === 'video') {
    if (hasVideo) return 'video-to-video'
    if (hasAudio) return 'audio-to-video'
    if (hasImage) return 'image-to-video'
    return 'text-to-video'
  }
  if (output === 'audio') return 'text-to-audio'
  if (hasImage) return 'image-to-image'
  return 'text-to-image'
}

function guessCategory(output: string, slug: string): string {
  if (/upscale|remove-background|isolation|decomposition|detection|identification/.test(slug)) {
    return 'utility'
  }
  return output === 'audio' ? 'audio' : output === 'video' ? 'video' : 'image'
}

/** "wan/2-5-image-to-video" -> "Wan". */
function guessFamily(slug: string): string {
  const head = slug.split('/')[0]
  const known: Record<string, string> = {
    wan: 'Alibaba', qwen: 'Alibaba', qwen2: 'Alibaba', qwen3: 'Alibaba',
    'qwen3-pro': 'Alibaba', bytedance: 'ByteDance', seedream: 'ByteDance',
    seedance: 'ByteDance', kling: 'Kuaishou', google: 'Google', gemini: 'Google',
    'nano-banana-pro': 'Google', 'nano-banana-2-lite': 'Google',
    ideogram: 'Ideogram', elevenlabs: 'ElevenLabs', topaz: 'Topaz',
    recraft: 'Recraft', hailuo: 'MiniMax', 'minimax-h3': 'MiniMax',
    flux: 'Black Forest Labs', 'flux-2': 'Black Forest Labs', gpt: 'OpenAI',
    'gpt-image': 'OpenAI', grok: 'xAI', omnihuman: 'ByteDance',
    infinitalk: 'InfiniTalk', pixverse: 'PixVerse', 'pixverse-v6': 'PixVerse',
    happyhorse: 'HappyHorse', volcengine: 'Volcengine',
  }
  for (const [prefix, family] of Object.entries(known)) {
    if (head === prefix || head.startsWith(`${prefix}-`) || head.startsWith(`${prefix}.`)) {
      return family
    }
  }
  return head.split(/[-.]/)[0].replace(/^./, (c) => c.toUpperCase())
}

/** A readable name when the doc title is missing or unhelpful. */
function guessName(slug: string, spec: ModelSpec): string {
  // "Google - Nano Banana Pro" reads as "Nano Banana Pro" once the family is
  // shown beside it, and "(openai)" is a routing detail.
  const title = spec.title
    .replace(/^[A-Za-z ]{3,18}\s+[-–]\s+/, '')
    .replace(/\s*\((openai|response|beta|v\d[\w.]*)\)\s*$/i, '')
    .trim()

  if (title && !/^#/.test(title) && title.length < 48) return title

  return slug
    .split('/')
    .pop()!
    .split(/[-_.]/)
    .map((p) => (/^\d/.test(p) ? p : p.replace(/^./, (c) => c.toUpperCase())))
    .join(' ')
}

/**
 * Openings that say nothing about the model.
 *
 * Most pages begin with the same boilerplate about creating and polling a
 * task, which is true of every model here and therefore worth saying about
 * none of them.
 */
const BOILERPLATE =
  /^(query task status|create task|content generation using|api reference|overview\b)/i

const MODE_WORDS: Record<string, string> = {
  'text-to-image': 'Text to image',
  'image-to-image': 'Image editing',
  'text-to-video': 'Text to video',
  'image-to-video': 'Image to video',
  'video-to-video': 'Video to video',
  'audio-to-video': 'Audio to video',
  'text-to-audio': 'Text to speech',
  enhance: 'Enhancement',
}

/**
 * One line on what a model is for.
 *
 * The page's own description when it says something, since a borrowed
 * accurate line beats an invented one. Otherwise built from the schema:
 * what it takes in, what resolutions and durations it offers. Dull, but
 * every word of it is true, which a generated sales line would not be.
 */
function tagline(spec: ModelSpec, name: string, mode: string): string {
  // The prose runs straight into the boilerplate about polling a task, with
  // no full stop between them, so the description is cut at that seam before
  // the first sentence is taken.
  const source = (spec.description || spec.summary || '')
    .split(/\b(?:Query Task Status|Create Task|API Reference)\b/)[0]
    .trim()

  const first = source.split(/(?<=[.!])\s/)[0]?.trim() ?? ''

  if (first.length >= 24 && first.length <= 200 && !BOILERPLATE.test(first)) {
    if (first.length <= 96) return first
    const cut = first.slice(0, 93)
    return `${cut.slice(0, cut.lastIndexOf(' '))}…`
  }

  const bits: string[] = [MODE_WORDS[mode] ?? 'Generation']

  // Resolution and size read as a ceiling. A `quality` of "basic, high,
  // ultra" does not: "up to high" is not a sentence.
  const res = spec.fields.resolution ?? spec.fields.size
  const values = (res?.enum ?? []).map(String).filter((v) => /\d/.test(v))
  if (values.length) bits.push(`up to ${values[values.length - 1]}`)

  const duration = spec.fields.duration
  const range = (duration?.enum ?? []).map(String)
  if (range.length > 1) bits.push(`${range[0]} to ${range[range.length - 1]}s`)
  else if (duration?.minimum !== undefined && duration.maximum !== undefined) {
    bits.push(`${duration.minimum} to ${duration.maximum}s`)
  }

  return `${bits.join(', ')}.`
}

/* ────────────────────────────────────────────────────────────────────────────
 * Fields
 * ──────────────────────────────────────────────────────────────────────────*/

const label = (name: string) =>
  name
    .replace(/_/g, ' ')
    .replace(/\burls?\b/i, '')
    .trim()
    .replace(/^./, (c) => c.toUpperCase()) || name

/** Descriptions in the docs are prose; keep the first sentence. */
function hint(spec: FieldSpec): string | undefined {
  const d = spec.description
  if (!d) return undefined
  const first = d.split(/(?<=\.)\s/)[0].trim()
  return first.length > 4 && first.length < 150 ? first : undefined
}

const q = (v: string) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

function fieldFor(name: string, spec: FieldSpec, required: boolean): string | null {
  const parts: string[] = [`name: ${q(name)}`]
  const desc = hint(spec)
  const isImage = IMAGE_INPUTS.has(name)
  const isVideo = VIDEO_INPUTS.has(name)
  const isAudio = AUDIO_INPUTS.has(name)
  const many = spec.type === 'array'

  if (isImage || isVideo || isAudio) {
    const kind = isAudio ? 'audio' : isVideo ? (many ? 'videos' : 'video') : many ? 'images' : 'image'
    parts.push(`kind: '${kind}'`, `label: ${q(label(name))}`)
    if (required) parts.push('required: true')
    if (many && spec.maxItems) parts.push(`maxItems: ${spec.maxItems}`)
    parts.push(
      `accepts: ${q(isAudio ? 'MP3, WAV, M4A' : isVideo ? 'MP4, MOV, WebM' : 'JPEG, PNG, WebP')}`,
      `maxSizeMb: ${isAudio ? 100 : isVideo ? 200 : 20}`,
    )
  } else if (name === 'prompt' || name === 'text') {
    parts.push(`kind: 'prompt'`, `label: ${q(name === 'text' ? 'Script' : 'Prompt')}`)
    if (required) parts.push('required: true')
    if (spec.maxLength) parts.push(`maxLength: ${spec.maxLength}`)
  } else if (name === 'negative_prompt') {
    parts.push(`kind: 'textarea'`, `label: 'Negative prompt'`, 'advanced: true')
    if (spec.maxLength) parts.push(`maxLength: ${spec.maxLength}`)
  } else if (spec.enum?.length) {
    const kind = name === 'aspect_ratio' ? 'ratio' : 'select'
    parts.push(`kind: '${kind}'`, `label: ${q(label(name))}`)
    parts.push(`options: opts(${spec.enum.map((v) => q(String(v))).join(', ')})`)
    const def = spec.default ?? spec.enum[0]
    parts.push(`default: ${q(String(def))}`)
    // A menu of numbers still has to leave as a number.
    if (spec.type === 'integer' || spec.type === 'number') parts.push('asNumber: true')
  } else if (spec.type === 'boolean') {
    parts.push(`kind: 'toggle'`, `label: ${q(label(name))}`)
    parts.push(`default: ${spec.default === true}`)
    parts.push('advanced: true')
  } else if (spec.type === 'integer' || spec.type === 'number') {
    if (name === 'seed') return '      seed(),'
    const bounded = spec.minimum !== undefined && spec.maximum !== undefined
    parts.push(`kind: '${bounded ? 'slider' : 'number'}'`, `label: ${q(label(name))}`)
    if (spec.minimum !== undefined) parts.push(`min: ${spec.minimum}`)
    if (spec.maximum !== undefined) parts.push(`max: ${spec.maximum}`)
    parts.push('step: 1')

    // A required number needs a value in the file rather than one implied by
    // `defaultsFor`, so what gets submitted is readable here.
    const fallback =
      typeof spec.default === 'number'
        ? spec.default
        : required
          ? (spec.minimum ?? 1)
          : undefined
    if (fallback !== undefined) parts.push(`default: ${fallback}`)
  } else if (spec.type === 'string') {
    parts.push(`kind: 'text'`, `label: ${q(label(name))}`)
    if (required) parts.push('required: true')
    if (spec.maxLength) parts.push(`maxLength: ${spec.maxLength}`)
  } else {
    // An array of objects, or something with no type at all. A form cannot
    // ask for it sensibly, and guessing would produce a control that submits
    // the wrong shape.
    return null
  }

  if (desc) parts.push(`description: ${q(desc)}`)

  return `      {\n${parts.map((p) => `        ${p},`).join('\n')}\n      },`
}

/* ────────────────────────────────────────────────────────────────────────────
 * Output
 * ──────────────────────────────────────────────────────────────────────────*/

const wanted = process.argv.slice(2)
const slugs = (wanted.length ? wanted : Object.keys(schemas)).sort()

const entries: string[] = []
const skipped: string[] = []

for (const slug of slugs) {
  const spec = schemas[slug]
  if (!spec) {
    skipped.push(`${slug}: no schema`)
    continue
  }

  const c = curation[slug] ?? {}
  const output = c.output ?? guessOutput(slug, spec)
  const mode = c.mode ?? guessMode(slug, spec, output)
  const category = c.category ?? guessCategory(output, slug)
  const family = c.family ?? guessFamily(slug)
  const name = c.name ?? guessName(slug, spec)

  const required = new Set(spec.required)
  const fields: string[] = []
  let unsupported = false

  // Prompt first, then inputs, then the rest: the order a person fills it in.
  const order = Object.keys(spec.fields).sort((a, b) => {
    const rank = (n: string) =>
      n === 'prompt' || n === 'text' ? 0
      : IMAGE_INPUTS.has(n) || VIDEO_INPUTS.has(n) || AUDIO_INPUTS.has(n) ? 1
      : 2
    return rank(a) - rank(b) || a.localeCompare(b)
  })

  for (const fname of order) {
    const rendered = fieldFor(fname, spec.fields[fname], required.has(fname))
    if (!rendered) {
      if (required.has(fname)) unsupported = true
      continue
    }
    fields.push(rendered)
  }

  if (unsupported) {
    skipped.push(`${slug}: a required field has no form control`)
    continue
  }

  entries.push(
    [
      '  {',
      `    id: ${q(slug)},`,
      `    name: ${q(name)},`,
      `    family: ${q(family)},`,
      `    category: '${category}',`,
      `    mode: '${mode}',`,
      `    api: 'market',`,
      `    output: '${output}',`,
      `    tagline: ${q(c.tagline ?? tagline(spec, name, mode))},`,
      `    speed: '${c.speed ?? 'balanced'}',`,
      ...(c.badges?.length ? [`    badges: [${c.badges.map(q).join(', ')}],`] : []),
      ...(c.featured ? ['    featured: true,'] : []),
      '    fields: [',
      ...fields,
      '    ],',
      '  },',
    ].join('\n'),
  )
}

console.log(entries.join('\n'))
console.error(`\n${entries.length} generated, ${skipped.length} skipped`)
for (const s of skipped) console.error(`  ${s}`)
