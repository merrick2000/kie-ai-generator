import Link from 'next/link'

export default function ArticleNotFound() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-24 text-center">
      <h1 className="text-[24px] font-semibold tracking-tight text-ink">
        Article not found
      </h1>
      <p className="mx-auto mt-2 max-w-sm text-[14px] leading-relaxed text-ink-muted">
        It may have been unpublished, or the link may be wrong.
      </p>
      <Link
        href="/blog"
        className="mt-6 inline-flex rounded-xl bg-accent px-4 py-2 text-[13px] font-semibold text-black transition-opacity hover:opacity-90"
      >
        Back to the blog
      </Link>
    </div>
  )
}
