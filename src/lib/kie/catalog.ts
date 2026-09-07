/**
 * Model catalog.
 *
 * Each entry maps a Kie.ai model to the fields the studio should render.
 * Schemas here mirror https://docs.kie.ai, field names, enums and defaults
 * are the ones the API actually accepts.
 *
 * `api` selects the transport:
 *   'market' → POST /api/v1/jobs/createTask  (the unified job API)
 *   'veo'    → POST /api/v1/veo/generate
 *   'suno'   → POST /api/v1/generate
 */

import type { ChatEndpoint } from './chat-types'
import { GENERATED } from './catalog.generated'
import {
  type Field,
  audioUrl,
  elevenLabsVoice,
  imageUrl,
  imageUrls,
  maxTokens,
  negativePrompt,
  nsfwChecker,
  opts,
  optionalReference,
  outputFormat,
  prompt,
  ratio,
  reasoningEffort,
  resolution,
  seed,
  systemPrompt,
  webSearchToggle,
} from './fields'

export type ModelCategory = 'image' | 'video' | 'audio' | 'text' | 'utility'

export type ModelApi = 'market' | 'veo' | 'suno' | 'chat'

/** What the model consumes, used for filtering and for empty-state copy. */
export type ModelMode =
  | 'text-to-image'
  | 'image-to-image'
  | 'text-to-video'
  | 'image-to-video'
  | 'video-to-video'
  | 'text-to-audio'
  | 'audio-to-video'
  | 'text-to-text'
  | 'enhance'

export interface ModelDef {
  /** Exact `model` string sent to Kie. Also the catalog primary key. */
  id: string
  name: string
  /** Vendor label, e.g. "Google", "ByteDance". */
  family: string
  category: ModelCategory
  mode: ModelMode
  api: ModelApi
  tagline: string
  /** Rough cost/speed signal for the UI. Not billed values. */
  speed: 'fast' | 'balanced' | 'slow'
  fields: Field[]
  /** Surfaced on the model card. */
  badges?: string[]
  /** Featured models lead the picker. */
  featured?: boolean
  /** Media type the result is rendered as. */
  output: 'image' | 'video' | 'audio' | 'text'

  /**
   * Where to send a language model's request.
   *
   * Present only when `api` is 'chat'. Those models answer in the request
   * rather than through the job API, and each vendor keeps its own wire
   * format, so the descriptor says which one and where.
   */
  chat?: ChatEndpoint

  /**
   * Where to submit when the optional reference field holds something.
   *
   * Kie splits several models into two slugs, one for text-only input and one
   * that takes a reference, and a request sent to the wrong one is rejected.
   * Making the user pick the right slug means making them learn an API detail,
   * so the reference field is offered on the text variant and the submission
   * is routed here when it is filled.
   *
   * The input is rebuilt against the target model's own fields, which drops
   * anything it does not accept. Kling, for instance, takes an aspect ratio
   * for text-to-video but derives it from the image otherwise.
   */
  routeWithAssets?: {
    modelId: string
    /** Field on this model holding the references. */
    from: string
    /** Field on the target model that receives them. */
    to: string
  }

  /**
   * Kept out of the model picker.
   *
   * Used for a variant reachable by routing, so the list shows one entry per
   * model rather than one per Kie slug.
   */
  hidden?: boolean
}

/* ────────────────────────────────────────────────────────────────────────────
 * IMAGE, text to image
 * ──────────────────────────────────────────────────────────────────────────*/

const IMAGE_TEXT: ModelDef[] = [
  {
    id: 'nano-banana-2',
    name: 'Nano Banana 2',
    family: 'Google',
    category: 'image',
    mode: 'text-to-image',
    api: 'market',
    output: 'image',
    tagline: 'Gemini-grade reasoning, native 4K, flawless text rendering.',
    speed: 'balanced',
    featured: true,
    badges: ['4K', 'Text-safe'],
    fields: [
      prompt({ maxLength: 20000 }),
      {
        ...imageUrls(14, {
          name: 'image_input',
          label: 'Reference images',
          required: false,
          maxSizeMb: 30,
          description: 'Optional. Up to 14 references to condition the render.',
        }),
      },
      ratio(
        ['auto', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9', '1:4', '4:1', '1:8', '8:1'],
        'auto',
      ),
      resolution(['1K', '2K', '4K'], '1K'),
      outputFormat(['png', 'jpg'], 'png'),
    ],
  },
  {
    id: 'google/nano-banana',
    name: 'Nano Banana',
    family: 'Google',
    category: 'image',
    mode: 'text-to-image',
    api: 'market',
    output: 'image',
    tagline: 'The fast, characterful workhorse. Great at stylised scenes.',
    speed: 'fast',
    featured: true,
    fields: [
      prompt({ maxLength: 5000 }),
      ratio(
        ['1:1', '9:16', '16:9', '3:4', '4:3', '3:2', '2:3', '5:4', '4:5', '21:9', 'auto'],
        '1:1',
      ),
      outputFormat(['png', 'jpeg'], 'png'),
      nsfwChecker(),
    ],
  },
  {
    id: 'seedream/5-pro-text-to-image',
    name: 'Seedream 5 Pro',
    family: 'ByteDance',
    category: 'image',
    mode: 'text-to-image',
    api: 'market',
    output: 'image',
    tagline: 'Photoreal composition with exceptional prompt adherence.',
    speed: 'balanced',
    featured: true,
    badges: ['2K'],
    routeWithAssets: {
      modelId: 'seedream/5-pro-image-to-image',
      from: 'reference_images',
      to: 'image_urls',
    },
    fields: [
      prompt({ maxLength: 5000 }),
      optionalReference(10, {
        label: 'Reference images',
        description:
          'Optional. Adding one guides the result instead of generating from the prompt alone.',
      }),
      ratio(['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'], '1:1'),
      {
        name: 'quality',
        kind: 'select',
        label: 'Quality',
        options: [
          { value: 'basic', label: 'Basic', hint: '1K output' },
          { value: 'high', label: 'High', hint: '2K output' },
        ],
        default: 'basic',
      },
      outputFormat(),
      nsfwChecker(),
    ],
  },
  {
    id: 'seedream/5-lite-text-to-image',
    name: 'Seedream 5 Lite',
    family: 'ByteDance',
    category: 'image',
    mode: 'text-to-image',
    api: 'market',
    output: 'image',
    tagline: 'Seedream quality at draft speed and cost.',
    speed: 'fast',
    fields: [
      prompt({ maxLength: 5000 }),
      ratio(['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'], '1:1'),
      {
        name: 'quality',
        kind: 'select',
        label: 'Quality',
        options: opts('basic', 'high', 'ultra'),
        default: 'basic',
      },
      outputFormat(),
      nsfwChecker(),
    ],
  },
  {
    id: 'bytedance/seedream-v4-text-to-image',
    name: 'Seedream 4',
    family: 'ByteDance',
    category: 'image',
    mode: 'text-to-image',
    api: 'market',
    output: 'image',
    tagline: 'Batch-friendly generation with up to 6 variants per run.',
    speed: 'balanced',
    fields: [
      prompt({ maxLength: 5000 }),
      {
        name: 'image_size',
        kind: 'select',
        label: 'Size preset',
        options: opts(
          'square', 'square_hd', 'portrait_4_3', 'portrait_3_2', 'portrait_16_9',
          'landscape_4_3', 'landscape_3_2', 'landscape_16_9', 'landscape_21_9',
        ),
        default: 'square_hd',
      },
      {
        name: 'image_resolution',
        kind: 'select',
        label: 'Resolution',
        options: opts('1K', '2K', '4K'),
        default: '1K',
      },
      {
        name: 'max_images',
        kind: 'number',
        label: 'Images per run',
        min: 1,
        max: 6,
        step: 1,
        default: 1,
      },
      seed(),
      nsfwChecker(),
    ],
  },
  {
    id: 'z-image',
    name: 'Z-Image',
    family: 'Tongyi',
    category: 'image',
    mode: 'text-to-image',
    api: 'market',
    output: 'image',
    tagline: 'Uncannily photographic. Excels at candid, natural light.',
    speed: 'fast',
    featured: true,
    fields: [
      prompt({ maxLength: 1000 }),
      ratio(['1:1', '4:3', '3:4', '16:9', '9:16'], '1:1'),
      nsfwChecker(),
    ],
  },
  {
    id: 'flux-2/pro-text-to-image',
    name: 'FLUX.2 Pro',
    family: 'Black Forest Labs',
    category: 'image',
    mode: 'text-to-image',
    api: 'market',
    output: 'image',
    tagline: 'Hyperreal materials, typography and product renders.',
    speed: 'balanced',
    featured: true,
    routeWithAssets: {
      modelId: 'flux-2/pro-image-to-image',
      from: 'reference_images',
      to: 'input_urls',
    },
    fields: [
      prompt({ maxLength: 5000 }),
      optionalReference(10, {
        label: 'Reference images',
        description:
          'Optional. Adding one guides the result instead of generating from the prompt alone.',
      }),
      ratio(['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'], '1:1'),
      resolution(['1K', '2K'], '1K'),
      nsfwChecker(),
    ],
  },
  {
    id: 'flux-2/flex-text-to-image',
    name: 'FLUX.2 Flex',
    family: 'Black Forest Labs',
    category: 'image',
    mode: 'text-to-image',
    api: 'market',
    output: 'image',
    tagline: 'Tunable FLUX.2, trade steps for speed.',
    speed: 'fast',
    fields: [
      prompt({ maxLength: 5000 }),
      ratio(['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'], '1:1'),
      resolution(['1K', '2K'], '1K'),
      nsfwChecker(),
    ],
  },
  {
    id: 'gpt-image-2-text-to-image',
    name: 'GPT Image 2',
    family: 'OpenAI',
    category: 'image',
    mode: 'text-to-image',
    api: 'market',
    output: 'image',
    tagline: 'Instruction-following that reads long, precise briefs.',
    speed: 'balanced',
    featured: true,
    badges: ['4K'],
    routeWithAssets: {
      modelId: 'gpt-image-2-image-to-image',
      from: 'reference_images',
      to: 'input_urls',
    },
    fields: [
      prompt({ maxLength: 20000 }),
      optionalReference(10, {
        label: 'Reference images',
        description:
          'Optional. Adding one guides the result instead of generating from the prompt alone.',
      }),
      ratio(
        ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21'],
        'auto',
      ),
      resolution(['1K', '2K', '4K'], '1K'),
    ],
  },
  {
    id: 'gpt-image/1.5-text-to-image',
    name: 'GPT Image 1.5',
    family: 'OpenAI',
    category: 'image',
    mode: 'text-to-image',
    api: 'market',
    output: 'image',
    tagline: 'The previous generation, still excellent at diagrams and UI.',
    speed: 'balanced',
    fields: [
      prompt({ maxLength: 5000 }),
      ratio(['1:1', '2:3', '3:2'], '1:1'),
      {
        name: 'quality',
        kind: 'select',
        label: 'Quality',
        options: opts('medium', 'high'),
        default: 'medium',
      },
    ],
  },
  {
    id: 'qwen3/text-to-image',
    name: 'Qwen 3 Image',
    family: 'Alibaba',
    category: 'image',
    mode: 'text-to-image',
    api: 'market',
    output: 'image',
    tagline: 'Strong bilingual text rendering, CJK included.',
    speed: 'fast',
    routeWithAssets: {
      modelId: 'qwen3/image-to-image',
      from: 'reference_images',
      to: 'image_urls',
    },
    fields: [
      prompt({ maxLength: 5000 }),
      optionalReference(3, {
        label: 'Reference images',
        description:
          'Optional. Adding one guides the result instead of generating from the prompt alone.',
      }),
      {
        name: 'image_size',
        kind: 'ratio',
        label: 'Aspect ratio',
        options: opts('1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'),
        default: '16:9',
      },
      resolution(['1K', '2K'], '1K'),
      negativePrompt({ maxLength: 5000 }),
      {
        name: 'prompt_extend',
        kind: 'toggle',
        label: 'Prompt rewriting',
        description: 'Let the model expand a short prompt.',
        default: true,
        advanced: true,
      },
      outputFormat(),
      seed({ default: undefined }),
      nsfwChecker(),
    ],
  },
  {
    id: 'ideogram/v3-text-to-image',
    name: 'Ideogram V3',
    family: 'Ideogram',
    category: 'image',
    mode: 'text-to-image',
    api: 'market',
    output: 'image',
    tagline: 'Best-in-class poster typography and logo lockups.',
    speed: 'balanced',
    fields: [
      prompt({ maxLength: 5000 }),
      {
        name: 'rendering_speed',
        kind: 'select',
        label: 'Rendering',
        options: opts('TURBO', 'BALANCED', 'QUALITY'),
        default: 'BALANCED',
      },
      {
        name: 'style',
        kind: 'select',
        label: 'Style',
        options: opts('AUTO', 'GENERAL', 'REALISTIC', 'DESIGN'),
        default: 'AUTO',
      },
      {
        name: 'image_size',
        kind: 'select',
        label: 'Size preset',
        options: opts(
          'square', 'square_hd', 'portrait_4_3', 'portrait_16_9',
          'landscape_4_3', 'landscape_16_9',
        ),
        default: 'square_hd',
      },
      // No `num_images` here, deliberately. Ideogram's character and remix
      // endpoints take one; this one's documented schema does not, and a
      // field promising four variants that the endpoint has never heard of
      // either returns a single image or fails the whole request. Use the
      // run count in the composer for variations instead.
      {
        name: 'expand_prompt',
        kind: 'toggle',
        label: 'MagicPrompt',
        default: true,
        advanced: true,
      },
      negativePrompt({ maxLength: 5000 }),
      seed(),
    ],
  },
  {
    id: 'google/imagen4',
    name: 'Imagen 4',
    family: 'Google',
    category: 'image',
    mode: 'text-to-image',
    api: 'market',
    output: 'image',
    tagline: 'Google’s photographic flagship.',
    speed: 'balanced',
    fields: [
      prompt({ maxLength: 5000 }),
      ratio(['1:1', '16:9', '9:16', '3:4', '4:3'], '1:1'),
      negativePrompt(),
      seed(),
    ],
  },
  {
    id: 'google/imagen4-ultra',
    name: 'Imagen 4 Ultra',
    family: 'Google',
    category: 'image',
    mode: 'text-to-image',
    api: 'market',
    output: 'image',
    tagline: 'Maximum fidelity Imagen tier.',
    speed: 'slow',
    fields: [
      prompt({ maxLength: 5000 }),
      ratio(['1:1', '16:9', '9:16', '3:4', '4:3'], '1:1'),
      negativePrompt(),
      seed(),
    ],
  },
  {
    id: 'grok-imagine-image-2-0/text-to-image',
    name: 'Grok Imagine 2',
    family: 'xAI',
    category: 'image',
    mode: 'text-to-image',
    api: 'market',
    output: 'image',
    tagline: 'Bold, meme-fluent visual style.',
    speed: 'fast',
    fields: [
      prompt({ maxLength: 5000 }),
      ratio(['1:1', '2:3', '3:2', '16:9', '9:16'], '1:1'),
    ],
  },
]

/* ────────────────────────────────────────────────────────────────────────────
 * IMAGE, image to image / editing
 * ──────────────────────────────────────────────────────────────────────────*/

const IMAGE_EDIT: ModelDef[] = [
  {
    id: 'google/nano-banana-edit',
    name: 'Nano Banana Edit',
    family: 'Google',
    category: 'image',
    mode: 'image-to-image',
    api: 'market',
    output: 'image',
    tagline: 'Conversational editing that respects the original scene.',
    speed: 'fast',
    featured: true,
    fields: [
      prompt({
        maxLength: 5000,
        placeholder: 'Describe the edit, “put her in a red coat, keep the pose”…',
      }),
      imageUrls(10),
      ratio(
        ['1:1', '9:16', '16:9', '3:4', '4:3', '3:2', '2:3', '5:4', '4:5', '21:9', 'auto'],
        '1:1',
      ),
      outputFormat(['png', 'jpeg'], 'png'),
    ],
  },
  {
    id: 'seedream/5-pro-image-to-image',
    name: 'Seedream 5 Pro Edit',
    family: 'ByteDance',
    category: 'image',
    mode: 'image-to-image',
    api: 'market',
    output: 'image',
    tagline: 'Material and lighting transfer with structural fidelity.',
    speed: 'balanced',
    featured: true,
    hidden: true,
    fields: [
      prompt({ maxLength: 5000 }),
      imageUrls(10, { maxSizeMb: 30 }),
      ratio(['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'], '1:1'),
      {
        name: 'quality',
        kind: 'select',
        label: 'Quality',
        options: [
          { value: 'basic', label: 'Basic', hint: '1K output' },
          { value: 'high', label: 'High', hint: '2K output' },
        ],
        default: 'basic',
      },
      outputFormat(),
      nsfwChecker(),
    ],
  },
  {
    id: 'bytedance/seedream-v4-edit',
    name: 'Seedream 4 Edit',
    family: 'ByteDance',
    category: 'image',
    mode: 'image-to-image',
    api: 'market',
    output: 'image',
    tagline: 'Brand-kit style edits across multiple references.',
    speed: 'balanced',
    fields: [
      prompt({ maxLength: 5000 }),
      imageUrls(10),
      {
        name: 'image_size',
        kind: 'select',
        label: 'Size preset',
        options: opts(
          'square', 'square_hd', 'portrait_4_3', 'portrait_3_2', 'portrait_16_9',
          'landscape_4_3', 'landscape_3_2', 'landscape_16_9', 'landscape_21_9',
        ),
        default: 'square_hd',
      },
      {
        name: 'image_resolution',
        kind: 'select',
        label: 'Resolution',
        options: opts('1K', '2K', '4K'),
        default: '1K',
      },
      {
        name: 'max_images',
        kind: 'number',
        label: 'Images per run',
        min: 1,
        max: 6,
        step: 1,
        default: 1,
      },
      seed(),
      nsfwChecker(),
    ],
  },
  {
    id: 'gpt-image-2-image-to-image',
    name: 'GPT Image 2 Edit',
    family: 'OpenAI',
    category: 'image',
    mode: 'image-to-image',
    api: 'market',
    output: 'image',
    tagline: 'Precise, instruction-driven retouching.',
    speed: 'balanced',
    hidden: true,
    fields: [
      prompt({ maxLength: 20000 }),
      imageUrls(10, {
        name: 'input_urls',
        label: 'Source images',
        maxSizeMb: 30,
      }),
      ratio(
        ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21'],
        'auto',
      ),
      resolution(['1K', '2K', '4K'], '1K'),
      {
        name: 'background',
        kind: 'select',
        label: 'Background',
        options: opts('auto', 'transparent', 'opaque'),
        default: 'auto',
        advanced: true,
      },
    ],
  },
  {
    id: 'flux-2/pro-image-to-image',
    name: 'FLUX.2 Pro Edit',
    family: 'Black Forest Labs',
    category: 'image',
    mode: 'image-to-image',
    api: 'market',
    output: 'image',
    tagline: 'Photoreal edits that hold material detail.',
    speed: 'balanced',
    hidden: true,
    fields: [
      prompt({ maxLength: 5000 }),
      imageUrls(10, {
        name: 'input_urls',
        label: 'Source images',
        maxSizeMb: 20,
      }),
      ratio(['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', 'auto'], '1:1'),
      resolution(['1K', '2K'], '1K'),
      nsfwChecker(),
    ],
  },
  {
    id: 'qwen3/image-to-image',
    name: 'Qwen 3 Edit',
    family: 'Alibaba',
    category: 'image',
    mode: 'image-to-image',
    api: 'market',
    output: 'image',
    tagline: 'Style transfer with bilingual text preservation.',
    speed: 'fast',
    hidden: true,
    fields: [
      prompt({ maxLength: 5000 }),
      imageUrls(3),
      {
        name: 'image_size',
        kind: 'ratio',
        label: 'Aspect ratio',
        options: opts('1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'),
        default: '16:9',
      },
      resolution(['1K', '2K'], '1K'),
      negativePrompt({ maxLength: 5000 }),
      {
        name: 'prompt_extend',
        kind: 'toggle',
        label: 'Prompt rewriting',
        default: true,
        advanced: true,
      },
      outputFormat(),
      seed(),
      nsfwChecker(),
    ],
  },
  {
    id: 'ideogram/character',
    name: 'Ideogram Character',
    family: 'Ideogram',
    category: 'image',
    mode: 'image-to-image',
    api: 'market',
    output: 'image',
    tagline: 'Lock a character’s identity across new scenes.',
    speed: 'balanced',
    featured: true,
    badges: ['Consistency'],
    fields: [
      prompt({ maxLength: 5000 }),
      imageUrls(1, {
        name: 'reference_image_urls',
        label: 'Character reference',
        description: 'One portrait. The identity is carried into the new scene.',
      }),
      {
        name: 'rendering_speed',
        kind: 'select',
        label: 'Rendering',
        options: opts('TURBO', 'BALANCED', 'QUALITY'),
        default: 'BALANCED',
      },
      {
        name: 'style',
        kind: 'select',
        label: 'Style',
        options: opts('AUTO', 'REALISTIC', 'FICTION'),
        default: 'AUTO',
      },
      {
        name: 'image_size',
        kind: 'select',
        label: 'Size preset',
        options: opts(
          'square', 'square_hd', 'portrait_4_3', 'portrait_16_9',
          'landscape_4_3', 'landscape_16_9',
        ),
        default: 'square_hd',
      },
      {
        name: 'num_images',
        kind: 'select',
        label: 'Images per run',
        options: opts('1', '2', '3', '4'),
        default: '1',
      },
      {
        name: 'expand_prompt',
        kind: 'toggle',
        label: 'MagicPrompt',
        default: true,
        advanced: true,
      },
      negativePrompt({ maxLength: 5000 }),
      seed(),
    ],
  },
  {
    id: 'grok-imagine-image-2-0/image-edit',
    name: 'Grok Imagine Edit',
    family: 'xAI',
    category: 'image',
    mode: 'image-to-image',
    api: 'market',
    output: 'image',
    tagline: 'Fast, loose edits with personality.',
    speed: 'fast',
    fields: [
      prompt({ maxLength: 5000, required: false }),
      imageUrls(4, { label: 'Source images' }),
      ratio(['1:1', '2:3', '3:2', '16:9', '9:16', 'auto'], 'auto'),
    ],
  },
]

/* ────────────────────────────────────────────────────────────────────────────
 * VIDEO, text to video
 * ──────────────────────────────────────────────────────────────────────────*/

const VIDEO_TEXT: ModelDef[] = [
  {
    id: 'veo3',
    name: 'Veo 3.1',
    family: 'Google',
    category: 'video',
    mode: 'text-to-video',
    api: 'veo',
    output: 'video',
    tagline: 'Native audio, cinematic camera language, up to 4K.',
    speed: 'slow',
    featured: true,
    badges: ['Audio', '4K'],
    fields: [
      prompt({ maxLength: 5000, placeholder: 'A cinematic shot of…' }),
      {
        name: 'imageUrls',
        kind: 'images',
        label: 'Reference frames',
        description: 'Optional. 1 image seeds the shot, 2 sets first & last frame.',
        maxItems: 2,
        accepts: 'JPEG, PNG',
        maxSizeMb: 10,
      },
      {
        name: 'model',
        kind: 'select',
        label: 'Tier',
        options: [
          { value: 'veo3_fast', label: 'Fast', hint: 'Quickest, lowest cost' },
          { value: 'veo3', label: 'Quality', hint: 'Full Veo 3.1' },
          { value: 'veo3_lite', label: 'Lite', hint: 'Draft tier' },
        ],
        default: 'veo3_fast',
      },
      ratio(['16:9', '9:16', 'Auto'], '16:9'),
      resolution(['720p', '1080p', '4k'], '720p'),
      {
        name: 'duration',
        kind: 'select',
        label: 'Duration',
        options: [
          { value: '4', label: '4s' },
          { value: '6', label: '6s' },
          { value: '8', label: '8s' },
        ],
        default: '8',
      },
      {
        name: 'watermark',
        kind: 'text',
        label: 'Watermark text',
        advanced: true,
        placeholder: 'Optional',
      },
      {
        name: 'enableTranslation',
        kind: 'toggle',
        label: 'Auto-translate prompt',
        description: 'Translate non-English prompts before generation.',
        default: true,
        advanced: true,
      },
    ],
  },
  {
    id: 'bytedance/seedance-2',
    name: 'Seedance 2.0',
    family: 'ByteDance',
    category: 'video',
    mode: 'text-to-video',
    api: 'market',
    output: 'video',
    tagline: 'Reference-rich generation with synced audio, up to 4K.',
    speed: 'slow',
    featured: true,
    badges: ['Audio', '4K', 'Refs'],
    fields: [
      prompt({ maxLength: 5000 }),
      {
        ...imageUrl({
          name: 'first_frame_url',
          label: 'First frame',
          required: false,
          description: 'Optional. Anchors the opening frame.',
        }),
      },
      {
        ...imageUrl({
          name: 'last_frame_url',
          label: 'Last frame',
          required: false,
          description: 'Optional. Anchors the closing frame.',
          advanced: true,
        }),
      },
      {
        ...imageUrls(4, {
          name: 'reference_image_urls',
          label: 'Style references',
          required: false,
          advanced: true,
        }),
      },
      {
        name: 'reference_video_urls',
        kind: 'videos',
        label: 'Motion references',
        maxItems: 2,
        accepts: 'MP4, MOV',
        maxSizeMb: 50,
        advanced: true,
      },
      resolution(['480p', '720p', '1080p', '4k'], '720p'),
      ratio(['1:1', '4:3', '3:4', '16:9', '9:16', '21:9', 'adaptive'], '16:9'),
      {
        name: 'duration',
        kind: 'number',
        label: 'Duration',
        description: 'Seconds.',
        min: 2,
        max: 15,
        step: 1,
        default: 5,
      },
      {
        name: 'generate_audio',
        kind: 'toggle',
        label: 'Generate audio',
        default: true,
      },
      {
        name: 'return_last_frame',
        kind: 'toggle',
        label: 'Return last frame',
        description: 'Useful for chaining shots.',
        default: false,
        advanced: true,
      },
      nsfwChecker(),
    ],
  },
  {
    id: 'bytedance/seedance-2-fast',
    name: 'Seedance 2 Fast',
    family: 'ByteDance',
    category: 'video',
    mode: 'text-to-video',
    api: 'market',
    output: 'video',
    tagline: 'Seedance 2 tuned for iteration speed.',
    speed: 'fast',
    fields: [
      prompt({ maxLength: 5000 }),
      {
        ...imageUrl({
          name: 'first_frame_url',
          label: 'First frame',
          required: false,
        }),
      },
      resolution(['480p', '720p'], '720p'),
      ratio(['1:1', '4:3', '3:4', '16:9', '9:16', '21:9', 'adaptive'], '16:9'),
      {
        name: 'duration',
        kind: 'number',
        label: 'Duration',
        min: 2,
        max: 15,
        step: 1,
        default: 5,
      },
      { name: 'generate_audio', kind: 'toggle', label: 'Generate audio', default: true },
      nsfwChecker(),
    ],
  },
  {
    id: 'kling/v3-turbo-text-to-video',
    name: 'Kling 3 Turbo',
    family: 'Kuaishou',
    category: 'video',
    mode: 'text-to-video',
    api: 'market',
    output: 'video',
    tagline: 'Dialogue-capable shots up to 15 seconds.',
    speed: 'balanced',
    featured: true,
    badges: ['15s'],
    routeWithAssets: {
      modelId: 'kling/v3-turbo-image-to-video',
      from: 'reference_images',
      to: 'image_urls',
    },
    fields: [
      prompt({ maxLength: 2500 }),
      optionalReference(1, {
        label: 'Reference image',
        description:
          'Optional. Adding one guides the result instead of generating from the prompt alone.',
      }),
      {
        name: 'duration',
        kind: 'number',
        label: 'Duration',
        description: 'Seconds, 3–15.',
        min: 3,
        max: 15,
        step: 1,
        default: 5,
        asString: true,
      },
      ratio(['16:9', '9:16', '1:1'], '16:9'),
      resolution(['720p', '1080p'], '720p'),
    ],
  },
  {
    id: 'kling-3.0-omni/text-to-video',
    name: 'Kling 3 Omni',
    family: 'Kuaishou',
    category: 'video',
    mode: 'text-to-video',
    api: 'market',
    output: 'video',
    tagline: 'Kling’s widest-capability tier.',
    speed: 'slow',
    fields: [
      prompt({ maxLength: 2500 }),
      {
        name: 'duration',
        kind: 'number',
        label: 'Duration',
        min: 3,
        max: 15,
        step: 1,
        default: 5,
        asString: true,
      },
      ratio(['16:9', '9:16', '1:1'], '16:9'),
      resolution(['720p', '1080p'], '720p'),
    ],
  },
  {
    id: 'wan/2-7-text-to-video',
    name: 'Wan 2.7',
    family: 'Alibaba',
    category: 'video',
    mode: 'text-to-video',
    api: 'market',
    output: 'video',
    tagline: 'Clean 1080p motion with optional custom audio bed.',
    speed: 'balanced',
    routeWithAssets: {
      modelId: 'wan/2-7-image-to-video',
      from: 'reference_images',
      to: 'first_frame_url',
    },
    fields: [
      prompt({ maxLength: 5000 }),
      optionalReference(1, {
        label: 'Reference image',
        description:
          'Optional. Adding one guides the result instead of generating from the prompt alone.',
      }),
      negativePrompt(),
      {
        ...audioUrl({
          label: 'Custom audio',
          required: false,
          description: 'Optional. Drive the video against your own track.',
          advanced: true,
        }),
      },
      resolution(['720p', '1080p'], '1080p'),
      {
        name: 'ratio',
        kind: 'ratio',
        label: 'Aspect ratio',
        options: opts('16:9', '9:16', '1:1', '4:3', '3:4'),
        default: '16:9',
      },
      {
        name: 'duration',
        kind: 'number',
        label: 'Duration',
        min: 2,
        max: 15,
        step: 1,
        default: 5,
      },
      {
        name: 'prompt_extend',
        kind: 'toggle',
        label: 'Prompt rewriting',
        default: true,
        advanced: true,
      },
      {
        name: 'watermark',
        kind: 'toggle',
        label: 'AI watermark',
        default: false,
        advanced: true,
      },
      seed(),
      nsfwChecker(),
    ],
  },
  {
    id: 'grok-imagine/text-to-video',
    name: 'Grok Imagine Video',
    family: 'xAI',
    category: 'video',
    mode: 'text-to-video',
    api: 'market',
    output: 'video',
    tagline: 'Up to 30 seconds with distinct tonal modes.',
    speed: 'fast',
    badges: ['30s'],
    routeWithAssets: {
      modelId: 'grok-imagine/image-to-video',
      from: 'reference_images',
      to: 'image_urls',
    },
    fields: [
      prompt({ maxLength: 5000 }),
      optionalReference(7, {
        label: 'Reference images',
        description:
          'Optional. Adding one guides the result instead of generating from the prompt alone.',
      }),
      ratio(['2:3', '3:2', '1:1', '16:9', '9:16'], '16:9'),
      {
        name: 'mode',
        kind: 'select',
        label: 'Mode',
        options: [
          { value: 'fun', label: 'Fun', hint: 'Playful, exaggerated motion' },
          { value: 'normal', label: 'Normal', hint: 'Balanced' },
          { value: 'spicy', label: 'Spicy', hint: 'Higher intensity' },
        ],
        default: 'normal',
      },
      {
        name: 'duration',
        kind: 'number',
        label: 'Duration',
        min: 6,
        max: 30,
        step: 1,
        default: 6,
      },
      resolution(['480p', '720p', '1080p'], '720p'),
      nsfwChecker(),
    ],
  },
  {
    id: 'minimax-h3/text-to-video',
    name: 'MiniMax H3',
    family: 'MiniMax',
    category: 'video',
    mode: 'text-to-video',
    api: 'market',
    output: 'video',
    tagline: 'Long-form prompts, 2K output.',
    speed: 'balanced',
    badges: ['2K'],
    routeWithAssets: {
      modelId: 'minimax-h3/image-to-video',
      from: 'reference_images',
      to: 'first_frame_url',
    },
    fields: [
      prompt({ maxLength: 7000 }),
      ratio(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], '16:9'),
      optionalReference(1, {
        label: 'First frame',
        description:
          'Optional. Anchors the opening frame instead of generating from the prompt alone.',
      }),
      {
        name: 'duration',
        kind: 'number',
        label: 'Duration',
        min: 4,
        max: 15,
        step: 1,
        default: 6,
      },
      resolution(['768P', '2K'], '2K'),
    ],
  },
  {
    id: 'hailuo/02-text-to-video-pro',
    name: 'Hailuo 02 Pro',
    family: 'MiniMax',
    category: 'video',
    mode: 'text-to-video',
    api: 'market',
    output: 'video',
    tagline: 'Reliable physics and character motion.',
    speed: 'balanced',
    fields: [
      prompt({ maxLength: 2000 }),
      {
        name: 'prompt_optimizer',
        kind: 'toggle',
        label: 'Prompt optimiser',
        description: 'Let Hailuo rewrite the prompt before generating.',
        default: true,
        advanced: true,
      },
      nsfwChecker(),
    ],
  },
  {
    id: 'pixverse-v6/text-to-video',
    name: 'PixVerse',
    family: 'PixVerse',
    category: 'video',
    mode: 'text-to-video',
    api: 'market',
    output: 'video',
    tagline: 'Stylised motion with strong anime presets.',
    speed: 'fast',
    routeWithAssets: {
      modelId: 'pixverse-v6/image-to-video',
      from: 'reference_images',
      to: 'image_urls',
    },
    fields: [
      prompt({ maxLength: 2048 }),
      optionalReference(2, {
        label: 'First frame',
        description:
          'Optional. Anchors the opening frame instead of generating from the prompt alone.',
      }),
      ratio(['16:9', '4:3', '1:1', '3:4', '9:16', '2:3', '3:2', '21:9'], '16:9'),
      {
        name: 'quality',
        kind: 'select',
        label: 'Quality',
        options: opts('360p', '540p', '720p', '1080p'),
        default: '720p',
      },
      {
        name: 'duration',
        kind: 'slider',
        label: 'Duration',
        description: 'Seconds.',
        min: 1,
        max: 15,
        step: 1,
        default: 5,
      },
      {
        name: 'generate_audio_switch',
        kind: 'toggle',
        label: 'Generate audio',
        default: false,
      },
      {
        name: 'generate_multi_clip_switch',
        kind: 'toggle',
        label: 'Multiple clips',
        description: 'Cut the prompt into several shots rather than one take.',
        default: false,
        advanced: true,
      },
      seed(),
    ],
  },
]

/* ────────────────────────────────────────────────────────────────────────────
 * VIDEO, image to video
 * ──────────────────────────────────────────────────────────────────────────*/

const VIDEO_IMAGE: ModelDef[] = [
  {
    id: 'kling/v3-turbo-image-to-video',
    name: 'Kling 3 Turbo I2V',
    family: 'Kuaishou',
    category: 'video',
    mode: 'image-to-video',
    api: 'market',
    output: 'video',
    tagline: 'Animate a still with spoken dialogue and camera moves.',
    speed: 'balanced',
    featured: true,
    hidden: true,
    fields: [
      prompt({ maxLength: 2500 }),
      imageUrls(1, { label: 'Source image' }),
      {
        name: 'duration',
        kind: 'number',
        label: 'Duration',
        min: 3,
        max: 15,
        step: 1,
        default: 5,
        asString: true,
      },
      resolution(['720p', '1080p'], '720p'),
    ],
  },
  {
    id: 'hailuo/2-3-image-to-video-pro',
    name: 'Hailuo 2.3 Pro',
    family: 'MiniMax',
    category: 'video',
    mode: 'image-to-video',
    api: 'market',
    output: 'video',
    tagline: 'Silky character animation from a single portrait.',
    speed: 'balanced',
    featured: true,
    fields: [
      prompt({ maxLength: 5000 }),
      imageUrl(),
      {
        name: 'duration',
        kind: 'select',
        label: 'Duration',
        options: [
          { value: '6', label: '6s' },
          { value: '10', label: '10s', hint: 'Not available at 1080P' },
        ],
        default: '6',
      },
      resolution(['768P', '1080P'], '768P'),
      nsfwChecker(),
    ],
  },
  {
    id: 'grok-imagine/image-to-video',
    name: 'Grok Imagine I2V',
    family: 'xAI',
    category: 'video',
    mode: 'image-to-video',
    api: 'market',
    output: 'video',
    tagline: 'Up to 30 seconds of motion from up to 7 stills.',
    speed: 'fast',
    hidden: true,
    fields: [
      prompt({ maxLength: 5000 }),
      imageUrls(7),
      {
        name: 'mode',
        kind: 'select',
        label: 'Mode',
        options: opts('fun', 'normal', 'spicy'),
        default: 'normal',
      },
      {
        name: 'duration',
        kind: 'number',
        label: 'Duration',
        min: 6,
        max: 30,
        step: 1,
        default: 6,
        asString: true,
      },
      resolution(['480p', '720p', '1080p'], '720p'),
      ratio(['2:3', '3:2', '1:1', '16:9', '9:16'], '16:9'),
      nsfwChecker(),
    ],
  },
  {
    id: 'minimax-h3/image-to-video',
    name: 'MiniMax H3 I2V',
    family: 'MiniMax',
    category: 'video',
    mode: 'image-to-video',
    api: 'market',
    output: 'video',
    tagline: 'First/last frame interpolation at 2K.',
    speed: 'balanced',
    hidden: true,
    fields: [
      prompt({ maxLength: 7000 }),
      imageUrl({ name: 'first_frame_url', label: 'First frame' }),
      imageUrl({
        name: 'last_frame_url',
        label: 'Last frame',
        required: false,
        description: 'Optional. Interpolates between the two frames.',
      }),
      {
        name: 'duration',
        kind: 'number',
        label: 'Duration',
        min: 4,
        max: 15,
        step: 1,
        default: 6,
      },
      resolution(['768P', '2K'], '2K'),
    ],
  },
  {
    id: 'wan/2-7-image-to-video',
    name: 'Wan 2.7 I2V',
    family: 'Alibaba',
    category: 'video',
    mode: 'image-to-video',
    api: 'market',
    output: 'video',
    tagline: 'Stable 1080p animation from a still.',
    speed: 'balanced',
    hidden: true,
    fields: [
      prompt({ maxLength: 2000 }),
      imageUrl({
        name: 'first_frame_url',
        label: 'First frame',
        maxSizeMb: 20,
      }),
      imageUrl({
        name: 'last_frame_url',
        label: 'Last frame',
        required: false,
        description: 'Optional. The shot moves towards this image.',
        maxSizeMb: 20,
      }),
      negativePrompt({ maxLength: 2000 }),
      resolution(['720p', '1080p'], '1080p'),
      {
        name: 'duration',
        kind: 'slider',
        label: 'Duration',
        description: 'Seconds.',
        min: 2,
        max: 15,
        step: 1,
        default: 5,
      },
      {
        name: 'prompt_extend',
        kind: 'toggle',
        label: 'Extend the prompt',
        description: 'Let Wan elaborate on a short prompt before generating.',
        default: true,
        advanced: true,
      },
      {
        name: 'watermark',
        kind: 'toggle',
        label: 'Watermark',
        default: false,
        advanced: true,
      },
      seed(),
      nsfwChecker(),
    ],
  },
  {
    id: 'bytedance/v1-pro-image-to-video',
    name: 'Seedance 1 Pro I2V',
    family: 'ByteDance',
    category: 'video',
    mode: 'image-to-video',
    api: 'market',
    output: 'video',
    tagline: 'Proven, cost-effective image animation.',
    speed: 'fast',
    fields: [
      prompt({ maxLength: 5000 }),
      imageUrl(),
      resolution(['480p', '720p', '1080p'], '720p'),
      {
        name: 'duration',
        kind: 'select',
        label: 'Duration',
        options: [
          { value: '5', label: '5s' },
          { value: '10', label: '10s' },
        ],
        default: '5',
      },
      seed(),
    ],
  },
  {
    id: 'pixverse-v6/image-to-video',
    name: 'PixVerse I2V',
    family: 'PixVerse',
    category: 'video',
    mode: 'image-to-video',
    api: 'market',
    output: 'video',
    tagline: 'Stylised animation with anime-leaning motion.',
    speed: 'fast',
    hidden: true,
    fields: [
      prompt({ maxLength: 2048 }),
      imageUrls(2, {
        label: 'Source images',
        description: 'The first frame, and optionally a last frame to move towards.',
      }),
      {
        name: 'quality',
        kind: 'select',
        label: 'Quality',
        options: opts('360p', '540p', '720p', '1080p'),
        default: '720p',
      },
      {
        name: 'duration',
        kind: 'slider',
        label: 'Duration',
        description: 'Seconds.',
        min: 1,
        max: 15,
        step: 1,
        default: 5,
      },
      {
        name: 'generate_audio_switch',
        kind: 'toggle',
        label: 'Generate audio',
        default: false,
      },
      {
        name: 'generate_multi_clip_switch',
        kind: 'toggle',
        label: 'Multiple clips',
        default: false,
        advanced: true,
      },
      seed(),
    ],
  },
]

/* ────────────────────────────────────────────────────────────────────────────
 * VIDEO, avatars, lipsync, motion transfer
 * ──────────────────────────────────────────────────────────────────────────*/

const VIDEO_AVATAR: ModelDef[] = [
  {
    id: 'omnihuman-1-5',
    name: 'OmniHuman 1.5',
    family: 'ByteDance',
    category: 'video',
    mode: 'audio-to-video',
    api: 'market',
    output: 'video',
    tagline: 'Photoreal talking head from one portrait and one voice track.',
    speed: 'slow',
    featured: true,
    badges: ['Lipsync', '1080p'],
    fields: [
      imageUrl({ label: 'Portrait' }),
      audioUrl({ maxSizeMb: 10, description: 'Under 60 seconds.' }),
      prompt({
        required: false,
        maxLength: 1000,
        label: 'Direction',
        placeholder: 'Optional. “Speaking warmly, gentle head movement”…',
      }),
      {
        name: 'output_resolution',
        kind: 'select',
        label: 'Resolution',
        options: [
          { value: '720', label: '720P' },
          { value: '1080', label: '1080P' },
        ],
        default: '1080',
      },
      {
        name: 'pe_fast_mode',
        kind: 'toggle',
        label: 'Fast mode',
        description: 'Trades some fidelity for a quicker render.',
        default: false,
        advanced: true,
      },
      seed({ default: -1, min: -1 }),
    ],
  },
  {
    id: 'kling/ai-avatar-pro',
    name: 'Kling Avatar Pro',
    family: 'Kuaishou',
    category: 'video',
    mode: 'audio-to-video',
    api: 'market',
    output: 'video',
    tagline: 'Long-form avatar delivery, up to 5 minutes of audio.',
    speed: 'slow',
    badges: ['Lipsync', '5 min'],
    fields: [
      imageUrl({ label: 'Avatar image' }),
      audioUrl({ maxSizeMb: 100, description: 'Up to 5 minutes.' }),
      prompt({
        maxLength: 5000,
        label: 'Direction',
        placeholder: 'Optional performance notes…',
      }),
    ],
  },
  {
    id: 'kling/ai-avatar-standard',
    name: 'Kling Avatar',
    family: 'Kuaishou',
    category: 'video',
    mode: 'audio-to-video',
    api: 'market',
    output: 'video',
    tagline: 'The standard-tier talking avatar.',
    speed: 'balanced',
    badges: ['Lipsync'],
    fields: [
      imageUrl({ label: 'Avatar image' }),
      audioUrl({ maxSizeMb: 100 }),
      prompt({ maxLength: 5000, label: 'Direction' }),
    ],
  },
  {
    id: 'kling-3.0/motion-control',
    name: 'Kling Motion Control',
    family: 'Kuaishou',
    category: 'video',
    mode: 'video-to-video',
    api: 'market',
    output: 'video',
    tagline: 'Transfer motion from a driving video onto your character.',
    speed: 'slow',
    featured: true,
    badges: ['Motion transfer'],
    fields: [
      {
        ...imageUrls(1, {
          name: 'input_urls',
          label: 'Character image',
          description: 'The subject to animate.',
        }),
      },
      {
        name: 'video_urls',
        kind: 'videos',
        label: 'Driving video',
        description: 'The performance to copy.',
        required: true,
        maxItems: 1,
        accepts: 'MP4, MOV',
        maxSizeMb: 50,
      },
      prompt({ required: false, maxLength: 2500, label: 'Direction' }),
      {
        name: 'mode',
        kind: 'select',
        label: 'Quality',
        options: [
          { value: 'std', label: 'Standard', hint: '720p' },
          { value: 'pro', label: 'Pro', hint: '1080p' },
        ],
        default: 'std',
      },
      {
        name: 'character_orientation',
        kind: 'select',
        label: 'Orientation source',
        options: opts('video', 'image'),
        default: 'video',
        advanced: true,
      },
      {
        name: 'background_source',
        kind: 'select',
        label: 'Background source',
        options: opts('input_video', 'input_image'),
        default: 'input_video',
        advanced: true,
      },
    ],
  },
  {
    id: 'wan/2-2-animate-replace',
    name: 'Wan Animate Replace',
    family: 'Alibaba',
    category: 'video',
    mode: 'video-to-video',
    api: 'market',
    output: 'video',
    tagline: 'Swap the performer in a video for your character.',
    speed: 'slow',
    fields: [
      imageUrl({ label: 'Character image' }),
      {
        name: 'video_url',
        kind: 'video',
        label: 'Source video',
        required: true,
        accepts: 'MP4, MOV',
        maxSizeMb: 50,
      },
      resolution(['480p', '720p'], '720p'),
    ],
  },
  {
    id: 'infinitalk/from-audio',
    name: 'InfiniTalk',
    family: 'MeiGen',
    category: 'video',
    mode: 'audio-to-video',
    api: 'market',
    output: 'video',
    tagline: 'Unbounded-length lipsync from an audio track.',
    speed: 'slow',
    badges: ['Lipsync'],
    fields: [
      imageUrl({ label: 'Portrait' }),
      audioUrl(),
      prompt({ maxLength: 2000, label: 'Direction' }),
      resolution(['480p', '720p'], '480p'),
    ],
  },
]

/* ────────────────────────────────────────────────────────────────────────────
 * AUDIO
 * ──────────────────────────────────────────────────────────────────────────*/

const AUDIO: ModelDef[] = [
  {
    id: 'suno',
    name: 'Suno',
    family: 'Suno',
    category: 'audio',
    mode: 'text-to-audio',
    api: 'suno',
    output: 'audio',
    tagline: 'Full songs with vocals, structure and production.',
    speed: 'balanced',
    featured: true,
    badges: ['Music', 'Vocals'],
    fields: [
      prompt({
        label: 'Description or lyrics',
        maxLength: 5000,
        placeholder:
          'In simple mode, describe the song. In custom mode, paste your lyrics.',
      }),
      {
        name: 'model',
        kind: 'select',
        label: 'Version',
        options: [
          { value: 'V5_5', label: 'v5.5', hint: 'Latest, duration control' },
          { value: 'V5', label: 'v5' },
          { value: 'V4_5PLUS', label: 'v4.5+' },
          { value: 'V4_5', label: 'v4.5' },
          { value: 'V4', label: 'v4' },
        ],
        default: 'V5',
      },
      {
        name: 'customMode',
        kind: 'toggle',
        label: 'Custom mode',
        description: 'Unlocks style, title and lyric control.',
        default: true,
      },
      {
        name: 'instrumental',
        kind: 'toggle',
        label: 'Instrumental',
        description: 'No vocals.',
        default: false,
      },
      {
        name: 'style',
        kind: 'text',
        label: 'Style',
        description: 'Required in custom mode.',
        placeholder: 'dream pop, analog synths, brushed drums',
        showWhen: { field: 'customMode', equals: [true] },
      },
      {
        name: 'title',
        kind: 'text',
        label: 'Title',
        maxLength: 80,
        showWhen: { field: 'customMode', equals: [true] },
      },
      {
        name: 'negativeTags',
        kind: 'text',
        label: 'Avoid',
        placeholder: 'heavy metal, screaming',
        advanced: true,
      },
      {
        name: 'vocalGender',
        kind: 'select',
        label: 'Vocal',
        options: [
          { value: '', label: 'Any' },
          { value: 'f', label: 'Female' },
          { value: 'm', label: 'Male' },
        ],
        default: '',
        advanced: true,
      },
      {
        name: 'duration',
        kind: 'number',
        label: 'Duration',
        description: 'Seconds. v5.5 + custom mode only.',
        min: 10,
        max: 360,
        step: 5,
        default: 120,
        advanced: true,
      },
      {
        name: 'styleWeight',
        kind: 'slider',
        label: 'Style adherence',
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.65,
        advanced: true,
      },
      {
        name: 'weirdnessConstraint',
        kind: 'slider',
        label: 'Weirdness',
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.5,
        advanced: true,
      },
      {
        name: 'audioWeight',
        kind: 'slider',
        label: 'Audio weight',
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.65,
        advanced: true,
      },
    ],
  },
  {
    id: 'elevenlabs/text-to-speech-multilingual-v2',
    name: 'ElevenLabs Multilingual v2',
    family: 'ElevenLabs',
    category: 'audio',
    mode: 'text-to-audio',
    api: 'market',
    output: 'audio',
    tagline: 'Studio-grade speech across 29 languages.',
    speed: 'fast',
    featured: true,
    badges: ['Voice'],
    fields: [
      {
        name: 'text',
        kind: 'prompt',
        label: 'Script',
        required: true,
        maxLength: 5000,
        placeholder: 'The text to speak…',
      },
      elevenLabsVoice(),
      {
        name: 'stability',
        kind: 'slider',
        label: 'Stability',
        description: 'Lower is more expressive, higher is more consistent.',
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.5,
      },
      {
        name: 'similarity_boost',
        kind: 'slider',
        label: 'Similarity',
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.75,
      },
      {
        name: 'style',
        kind: 'slider',
        label: 'Style exaggeration',
        min: 0,
        max: 1,
        step: 0.01,
        default: 0,
        advanced: true,
      },
      {
        name: 'speed',
        kind: 'slider',
        label: 'Speed',
        min: 0.7,
        max: 1.2,
        step: 0.01,
        default: 1,
        advanced: true,
      },
      {
        name: 'language_code',
        kind: 'text',
        label: 'Force language',
        description: 'ISO 639-1 code, e.g. “fr”. Leave blank to auto-detect.',
        advanced: true,
      },
      {
        name: 'timestamps',
        kind: 'toggle',
        label: 'Word timestamps',
        default: false,
        advanced: true,
      },
    ],
  },
  {
    id: 'elevenlabs/text-to-speech-turbo-2-5',
    name: 'ElevenLabs Turbo 2.5',
    family: 'ElevenLabs',
    category: 'audio',
    mode: 'text-to-audio',
    api: 'market',
    output: 'audio',
    tagline: 'Lowest-latency speech for long scripts.',
    speed: 'fast',
    fields: [
      {
        name: 'text',
        kind: 'prompt',
        label: 'Script',
        required: true,
        maxLength: 5000,
      },
      elevenLabsVoice(),
      {
        name: 'stability',
        kind: 'slider',
        label: 'Stability',
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.5,
      },
      {
        name: 'similarity_boost',
        kind: 'slider',
        label: 'Similarity',
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.75,
      },
      {
        name: 'speed',
        kind: 'slider',
        label: 'Speed',
        min: 0.7,
        max: 1.2,
        step: 0.01,
        default: 1,
        advanced: true,
      },
    ],
  },
  {
    id: 'elevenlabs/audio-isolation',
    name: 'Audio Isolation',
    family: 'ElevenLabs',
    category: 'audio',
    mode: 'enhance',
    api: 'market',
    output: 'audio',
    tagline: 'Strip background noise, keep the voice.',
    speed: 'fast',
    fields: [audioUrl({ label: 'Source audio' })],
  },
]

/**
 * Build a language model entry.
 *
 * These differ from each other in about four fields, and writing thirty-four
 * of them out longhand would be thirty-four chances to mistype a slug. The
 * form each one shows is decided by what its transport supports rather than
 * by hand: only vision models get an attachment field, only models with
 * reasoning levels get the effort menu.
 */
function chatModel(input: {
  slug: string
  name: string
  family: string
  tagline: string
  chat: ChatEndpoint
  speed?: ModelDef['speed']
  featured?: boolean
  badges?: string[]
  /** Longest prompt the endpoint accepts. */
  maxPrompt?: number
}): ModelDef {
  const { chat } = input
  const badges = [
    ...(input.badges ?? []),
    ...(chat.vision ? ['Vision'] : []),
    ...(chat.webSearch ? ['Search'] : []),
  ]

  return {
    id: `chat/${input.slug}`,
    name: input.name,
    family: input.family,
    category: 'text',
    mode: 'text-to-text',
    api: 'chat',
    output: 'text',
    tagline: input.tagline,
    speed: input.speed ?? 'balanced',
    ...(input.featured ? { featured: true } : {}),
    ...(badges.length ? { badges } : {}),
    chat,
    fields: [
      prompt({
        maxLength: input.maxPrompt ?? 100000,
        placeholder: 'Ask anything, or paste a document to work on…',
      }),
      systemPrompt(),
      ...(chat.vision
        ? [
            optionalReference(6, {
              name: 'image_urls',
              label: 'Attachments',
              description:
                'Optional. Images, and on these endpoints also video, audio or PDF.',
              accepts: 'JPEG, PNG, WebP, PDF, MP4, MP3',
              maxSizeMb: 50,
            }),
          ]
        : []),
      ...(chat.effortLevels?.length
        ? [reasoningEffort(chat.effortLevels, chat.effortLevels.at(-1))]
        : []),
      ...(chat.webSearch ? [webSearchToggle()] : []),
      // Anthropic's endpoint has no default of its own and refuses a request
      // without one, so the field is always present there.
      ...(chat.transport === 'anthropic-messages'
        ? [maxTokens(chat.maxTokens ?? 8192, 64000)]
        : []),
    ],
  }
}

/** Every model on `/claude/v1/messages`, newest first. */
const CLAUDE: [slug: string, name: string, tagline: string, speed?: ModelDef['speed']][] = [
  ['claude-opus-5', 'Claude Opus 5', 'The strongest reasoning on offer. Long documents, hard problems.', 'slow'],
  ['claude-sonnet-5', 'Claude Sonnet 5', 'The everyday workhorse. Nearly Opus quality at a fraction of the wait.'],
  ['claude-fable-5', 'Claude Fable 5', 'Tuned for writing that has to read well rather than merely be correct.'],
  ['claude-opus-4-8', 'Claude Opus 4.8', 'The previous Opus. Still the pick for work that must not be wrong.', 'slow'],
  ['claude-opus-4-7', 'Claude Opus 4.7', 'An older Opus, kept for prompts already tuned against it.', 'slow'],
  ['claude-opus-4-6', 'Claude Opus 4.6', 'An older Opus, kept for reproducibility.', 'slow'],
  ['claude-opus-4-5', 'Claude Opus 4.5', 'The oldest Opus still served here.', 'slow'],
  ['claude-sonnet-4-6', 'Claude Sonnet 4.6', 'The previous Sonnet. Cheap, quick, and good enough for most drafts.'],
  ['claude-sonnet-4-5', 'Claude Sonnet 4.5', 'An older Sonnet, kept for prompts already tuned against it.'],
  ['claude-haiku-4-5', 'Claude Haiku 4.5', 'Fast and cheap. Right for rewrites, extraction and short answers.', 'fast'],
]

/**
 * Gemini through the OpenAI-shaped route.
 *
 * Kie also exposes a native streaming route for several of these. The
 * OpenAI-shaped one is used because it answers in a single response, which is
 * what a job row needs.
 */
const GEMINI: [slug: string, path: string, name: string, tagline: string, speed?: ModelDef['speed']][] = [
  ['gemini-3.1-pro', 'gemini-3.1-pro', 'Gemini 3.1 Pro', 'Google\'s newest Pro. Very long context, grounded in Search on request.'],
  ['gemini-3-pro', 'gemini-3-pro', 'Gemini 3 Pro', 'Very long context, grounded in Google Search when you ask for it.'],
  ['gemini-3-8-flash', 'gemini-3-8-flash-openai', 'Gemini 3.8 Flash', 'The cheapest way to run text through a capable model at volume.', 'fast'],
  ['gemini-3-7-flash', 'gemini-3-7-flash-openai', 'Gemini 3.7 Flash', 'The previous Flash. Cheaper still, and rarely worse for simple work.', 'fast'],
  ['gemini-3-6-flash', 'gemini-3-6-flash-openai', 'Gemini 3.6 Flash', 'An older Flash, kept for prompts already tuned against it.', 'fast'],
  ['gemini-3-5-flash', 'gemini-3-5-flash-openai', 'Gemini 3.5 Flash', 'An older Flash, kept for reproducibility.', 'fast'],
  ['gemini-3-flash', 'gemini-3-flash', 'Gemini 3 Flash', 'The first of the 3 series. Fast, and cheap enough to batch.', 'fast'],
  ['gemini-2.5-pro', 'gemini-2.5-pro', 'Gemini 2.5 Pro', 'Proven long-context reasoning, at a price the 3 series has undercut.'],
  ['gemini-2.5-flash', 'gemini-2.5-flash', 'Gemini 2.5 Flash', 'Proven and inexpensive. A safe default for bulk text work.', 'fast'],
]

/** OpenAI's Responses models. Two paths, same shape. */
const OPENAI_RESPONSES: [slug: string, name: string, tagline: string, url?: string, speed?: ModelDef['speed']][] = [
  ['gpt-6-astra', 'GPT 6 Astra', 'OpenAI\'s newest. The one to reach for when the answer has to be right.', undefined, 'slow'],
  ['gpt-5-6-sol', 'GPT 5.6 Sol', 'Four levels of deliberation, up to xhigh for the hardest asks.', undefined, 'slow'],
  ['gpt-5-6-terra', 'GPT 5.6 Terra', 'The grounded 5.6. Steadier on factual work than its siblings.'],
  ['gpt-5-6-luna', 'GPT 5.6 Luna', 'The lighter 5.6. Quick turnarounds without dropping to a mini model.'],
  ['gpt-5-5', 'GPT 5.5', 'The previous generation, kept for prompts already tuned against it.'],
  ['gpt-5-4', 'GPT 5.4', 'An older GPT 5, kept for reproducibility.'],
  ['gpt-5.4-codex', 'GPT 5.4 Codex', 'Codex tuning: writes and reviews code rather than prose.', '/api/v1/responses'],
  ['gpt-5.3-codex', 'GPT 5.3 Codex', 'The previous Codex.', '/api/v1/responses'],
  ['gpt-5.2-codex', 'GPT 5.2 Codex', 'An older Codex, kept for reproducibility.', '/api/v1/responses'],
  ['gpt-5.1-codex', 'GPT 5.1 Codex', 'An older Codex.', '/api/v1/responses'],
  ['gpt-5-codex', 'GPT 5 Codex', 'The first Codex on this API.', '/api/v1/responses'],
]

const EFFORT_FOUR = ['low', 'medium', 'high', 'xhigh']

/* ────────────────────────────────────────────────────────────────────────────
 * TEXT, language models
 *
 * These do not go through the job API. They answer in the request, each in
 * its vendor's own format, so every entry carries a `chat` descriptor saying
 * which transport to use and where. See lib/kie/chat.ts.
 * ──────────────────────────────────────────────────────────────────────────*/

const TEXT: ModelDef[] = [
  ...CLAUDE.map(([slug, name, tagline, speed], i) =>
    chatModel({
      slug,
      name,
      family: 'Anthropic',
      tagline,
      speed,
      featured: i === 0 || i === 1,
      maxPrompt: 200000,
      chat: {
        transport: 'anthropic-messages',
        model: slug,
        maxTokens: slug.includes('haiku') ? 8192 : 16384,
      },
    }),
  ),

  ...GEMINI.map(([slug, path, name, tagline, speed], i) =>
    chatModel({
      slug,
      name,
      family: 'Google',
      tagline,
      speed,
      featured: i === 1,
      maxPrompt: 200000,
      chat: {
        transport: 'openai-chat',
        model: slug,
        path,
        effortLevels: slug.includes('flash') ? ['low', 'high'] : undefined,
        webSearch: 'googleSearch',
        vision: true,
      },
    }),
  ),

  chatModel({
    slug: 'gpt-5-2',
    name: 'GPT 5.2',
    family: 'OpenAI',
    tagline: 'Reads images alongside the prompt, and can search the web.',
    featured: true,
    chat: {
      transport: 'openai-chat',
      model: 'gpt-5-2',
      path: 'gpt-5-2',
      effortLevels: ['low', 'high'],
      webSearch: 'web_search',
      vision: true,
    },
  }),

  ...OPENAI_RESPONSES.map(([slug, name, tagline, url, speed], i) =>
    chatModel({
      slug,
      name,
      family: 'OpenAI',
      tagline,
      speed,
      featured: i === 0,
      chat: {
        transport: 'openai-responses',
        model: slug,
        ...(url ? { url } : {}),
        effortLevels: EFFORT_FOUR,
        webSearch: 'web_search',
      },
    }),
  ),

  ...(['grok-4-6', 'grok-4-5', 'grok-4-3'] as const).map((slug, i) =>
    chatModel({
      slug,
      name: `Grok ${slug.replace('grok-', '').replace('-', '.')}`,
      family: 'xAI',
      tagline:
        i === 0
          ? 'Blunt, current, and strong on anything that needs live search.'
          : 'An earlier Grok, kept for prompts already tuned against it.',
      chat: {
        transport: 'grok-responses',
        model: slug,
        effortLevels: EFFORT_FOUR,
        webSearch: 'web_search',
      },
    }),
  ),
]

/* ────────────────────────────────────────────────────────────────────────────
 * UTILITY, upscale, cleanup
 * ──────────────────────────────────────────────────────────────────────────*/

const UTILITY: ModelDef[] = [
  {
    id: 'topaz/image-upscale',
    name: 'Topaz Image Upscale',
    family: 'Topaz Labs',
    category: 'utility',
    mode: 'enhance',
    api: 'market',
    output: 'image',
    tagline: 'Clean 2× and 4× upscaling without the mush.',
    speed: 'fast',
    featured: true,
    fields: [
      imageUrl(),
      {
        name: 'upscale_factor',
        kind: 'select',
        label: 'Factor',
        options: [
          { value: '1', label: '1×', hint: 'Enhance only' },
          { value: '2', label: '2×' },
          { value: '4', label: '4×' },
        ],
        default: '2',
      },
    ],
  },
  {
    id: 'topaz/video-upscale',
    name: 'Topaz Video Upscale',
    family: 'Topaz Labs',
    category: 'utility',
    mode: 'enhance',
    api: 'market',
    output: 'video',
    tagline: 'Bring generated footage up to delivery resolution.',
    speed: 'slow',
    fields: [
      {
        name: 'video_url',
        kind: 'video',
        label: 'Source video',
        required: true,
        accepts: 'MP4, MOV, MKV',
        maxSizeMb: 50,
      },
      {
        name: 'upscale_factor',
        kind: 'select',
        label: 'Factor',
        options: [
          { value: '1', label: '1×' },
          { value: '2', label: '2×' },
          { value: '4', label: '4×' },
        ],
        default: '2',
      },
    ],
  },
  {
    id: 'recraft/remove-background',
    name: 'Remove Background',
    family: 'Recraft',
    category: 'utility',
    mode: 'enhance',
    api: 'market',
    output: 'image',
    tagline: 'Clean alpha cutouts in one call.',
    speed: 'fast',
    featured: true,
    fields: [
      imageUrl({
        name: 'image',
        label: 'Source image',
        accepts: 'PNG, JPG, WebP',
        maxSizeMb: 5,
      }),
    ],
  },
  {
    id: 'recraft/crisp-upscale',
    name: 'Crisp Upscale',
    family: 'Recraft',
    category: 'utility',
    mode: 'enhance',
    api: 'market',
    output: 'image',
    tagline: 'Sharpen and enlarge illustrations and vectors.',
    speed: 'fast',
    fields: [
      imageUrl({
        name: 'image',
        label: 'Source image',
        accepts: 'PNG, JPG, WebP',
        maxSizeMb: 5,
      }),
    ],
  },
  {
    id: 'seedream/5-pro-layer-decomposition',
    name: 'Layer Decomposition',
    family: 'ByteDance',
    category: 'utility',
    mode: 'enhance',
    api: 'market',
    output: 'image',
    tagline: 'Split an image into editable layers.',
    speed: 'balanced',
    fields: [
      imageUrl({ label: 'Source image', maxSizeMb: 30 }),
      prompt({
        required: false,
        maxLength: 5000,
        label: 'Guidance',
        placeholder: 'Optional. Name the layers you want separated…',
      }),
      {
        name: 'size',
        kind: 'select',
        label: 'Size',
        options: opts('auto', '1K', '1.5K', '2K'),
        default: 'auto',
      },
      outputFormat(['png', 'jpeg'], 'jpeg'),
    ],
  },
]

/* ────────────────────────────────────────────────────────────────────────────
 * Registry
 * ──────────────────────────────────────────────────────────────────────────*/

/* ────────────────────────────────────────────────────────────────────────────
 * STRUCTURED INPUT
 *
 * Four models want an array of objects rather than a flat value: a cast of
 * speakers, a dialogue line by line, a shot list. They are written by hand
 * rather than generated, because the generator has no way to guess how a
 * repeatable group should read.
 * ──────────────────────────────────────────────────────────────────────────*/

const STRUCTURED: ModelDef[] = [
  {
    id: 'elevenlabs/text-to-dialogue-v3',
    name: 'ElevenLabs Dialogue v3',
    family: 'ElevenLabs',
    category: 'audio',
    mode: 'text-to-audio',
    api: 'market',
    output: 'audio',
    tagline: 'A conversation between several voices, not one narrator.',
    speed: 'balanced',
    badges: ['Multi-voice'],
    fields: [
      {
        name: 'dialogue',
        kind: 'list',
        label: 'Dialogue',
        description: 'Each line is spoken by the voice you give it, in order.',
        required: true,
        minItems: 1,
        maxItems: 40,
        itemLabel: 'Line',
        item: [
          elevenLabsVoice(),
          {
            name: 'text',
            kind: 'textarea',
            label: 'Line',
            required: true,
            maxLength: 2000,
            placeholder: 'What this voice says…',
          },
        ],
      },
    ],
  },
  {
    id: 'google/gemini-3-1-flash-tts',
    name: 'Gemini 3.1 Flash TTS',
    family: 'Google',
    category: 'audio',
    mode: 'text-to-audio',
    api: 'market',
    output: 'audio',
    tagline: 'Cast the speakers, then write the exchange between them.',
    speed: 'fast',
    badges: ['Multi-voice'],
    fields: [
      {
        name: 'speakers',
        kind: 'list',
        label: 'Speakers',
        description:
          'The cast. Each one gets an id you then use in the turns below.',
        required: true,
        minItems: 1,
        maxItems: 8,
        itemLabel: 'Speaker',
        item: [
          {
            name: 'speaker_id',
            kind: 'text',
            label: 'Id',
            required: true,
            placeholder: 'host',
            description: 'Your own label. The turns below refer to it.',
          },
          {
            name: 'voice_name',
            kind: 'select',
            label: 'Voice',
            options: opts(
              'Achernar', 'Achird', 'Algenib', 'Algieba', 'Alnilam', 'Aoede',
              'Autonoe', 'Callirrhoe', 'Charon', 'Despina', 'Enceladus', 'Erinome',
              'Fenrir', 'Gacrux', 'Iapetus', 'Kore', 'Laomedeia', 'Leda',
              'Orus', 'Puck', 'Pulcherrima', 'Rasalgethi', 'Sadachbia',
              'Sadaltager', 'Schedar', 'Sulafat', 'Umbriel', 'Vindemiatrix',
              'Zephyr', 'Zubenelgenubi',
            ),
            default: 'Kore',
          },
          {
            name: 'accent',
            kind: 'select',
            label: 'Accent',
            options: opts(
              'Neutral', 'American (Gen)', 'American (Valley)', 'American (South)',
              'American (New York)', 'British (RP)', 'British (Cockney)',
              'Australian', 'Irish', 'Scottish', 'Indian', 'French', 'German',
              'Italian', 'Spanish', 'Russian', 'Japanese', 'Korean',
            ),
            default: 'Neutral',
          },
          {
            name: 'style',
            kind: 'select',
            label: 'Style',
            options: opts(
              'Vocal Smile', 'Newscaster', 'Whisper', 'Empathetic', 'Promo/Hype',
              'Deadpan', 'Storyteller', 'Instructional',
            ),
            default: 'Vocal Smile',
            advanced: true,
          },
          {
            name: 'pace',
            kind: 'select',
            label: 'Pace',
            options: opts('Natural', 'Rapid Fire', 'The Drift', 'Staccato'),
            default: 'Natural',
            advanced: true,
          },
        ],
      },
      {
        name: 'dialogue_turns',
        kind: 'list',
        label: 'Turns',
        description: 'Who says what, in order.',
        required: true,
        minItems: 1,
        maxItems: 60,
        itemLabel: 'Turn',
        item: [
          {
            name: 'speaker_id',
            kind: 'text',
            label: 'Speaker',
            required: true,
            placeholder: 'host',
            description: 'One of the ids you gave above.',
          },
          {
            name: 'text',
            kind: 'textarea',
            label: 'Line',
            required: true,
            maxLength: 2000,
          },
        ],
      },
    ],
  },
  {
    id: 'kling-3.0/video',
    name: 'Kling 3',
    family: 'Kuaishou',
    category: 'video',
    mode: 'text-to-video',
    api: 'market',
    output: 'video',
    tagline: 'Kling 3 with a shot list: one prompt and duration per cut.',
    speed: 'slow',
    badges: ['4K', 'Sound'],
    fields: [
      prompt({ maxLength: 5000 }),
      ratio(['16:9', '9:16', '1:1'], '16:9'),
      {
        name: 'mode',
        kind: 'select',
        label: 'Tier',
        options: opts('std', 'pro', '4K'),
        default: 'pro',
      },
      {
        name: 'duration',
        kind: 'select',
        label: 'Duration',
        options: opts(
          '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15',
        ),
        default: '5',
        description: 'Seconds.',
      },
      {
        name: 'sound',
        kind: 'toggle',
        label: 'Generate sound',
        default: false,
      },
      {
        name: 'multi_shots',
        kind: 'toggle',
        label: 'Multiple shots',
        description: 'Cut the result into the shots listed below.',
        default: false,
      },
      imageUrls(4, {
        label: 'Reference images',
        required: false,
        description: 'Optional. Anchors what the shots should look like.',
        maxSizeMb: 20,
      }),
      {
        name: 'multi_prompt',
        kind: 'list',
        label: 'Shot list',
        description: 'One prompt and length per cut. Used when Multiple shots is on.',
        required: true,
        minItems: 1,
        maxItems: 10,
        itemLabel: 'Shot',
        showWhen: { field: 'multi_shots', equals: [true] },
        item: [
          {
            name: 'prompt',
            kind: 'textarea',
            label: 'Shot',
            required: true,
            maxLength: 2000,
            placeholder: 'What happens in this cut…',
          },
          {
            name: 'duration',
            kind: 'slider',
            label: 'Seconds',
            min: 1,
            max: 15,
            step: 1,
            default: 5,
          },
        ],
      },
    ],
  },
  {
    id: 'pixverse-v6/reference-to-video',
    name: 'PixVerse v6 Reference to Video',
    family: 'PixVerse',
    category: 'video',
    mode: 'image-to-video',
    api: 'market',
    output: 'video',
    tagline: 'Name a subject and a background, then describe the motion.',
    speed: 'balanced',
    fields: [
      prompt({ maxLength: 2048 }),
      {
        name: 'image_references',
        kind: 'list',
        label: 'References',
        description: 'Each image is either the subject or the background.',
        required: true,
        minItems: 1,
        maxItems: 4,
        itemLabel: 'Reference',
        item: [
          imageUrl({ label: 'Image', maxSizeMb: 20 }),
          {
            name: 'type',
            kind: 'select',
            label: 'Role',
            options: opts('subject', 'background'),
            default: 'subject',
          },
          {
            name: 'ref_name',
            kind: 'text',
            label: 'Name',
            maxLength: 60,
            placeholder: 'the woman in red',
            description: 'Optional. Lets the prompt refer to this image by name.',
          },
        ],
      },
      ratio(['16:9', '4:3', '1:1', '3:4', '9:16', '2:3', '3:2', '21:9'], '16:9'),
      {
        name: 'quality',
        kind: 'select',
        label: 'Quality',
        options: opts('360p', '540p', '720p', '1080p'),
        default: '720p',
      },
      {
        name: 'duration',
        kind: 'slider',
        label: 'Duration',
        description: 'Seconds.',
        min: 1,
        max: 15,
        step: 1,
        default: 5,
      },
      {
        name: 'generate_audio_switch',
        kind: 'toggle',
        label: 'Generate audio',
        default: false,
      },
      seed(),
    ],
  },
]

export const MODELS: ModelDef[] = [
  ...IMAGE_TEXT,
  ...IMAGE_EDIT,
  ...VIDEO_TEXT,
  ...VIDEO_IMAGE,
  ...VIDEO_AVATAR,
  ...AUDIO,
  ...TEXT,
  ...UTILITY,
  ...STRUCTURED,
  // Derived from Kie's schemas rather than transcribed. See
  // catalog.generated.ts for why that distinction exists.
  ...GENERATED,
]

const BY_ID = new Map(MODELS.map((m) => [m.id, m]))

export function getModel(id: string): ModelDef | undefined {
  return BY_ID.get(id)
}

export function modelsByCategory(category: ModelCategory): ModelDef[] {
  return MODELS.filter((m) => m.category === category)
}

export const CATEGORIES: {
  id: ModelCategory
  label: string
  description: string
}[] = [
  { id: 'image', label: 'Image', description: 'Generate and edit stills' },
  { id: 'video', label: 'Video', description: 'Motion, avatars and lipsync' },
  { id: 'audio', label: 'Audio', description: 'Music, speech and cleanup' },
  { id: 'text', label: 'Text', description: 'Writing, reasoning and analysis' },
  { id: 'utility', label: 'Enhance', description: 'Upscale, cutout, decompose' },
]

export const MODES: { id: ModelMode; label: string }[] = [
  { id: 'text-to-image', label: 'Text → Image' },
  { id: 'image-to-image', label: 'Image → Image' },
  { id: 'text-to-video', label: 'Text → Video' },
  { id: 'image-to-video', label: 'Image → Video' },
  { id: 'video-to-video', label: 'Video → Video' },
  { id: 'audio-to-video', label: 'Audio → Video' },
  { id: 'text-to-audio', label: 'Text → Audio' },
  { id: 'text-to-text', label: 'Text → Text' },
  { id: 'enhance', label: 'Enhance' },
]

/** The model selected on a cold start. */
export const DEFAULT_MODEL_ID = 'google/nano-banana'
