import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,

  // Emits .next/standalone with a minimal server and only the node_modules it
  // actually uses, which is what the Docker runner stage copies.
  output: 'standalone',

  // Several lockfiles exist above this directory; pin the root explicitly so
  // Next does not infer the wrong one for output file tracing.
  outputFileTracingRoot: __dirname,

  images: { unoptimized: true },

  // Native and Node-only drivers must stay external to the server bundle.
  serverExternalPackages: ['better-sqlite3', 'pg'],

  // Generated media can be large; allow a generous body for base64 uploads.
  experimental: { serverActions: { bodySizeLimit: '25mb' } },
}

export default config
