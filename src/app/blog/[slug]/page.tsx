import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { formatArticleDate } from '@/lib/blog/format'
import { getArticleBySlug } from '@/lib/blog/store'

export const revalidate = 3600

interface Props {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const article = await getArticleBySlug(slug).catch(() => null)

  if (!article) return { title: 'Article not found' }

  const title = article.seoTitle || article.title
  const description = article.seoDescription || article.excerpt || undefined

  return {
    title,
    description,
    keywords: article.seoKeywords.length ? article.seoKeywords : undefined,
    alternates: { canonical: `/blog/${article.slug}` },
    openGraph: {
      type: 'article',
      title,
      description,
      publishedTime: new Date(article.publishedAt).toISOString(),
      modifiedTime: new Date(article.updatedAt).toISOString(),
      images: article.coverImageUrl ? [{ url: article.coverImageUrl }] : undefined,
    },
    twitter: {
      card: article.coverImageUrl ? 'summary_large_image' : 'summary',
      title,
      description,
      images: article.coverImageUrl ? [article.coverImageUrl] : undefined,
    },
  }
}

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params
  const article = await getArticleBySlug(slug).catch(() => null)

  if (!article) notFound()

  // Article schema, so search engines and AI answer engines can attribute the
  // piece rather than guessing at it.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.seoDescription ?? article.excerpt ?? undefined,
    image: article.coverImageUrl ?? undefined,
    datePublished: new Date(article.publishedAt).toISOString(),
    dateModified: new Date(article.updatedAt).toISOString(),
    inLanguage: article.language,
    keywords: article.seoKeywords.length ? article.seoKeywords.join(', ') : undefined,
    publisher: { '@type': 'Organization', name: 'Highfield' },
  }

  return (
    <article className="mx-auto max-w-3xl px-6 py-14">
      <script
        type="application/ld+json"
        // Serialised JSON only, never user-controlled markup.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <nav className="mb-8">
        <Link
          href="/blog"
          className="text-[12px] text-ink-faint transition-colors hover:text-accent"
        >
          Back to the blog
        </Link>
      </nav>

      <header className="mb-10">
        <h1 className="text-[34px] font-semibold leading-[1.15] tracking-tight text-ink">
          {article.title}
        </h1>

        <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-faint">
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
      </header>

      {article.coverImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={article.coverImageUrl}
          alt={article.coverImageAlt ?? ''}
          className="mb-10 w-full rounded-2xl border border-line object-cover"
        />
      )}

      {/*
        Safe by construction: the body was filtered against an allowlist when
        the webhook stored it, so no script, style or event handler survives in
        the row being rendered here.
      */}
      <div
        className="article-body"
        dangerouslySetInnerHTML={{ __html: article.html }}
      />
    </article>
  )
}
