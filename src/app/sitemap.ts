import type { MetadataRoute } from 'next'

import { publicOrigin } from '@/lib/public-url'

import { listSlugs } from '@/lib/blog/store'

export const revalidate = 3600



export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = publicOrigin()

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
