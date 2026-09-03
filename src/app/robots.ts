import type { MetadataRoute } from 'next'

import { publicOrigin } from '@/lib/public-url'



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
    sitemap: `${publicOrigin()}/sitemap.xml`,
  }
}
