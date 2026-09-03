import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * Public blog shell.
 *
 * Deliberately outside the studio's auth gate: `/` decides between sign-in,
 * key setup and the studio, while everything under `/blog` is readable by
 * anyone. Nothing here touches the session.
 */
export default function BlogLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-void">
      <header className="sticky top-0 z-40 glass rule">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-4 px-6">
          <Link href="/blog" className="flex items-center gap-2.5">
            <span className="grid size-7 place-items-center rounded-lg bg-accent text-black">
              <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
                <path
                  d="M3 12.5 8 3l5 9.5H3Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="text-[14px] font-semibold tracking-tight text-ink">
              Highfield
            </span>
          </Link>

          <Link
            href="/"
            className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-black transition-opacity hover:opacity-90"
          >
            Open the studio
          </Link>
        </div>
      </header>

      <main>{children}</main>

      <footer className="mt-20 border-t border-line">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 px-6 py-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12px] text-ink-faint">
            Highfield, an AI generation studio powered by Kie.ai.
          </p>
          <Link
            href="/"
            className="text-[12px] text-ink-muted transition-colors hover:text-accent"
          >
            Start generating
          </Link>
        </div>
      </footer>
    </div>
  )
}
