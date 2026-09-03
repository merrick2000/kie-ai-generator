import type { MetadataRoute } from 'next'

import { listSlugs } from '@/lib/blog/store'

export const revalidate = 3600

function origin(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '') || 'http://localhost:3400'
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = origin()

  // The sitemap should still render if the database is briefly unreachable.
  const articles = await listSlugs().catch(() => [])

  return [
    { url: `${base}/blog`, changeFrequency: 'daily', priority: 0.8 },
    ...articles.map((article) => ({
      url: `${base}/blog/${article.slug}`,
      lastModified: new Date(article.updatedAt),
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    })),
  ]
}
