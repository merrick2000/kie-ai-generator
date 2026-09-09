import type { NextConfig } from 'next'

import { ASSET_HOST_SUFFIXES } from './src/lib/kie/asset-hosts'

const config: NextConfig = {
  reactStrictMode: true,

  // Emits .next/standalone with a minimal server and only the node_modules it
  // actually uses, which is what the Docker runner stage copies.
  output: 'standalone',

  // Several lockfiles exist above this directory; pin the root explicitly so
  // Next does not infer the wrong one for output file tracing.
  outputFileTracingRoot: __dirname,

  /*
   * Image optimisation, which was off.
   *
   * With it off every gallery tile downloaded the original: a Seedream 5 Pro
   * frame is several megabytes, and thirty of them painted in visible bands
   * because the bytes were still arriving. On it resizes to the tile it is
   * actually drawn at, converts to WebP or AVIF, and caches the result, so
   * the same tile costs tens of kilobytes instead.
   *
   * The optimiser fetches the source itself, server side, which is also why
   * the display path no longer needs the download proxy: the browser never
   * touches the provider's CDN, so its missing CORS headers stop mattering.
   */
  images: {
    // Two per host, the domain and anything under it. Next caps this list at
    // fifty, so the host list is kept free of entries that are subdomains of
    // another one: they match by suffix anyway.
    remotePatterns: ASSET_HOST_SUFFIXES.flatMap((suffix) => [
      { protocol: 'https' as const, hostname: suffix },
      { protocol: 'https' as const, hostname: `**.${suffix}` },
    ]),
    // The widths a tile is ever drawn at. Trimmed from the defaults because
    // every extra entry is another variant to generate and store.
    imageSizes: [64, 128, 256, 384],
    deviceSizes: [640, 828, 1080, 1920],
    formats: ['image/avif', 'image/webp'],
    // A generated asset never changes at its URL, and the URL itself expires
    // upstream long before this does.
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },

  // Native and Node-only drivers must stay external to the server bundle.
  serverExternalPackages: ['better-sqlite3', 'pg'],

  // Generated media can be large; allow a generous body for base64 uploads.
  experimental: { serverActions: { bodySizeLimit: '25mb' } },

}

export default config
