/**
 * Hosts that serve generated media.
 *
 * One list, read by two things that must agree: the download proxy, which
 * refuses anything else so it cannot become an open relay, and Next's image
 * optimiser, which refuses to resize an image from a host it was not told
 * about. Kept apart from both so neither can quietly gain a host the other
 * does not have, which would show up as an asset that displays but cannot be
 * saved, or the reverse.
 *
 * No `server-only` here on purpose: `next.config.ts` imports it, and that runs
 * outside the app graph.
 *
 * Entries are registrable domains, never subdomains of one another: matching
 * is by suffix, so a subdomain entry is dead weight here and, in the image
 * config, two more patterns against a hard cap of fifty.
 */
export const ASSET_HOST_SUFFIXES = [
  'kie.ai',
  'redpandaai.co',
  'aiquickdraw.com',
  'sunoapi.org',
  'suno.ai',
  'replicate.delivery',
  'googleapis.com',
  'googleusercontent.com',
  'bytedance.com',
  'byteintlapi.com',
  'volccdn.com',
  'klingai.com',
  'kwaicdn.com',
  'elevenlabs.io',
  'openai.com',
  'oaiusercontent.com',
  'bfl.ai',
  'ideogram.ai',
  'minimaxi.com',
  'minimax.io',
  'aliyuncs.com',
  'x.ai',
  'pixverse.ai',
  'topazlabs.com',
] as const

export function isAssetHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return ASSET_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  )
}
