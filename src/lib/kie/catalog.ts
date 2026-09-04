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
import {
  type Field,
  audioUrl,
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
      to: 'image_urls',
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
      to: 'image_urls',
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
    id: 'gpt-image/1-5-text-to-image',
    name: 'GPT Image 1.5',
    family: 'OpenAI',
    category: 'image',
    mode: 'text-to-image',
    api: 'market',
    output: 'image',
    tagline: 'The previous generation, still excellent at diagrams and UI.',
    speed: 'balanced',
    fields: [
      prompt({ maxLength: 20000 }),
      ratio(['auto', '1:1', '3:2', '2:3', '16:9', '9:16'], 'auto'),
      resolution(['1K', '2K'], '1K'),
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
      ratio(['2:3', '3:2', '1:1', '16:9', '9:16'], '1:1'),
      nsfwChecker(),
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
      imageUrls(10),
      ratio(['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'], 'auto'),
      resolution(['1K', '2K', '4K'], '1K'),
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
      imageUrls(10),
      ratio(['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'], '1:1'),
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
      prompt({ maxLength: 5000 }),
      imageUrls(7),
      ratio(['2:3', '3:2', '1:1', '16:9', '9:16'], '1:1'),
      nsfwChecker(),
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
      resolution(['480p', '720p', '1080p'], '720p'),
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
    id: 'kling/v3-omni-text-to-video',
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
      to: 'image_url',
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
      prompt({ maxLength: 5000 }),
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
    id: 'pixverse/text-to-video',
    name: 'PixVerse',
    family: 'PixVerse',
    category: 'video',
    mode: 'text-to-video',
    api: 'market',
    output: 'video',
    tagline: 'Stylised motion with strong anime presets.',
    speed: 'fast',
    routeWithAssets: {
      modelId: 'pixverse/image-to-video',
      from: 'reference_images',
      to: 'image_url',
    },
    fields: [
      prompt({ maxLength: 5000 }),
      optionalReference(1, {
        label: 'Reference image',
        description:
          'Optional. Adding one guides the result instead of generating from the prompt alone.',
      }),
      ratio(['16:9', '9:16', '1:1', '4:3', '3:4'], '16:9'),
      resolution(['360p', '540p', '720p', '1080p'], '720p'),
      {
        name: 'duration',
        kind: 'select',
        label: 'Duration',
        options: [
          { value: '5', label: '5s' },
          { value: '8', label: '8s' },
        ],
        default: '5',
      },
      negativePrompt(),
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
      prompt({ maxLength: 5000 }),
      imageUrl(),
      negativePrompt(),
      resolution(['720p', '1080p'], '1080p'),
      {
        name: 'duration',
        kind: 'number',
        label: 'Duration',
        min: 2,
        max: 15,
        step: 1,
        default: 5,
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
    id: 'pixverse/image-to-video',
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
      prompt({ maxLength: 5000 }),
      imageUrl(),
      resolution(['360p', '540p', '720p', '1080p'], '720p'),
      {
        name: 'duration',
        kind: 'select',
        label: 'Duration',
        options: [
          { value: '5', label: '5s' },
          { value: '8', label: '8s' },
        ],
        default: '5',
      },
      negativePrompt(),
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
        required: false,
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
      prompt({ required: false, maxLength: 5000, label: 'Direction' }),
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
      prompt({ required: false, maxLength: 2000, label: 'Direction' }),
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
      {
        name: 'voice',
        kind: 'select',
        label: 'Voice',
        // Kie exposes voices as ElevenLabs IDs. Names below are the public
        // ElevenLabs library names for the default roster.
        options: [
          { value: 'EkK5I93UQWFDigLMpZcX', label: 'James, warm narrator' },
          { value: 'TX3LPaxmHKxFdv7VOQHJ', label: 'Liam, clear, youthful' },
          { value: 'FGY2WhTYpPnrIDTdsKH5', label: 'Laura, bright, upbeat' },
          { value: 'N2lVS1w4EtoT3dr4eOWO', label: 'Callum, gravelly' },
          { value: 'UgBBYS2sOqTuMpoF3BR0', label: 'Mark, natural, casual' },
          { value: 'kPzsL2i3teMYv0FxEYQ6', label: 'Alice, British, confident' },
          { value: 'nPczCjzI2devNBz1zQrb', label: 'Brian, deep, resonant' },
          { value: 'Xb7hH8MSUJpSbSDYk0k2', label: 'Alice alt' },
          { value: 'cgSgspJ2msm6clMCkdW9', label: 'Jessica, expressive' },
          { value: 'iP95p4xoKVk53GoZ742B', label: 'Chris, conversational' },
          { value: 'onwK4e9ZLuTAKqWW03F9', label: 'Daniel, authoritative' },
          { value: 'pFZP5JQG7iQjIQuC4Bku', label: 'Lily, soft, British' },
        ],
        default: 'EkK5I93UQWFDigLMpZcX',
      },
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
      {
        name: 'voice',
        kind: 'select',
        label: 'Voice',
        options: [
          { value: 'EkK5I93UQWFDigLMpZcX', label: 'James, warm narrator' },
          { value: 'TX3LPaxmHKxFdv7VOQHJ', label: 'Liam, clear, youthful' },
          { value: 'FGY2WhTYpPnrIDTdsKH5', label: 'Laura, bright, upbeat' },
          { value: 'nPczCjzI2devNBz1zQrb', label: 'Brian, deep, resonant' },
        ],
        default: 'EkK5I93UQWFDigLMpZcX',
      },
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

/* ────────────────────────────────────────────────────────────────────────────
 * TEXT, language models
 *
 * These do not go through the job API. They answer in the request, each in
 * its vendor's own format, so every entry carries a `chat` descriptor saying
 * which transport to use and where. See lib/kie/chat.ts.
 * ──────────────────────────────────────────────────────────────────────────*/

const TEXT: ModelDef[] = [
  {
    id: 'chat/claude-opus-5',
    name: 'Claude Opus 5',
    family: 'Anthropic',
    category: 'text',
    mode: 'text-to-text',
    api: 'chat',
    output: 'text',
    tagline: 'The strongest reasoning on offer. Long documents, hard problems.',
    speed: 'slow',
    featured: true,
    badges: ['Reasoning'],
    chat: { transport: 'anthropic-messages', model: 'claude-opus-5', maxTokens: 16384 },
    fields: [
      prompt({ maxLength: 200000, placeholder: 'Ask anything, or paste a document to work on…' }),
      systemPrompt(),
      maxTokens(16384, 64000),
    ],
  },
  {
    id: 'chat/claude-sonnet-5',
    name: 'Claude Sonnet 5',
    family: 'Anthropic',
    category: 'text',
    mode: 'text-to-text',
    api: 'chat',
    output: 'text',
    tagline: 'The everyday workhorse. Nearly Opus quality at a fraction of the wait.',
    speed: 'balanced',
    featured: true,
    chat: { transport: 'anthropic-messages', model: 'claude-sonnet-5', maxTokens: 16384 },
    fields: [
      prompt({ maxLength: 200000, placeholder: 'Ask anything, or paste a document to work on…' }),
      systemPrompt(),
      maxTokens(16384, 64000),
    ],
  },
  {
    id: 'chat/claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    family: 'Anthropic',
    category: 'text',
    mode: 'text-to-text',
    api: 'chat',
    output: 'text',
    tagline: 'Fast and cheap. Right for rewrites, extraction and short answers.',
    speed: 'fast',
    chat: { transport: 'anthropic-messages', model: 'claude-haiku-4-5', maxTokens: 8192 },
    fields: [
      prompt({ maxLength: 200000, placeholder: 'Ask anything…' }),
      systemPrompt(),
      maxTokens(8192, 32000),
    ],
  },
  {
    id: 'chat/gpt-5-2',
    name: 'GPT 5.2',
    family: 'OpenAI',
    category: 'text',
    mode: 'text-to-text',
    api: 'chat',
    output: 'text',
    tagline: 'Reads images alongside the prompt, and can search the web.',
    speed: 'balanced',
    featured: true,
    badges: ['Vision', 'Search'],
    chat: {
      transport: 'openai-chat',
      model: 'gpt-5-2',
      path: 'gpt-5-2',
      effortLevels: ['low', 'high'],
      webSearch: 'web_search',
      vision: true,
    },
    fields: [
      prompt({ maxLength: 100000, placeholder: 'Ask anything…' }),
      systemPrompt(),
      optionalReference(6, {
        name: 'image_urls',
        label: 'Attachments',
        description: 'Optional. Images, and on this endpoint also video, audio or PDF.',
        accepts: 'JPEG, PNG, WebP, PDF, MP4, MP3',
        maxSizeMb: 50,
      }),
      reasoningEffort(['low', 'high'], 'high'),
      webSearchToggle(),
    ],
  },
  {
    id: 'chat/gpt-5-6-sol',
    name: 'GPT 5.6 Sol',
    family: 'OpenAI',
    category: 'text',
    mode: 'text-to-text',
    api: 'chat',
    output: 'text',
    tagline: 'Four levels of deliberation, up to xhigh for the hardest asks.',
    speed: 'slow',
    badges: ['Reasoning'],
    chat: {
      transport: 'openai-responses',
      model: 'gpt-5-6-sol',
      effortLevels: ['low', 'medium', 'high', 'xhigh'],
      webSearch: 'web_search',
    },
    fields: [
      prompt({ maxLength: 100000, placeholder: 'Ask anything…' }),
      systemPrompt(),
      reasoningEffort(['low', 'medium', 'high', 'xhigh'], 'medium'),
      webSearchToggle(),
    ],
  },
  {
    id: 'chat/gpt-5-6-luna',
    name: 'GPT 5.6 Luna',
    family: 'OpenAI',
    category: 'text',
    mode: 'text-to-text',
    api: 'chat',
    output: 'text',
    tagline: 'The lighter 5.6. Quick turnarounds without dropping to a mini model.',
    speed: 'balanced',
    chat: {
      transport: 'openai-responses',
      model: 'gpt-5-6-luna',
      effortLevels: ['low', 'medium', 'high', 'xhigh'],
      webSearch: 'web_search',
    },
    fields: [
      prompt({ maxLength: 100000, placeholder: 'Ask anything…' }),
      systemPrompt(),
      reasoningEffort(['low', 'medium', 'high', 'xhigh'], 'low'),
      webSearchToggle(),
    ],
  },
  {
    id: 'chat/gemini-3-pro',
    name: 'Gemini 3 Pro',
    family: 'Google',
    category: 'text',
    mode: 'text-to-text',
    api: 'chat',
    output: 'text',
    tagline: 'Very long context, grounded in Google Search when you ask for it.',
    speed: 'balanced',
    featured: true,
    badges: ['Vision', 'Search'],
    chat: {
      transport: 'openai-chat',
      model: 'gemini-3-pro',
      path: 'gemini-3-pro',
      webSearch: 'googleSearch',
      vision: true,
    },
    fields: [
      prompt({ maxLength: 200000, placeholder: 'Ask anything, or paste a long document…' }),
      systemPrompt(),
      optionalReference(6, {
        name: 'image_urls',
        label: 'Attachments',
        description: 'Optional. Images, video, audio or PDF, all through the same field.',
        accepts: 'JPEG, PNG, WebP, PDF, MP4, MP3',
        maxSizeMb: 50,
      }),
      webSearchToggle(),
    ],
  },
  {
    id: 'chat/gemini-3-8-flash',
    name: 'Gemini 3.8 Flash',
    family: 'Google',
    category: 'text',
    mode: 'text-to-text',
    api: 'chat',
    output: 'text',
    tagline: 'The cheapest way to run text through a capable model at volume.',
    speed: 'fast',
    badges: ['Vision'],
    chat: {
      transport: 'openai-chat',
      model: 'gemini-3-8-flash',
      // Kie exposes the OpenAI-shaped route under its own slug, distinct from
      // the native streaming one.
      path: 'gemini-3-8-flash-openai',
      effortLevels: ['low', 'high'],
      webSearch: 'googleSearch',
      vision: true,
    },
    fields: [
      prompt({ maxLength: 200000, placeholder: 'Ask anything…' }),
      systemPrompt(),
      optionalReference(6, {
        name: 'image_urls',
        label: 'Attachments',
        description: 'Optional. Images, video, audio or PDF, all through the same field.',
        accepts: 'JPEG, PNG, WebP, PDF, MP4, MP3',
        maxSizeMb: 50,
      }),
      reasoningEffort(['low', 'high'], 'high'),
      webSearchToggle(),
    ],
  },
  {
    id: 'chat/gemini-2-5-flash',
    name: 'Gemini 2.5 Flash',
    family: 'Google',
    category: 'text',
    mode: 'text-to-text',
    api: 'chat',
    output: 'text',
    tagline: 'Proven and inexpensive. A safe default for bulk text work.',
    speed: 'fast',
    chat: {
      transport: 'openai-chat',
      model: 'gemini-2.5-flash',
      path: 'gemini-2.5-flash',
      effortLevels: ['low', 'high'],
      webSearch: 'googleSearch',
      vision: true,
    },
    fields: [
      prompt({ maxLength: 200000, placeholder: 'Ask anything…' }),
      systemPrompt(),
      optionalReference(6, {
        name: 'image_urls',
        label: 'Attachments',
        description: 'Optional. Images, video, audio or PDF, all through the same field.',
        accepts: 'JPEG, PNG, WebP, PDF, MP4, MP3',
        maxSizeMb: 50,
      }),
      reasoningEffort(['low', 'high'], 'high'),
      webSearchToggle(),
    ],
  },
  {
    id: 'chat/grok-4-6',
    name: 'Grok 4.6',
    family: 'xAI',
    category: 'text',
    mode: 'text-to-text',
    api: 'chat',
    output: 'text',
    tagline: 'Blunt, current, and strong on anything that needs live search.',
    speed: 'balanced',
    badges: ['Search'],
    chat: {
      transport: 'grok-responses',
      model: 'grok-4-6',
      effortLevels: ['low', 'medium', 'high', 'xhigh'],
      webSearch: 'web_search',
    },
    fields: [
      prompt({ maxLength: 100000, placeholder: 'Ask anything…' }),
      systemPrompt(),
      reasoningEffort(['low', 'medium', 'high', 'xhigh'], 'medium'),
      webSearchToggle(),
    ],
  },
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
      imageUrls(1, { label: 'Source image' }),
      prompt({
        required: false,
        maxLength: 5000,
        label: 'Direction',
        placeholder: 'Optional. Describe which layers to isolate.',
      }),
    ],
  },
]

/* ────────────────────────────────────────────────────────────────────────────
 * Registry
 * ──────────────────────────────────────────────────────────────────────────*/

export const MODELS: ModelDef[] = [
  ...IMAGE_TEXT,
  ...IMAGE_EDIT,
  ...VIDEO_TEXT,
  ...VIDEO_IMAGE,
  ...VIDEO_AVATAR,
  ...AUDIO,
  ...TEXT,
  ...UTILITY,
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
