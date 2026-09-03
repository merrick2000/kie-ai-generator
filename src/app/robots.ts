import type { MetadataRoute } from 'next'

function origin(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '') || 'http://localhost:3400'
}

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        // The blog is meant to be indexed; the studio and its APIs are not.
        allow: ['/blog'],
        disallow: ['/api/', '/'],
      },
    ],
    sitemap: `${origin()}/sitemap.xml`,
  }
}
