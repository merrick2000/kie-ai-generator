/**
 * Article repository.
 */

import 'server-only'

import { getDb } from '@/lib/db'

export interface Article {
  id: string
  slug: string
  title: string
  html: string
  excerpt: string | null
  coverImageUrl: string | null
  coverImageAlt: string | null
  keyword: string | null
  language: string
  seoTitle: string | null
  seoDescription: string | null
  seoKeywords: string[]
  projectId: string | null
  projectName: string | null
  readingMinutes: number
  publishedAt: number
  createdAt: number
  updatedAt: number
}

interface ArticleRow {
  id: string
  slug: string
  title: string
  html: string
  excerpt: string | null
  cover_image_url: string | null
  cover_image_alt: string | null
  keyword: string | null
  language: string
  seo_title: string | null
  seo_description: string | null
  seo_keywords: string | null
  project_id: string | null
  project_name: string | null
  reading_minutes: number | string
  published_at: number | string
  created_at: number | string
  updated_at: number | string
}

/** Postgres returns BIGINT as a string to protect precision in JS. */
const num = (v: number | string): number =>
  typeof v === 'number' ? v : Number(v)

function toArticle(row: ArticleRow): Article {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    html: row.html,
    excerpt: row.excerpt,
    coverImageUrl: row.cover_image_url,
    coverImageAlt: row.cover_image_alt,
    keyword: row.keyword,
    language: row.language,
    seoTitle: row.seo_title,
    seoDescription: row.seo_description,
    // Stored as JSON so the column stays portable and needs no array type.
    seoKeywords: parseKeywords(row.seo_keywords),
    projectId: row.project_id,
    projectName: row.project_name,
    readingMinutes: num(row.reading_minutes),
    publishedAt: num(row.published_at),
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at),
  }
}

function parseKeywords(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : []
  } catch {
    return []
  }
}

/** Fields the listing needs, without dragging every article body along. */
export type ArticleSummary = Omit<Article, 'html'>

const SUMMARY_COLUMNS = `
  id, slug, title, '' AS html, excerpt, cover_image_url, cover_image_alt,
  keyword, language, seo_title, seo_description, seo_keywords,
  project_id, project_name, reading_minutes, published_at, created_at, updated_at
`

export async function listArticles(
  { limit = 24, offset = 0 } = {},
): Promise<ArticleSummary[]> {
  const db = await getDb()
  const rows = await db.all<ArticleRow>(
    `SELECT ${SUMMARY_COLUMNS} FROM articles
      ORDER BY published_at DESC
      LIMIT ? OFFSET ?`,
    [limit, offset],
  )
  return rows.map(toArticle)
}

export async function countArticles(): Promise<number> {
  const db = await getDb()
  const row = await db.get<{ count: number | string }>(
    'SELECT COUNT(*) AS count FROM articles',
  )
  return Number(row?.count ?? 0)
}

export async function getArticleBySlug(slug: string): Promise<Article | null> {
  const db = await getDb()
  const row = await db.get<ArticleRow>('SELECT * FROM articles WHERE slug = ?', [slug])
  return row ? toArticle(row) : null
}

/** Slugs for the sitemap and for static params. */
export async function listSlugs(): Promise<{ slug: string; updatedAt: number }[]> {
  const db = await getDb()
  const rows = await db.all<{ slug: string; updated_at: number | string }>(
    'SELECT slug, updated_at FROM articles ORDER BY published_at DESC',
  )
  return rows.map((r) => ({ slug: r.slug, updatedAt: num(r.updated_at) }))
}

export interface ArticleInput {
  id: string
  slug: string
  title: string
  html: string
  excerpt: string | null
  coverImageUrl: string | null
  coverImageAlt: string | null
  keyword: string | null
  language: string
  seoTitle: string | null
  seoDescription: string | null
  seoKeywords: string[]
  projectId: string | null
  projectName: string | null
  readingMinutes: number
  publishedAt: number
}

/**
 * Insert or update an article.
 *
 * Keyed on the upstream id, so a corrected article resent by the publisher
 * replaces the existing one instead of appearing twice.
 *
 * A slug can collide with a different article's, and the column is unique, so
 * the slug is made unique inside the same transaction that writes the row.
 */
export async function upsertArticle(
  input: ArticleInput,
): Promise<{ article: Article; created: boolean }> {
  const db = await getDb()
  const now = Date.now()

  return db.transaction(async (tx) => {
    const existing = await tx.get<{ id: string; created_at: number | string }>(
      'SELECT id, created_at FROM articles WHERE id = ?',
      [input.id],
    )

    const slug = await uniqueSlug(tx, input.slug, input.id)

    if (existing) {
      await tx.run(
        `UPDATE articles SET
           slug = ?, title = ?, html = ?, excerpt = ?,
           cover_image_url = ?, cover_image_alt = ?, keyword = ?, language = ?,
           seo_title = ?, seo_description = ?, seo_keywords = ?,
           project_id = ?, project_name = ?, reading_minutes = ?,
           published_at = ?, updated_at = ?
         WHERE id = ?`,
        [
          slug, input.title, input.html, input.excerpt,
          input.coverImageUrl, input.coverImageAlt, input.keyword, input.language,
          input.seoTitle, input.seoDescription, JSON.stringify(input.seoKeywords),
          input.projectId, input.projectName, input.readingMinutes,
          input.publishedAt, now, input.id,
        ],
      )
    } else {
      await tx.run(
        `INSERT INTO articles (
           id, slug, title, html, excerpt, cover_image_url, cover_image_alt,
           keyword, language, seo_title, seo_description, seo_keywords,
           project_id, project_name, reading_minutes, published_at,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.id, slug, input.title, input.html, input.excerpt,
          input.coverImageUrl, input.coverImageAlt, input.keyword, input.language,
          input.seoTitle, input.seoDescription, JSON.stringify(input.seoKeywords),
          input.projectId, input.projectName, input.readingMinutes,
          input.publishedAt, now, now,
        ],
      )
    }

    const row = await tx.get<ArticleRow>('SELECT * FROM articles WHERE id = ?', [input.id])
    if (!row) throw new Error('Article vanished immediately after being written.')

    return { article: toArticle(row), created: !existing }
  })
}

/**
 * Return `slug`, or `slug-2`, `slug-3`… when another article already holds it.
 *
 * Runs inside the caller's transaction so the check and the write cannot be
 * separated by a concurrent insert.
 */
async function uniqueSlug(
  tx: Awaited<ReturnType<typeof getDb>>,
  desired: string,
  articleId: string,
): Promise<string> {
  const base = desired || 'article'

  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`
    const clash = await tx.get<{ id: string }>(
      'SELECT id FROM articles WHERE slug = ? AND id <> ?',
      [candidate, articleId],
    )
    if (!clash) return candidate
  }

  // Practically unreachable; a suffix keeps the write succeeding regardless.
  return `${base}-${Date.now()}`
}

export async function deleteArticle(id: string): Promise<void> {
  const db = await getDb()
  await db.run('DELETE FROM articles WHERE id = ?', [id])
}
