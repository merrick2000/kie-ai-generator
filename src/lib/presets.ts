/**
 * Starter prompts.
 *
 * These exist to get a first-time user to a good result in one click, so each
 * is written the way the models actually respond best: subject, then setting,
 * then lens and light: not a bare noun.
 */

export interface Preset {
  label: string
  prompt: string
  /** Which model outputs this reads well on. */
  for: ('image' | 'video' | 'audio')[]
}

export const PRESETS: Preset[] = [
  {
    label: 'Cinematic portrait',
    for: ['image', 'video'],
    prompt:
      'A close-up portrait of a woman in her thirties standing at a rain-streaked window at dusk, warm interior lamplight against cool blue exterior, shallow depth of field, 85mm lens, soft film grain, muted teal and amber palette.',
  },
  {
    label: 'Product hero',
    for: ['image'],
    prompt:
      'A matte-black ceramic coffee cup on a polished concrete surface, single hard key light from the upper left casting a long defined shadow, subtle steam, seamless dark grey backdrop, commercial product photography, ultra sharp.',
  },
  {
    label: 'Editorial poster',
    for: ['image'],
    prompt:
      'A minimalist Swiss-style poster with a large geometric sun shape in burnt orange on cream, bold condensed sans-serif headline reading "HORIZON", generous negative space, offset print texture, subtle paper grain.',
  },
  {
    label: 'Neon street',
    for: ['image', 'video'],
    prompt:
      'A rain-slicked Tokyo backstreet at night, neon signage reflecting in puddles, a lone figure with an umbrella walking away from camera, volumetric haze, anamorphic lens flares, cyberpunk colour grade.',
  },
  {
    label: 'Aerial landscape',
    for: ['image', 'video'],
    prompt:
      'A slow aerial push over a fog-filled valley at sunrise, layered mountain ridges receding into haze, golden light catching the topmost peaks, pine forest below, cinematic drone footage, steady motion.',
  },
  {
    label: 'Character sheet',
    for: ['image'],
    prompt:
      'A character reference sheet of a weathered desert explorer, three-quarter view, front view and profile, consistent facial features across all views, sand-worn linen clothing, neutral studio lighting, clean white background.',
  },
  {
    label: 'Talking head',
    for: ['video'],
    prompt:
      'The subject speaks directly to camera with natural warmth, small head movements and genuine micro-expressions, eyes engaged with the lens, subtle shoulder motion, soft key light, shallow background blur.',
  },
  {
    label: 'Ambient score',
    for: ['audio'],
    prompt:
      'A slow ambient piece built on warm analog pads and a distant felt piano, sparse arrangement, tape saturation and long reverb tails, no percussion, contemplative and unhurried.',
  },
  {
    label: 'Upbeat indie',
    for: ['audio'],
    prompt:
      'An upbeat indie pop track with jangly guitars, a driving four-on-the-floor kick, bright layered vocal harmonies in the chorus, handclaps, sunny and nostalgic.',
  },
]

export function presetsFor(output: 'image' | 'video' | 'audio' | 'text'): Preset[] {
  if (output === 'text') return []
  return PRESETS.filter((p) => p.for.includes(output))
}
