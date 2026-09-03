import type { Metadata } from 'next'
import Link from 'next/link'

import { listArticles } from '@/lib/blog/store'
import { formatArticleDate } from '@/lib/blog/format'

// Rebuilt on demand: the webhook revalidates this path when an article lands,
// so readers get a cached page without it ever going stale.
export const revalidate = 3600

export const metadata: Metadata = {
  title: 'Blog',
  description:
    'Writing on generative models, prompting and the craft of AI image, video and audio production.',
}

export default async function BlogIndex() {
  const articles = await listArticles({ limit: 50 }).catch(() => [])

  return (
    <div className="mx-auto max-w-3xl px-6 py-14">
      <header className="mb-12">
        <h1 className="text-[34px] font-semibold leading-tight tracking-tight text-ink">
          Blog
        </h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-ink-muted">
          Notes on generative models, prompting and getting good output from
          image, video and audio systems.
        </p>
      </header>

      {articles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line px-6 py-16 text-center">
          <p className="text-[14px] font-medium text-ink">No articles yet</p>
          <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-ink-faint">
            Published articles appear here automatically as soon as they are
            sent through.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {articles.map((article) => (
            <li key={article.id}>
              <Link
                href={`/blog/${article.slug}`}
                className="group flex gap-5 rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-line-bright"
              >
                {article.coverImageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={article.coverImageUrl}
                    alt={article.coverImageAlt ?? ''}
                    loading="lazy"
                    className="hidden size-24 shrink-0 rounded-xl object-cover sm:block"
                  />
                )}

                <div className="min-w-0 flex-1">
                  <h2 className="text-[15px] font-medium leading-snug text-ink transition-colors group-hover:text-accent">
                    {article.title}
                  </h2>
                  {article.excerpt && (
                    <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-ink-muted">
                      {article.excerpt}
                    </p>
                  )}
                  <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-faint">
                    <time dateTime={new Date(article.publishedAt).toISOString()}>
                      {formatArticleDate(article.publishedAt)}
                    </time>
                    <span aria-hidden>·</span>
                    <span>{article.readingMinutes} min read</span>
                    {article.keyword && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="rounded bg-raised px-1.5 py-0.5 text-ink-muted">
                          {article.keyword}
                        </span>
                      </>
                    )}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
