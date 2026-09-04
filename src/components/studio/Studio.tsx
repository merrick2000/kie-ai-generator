'use client'

import { Sparkles, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { useWorkspace } from '@/hooks/useWorkspace'
import { cn } from '@/lib/utils'
import { Canvas } from './Canvas'
import { Composer } from './Composer'
import { TopBar } from './TopBar'

/** Below this the composer is a slide-over rather than a second pane. */
const NARROW = '(max-width: 1023px)'

/**
 * Studio shell.
 *
 * Two panes on desktop: composer left, results right. On a phone there is no
 * room for two, so the composer becomes a full-height sheet and the results
 * keep the whole screen.
 */
export function Studio() {
  const [railOpen, setRailOpen] = useState(true)
  const [isNarrow, setIsNarrow] = useState(false)

  // One sync loop for the whole studio. Mounted here rather than per card,
  // so the number of requests does not grow with the size of the gallery.
  useWorkspace()

  useEffect(() => {
    const query = window.matchMedia(NARROW)
    const sync = () => {
      setIsNarrow(query.matches)
      // Start collapsed on a phone so results are visible on first paint.
      setRailOpen(!query.matches)
    }
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  // Escape closes the sheet, which is what a sheet over content should do.
  useEffect(() => {
    if (!isNarrow || !railOpen) return

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRailOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isNarrow, railOpen])

  return (
    // overflow-hidden belongs here rather than on the body: the studio is the
    // pane that fills the viewport and scrolls internally.
    <div className="flex h-dvh flex-col overflow-hidden bg-void">
      <TopBar />

      <div className="relative flex min-h-0 flex-1">
        <aside
          className={cn(
            'z-30 flex shrink-0 flex-col border-r border-line bg-surface transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
            // Never wider than the screen it is covering. At 340 flat, a
            // 390px phone was left with a 50px strip of gallery behind it.
            'w-[min(340px,calc(100vw-2.5rem))] lg:w-[340px]',
            isNarrow && 'absolute inset-y-0 left-0 shadow-2xl shadow-black/60',
            isNarrow && !railOpen && '-translate-x-full',
            !isNarrow && !railOpen && 'hidden',
          )}
          aria-hidden={isNarrow && !railOpen}
        >
          {isNarrow && (
            <div className="rule flex shrink-0 items-center justify-between px-4 py-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
                Compose
              </span>
              <button
                type="button"
                onClick={() => setRailOpen(false)}
                aria-label="Close the composer"
                className="grid size-7 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-raised hover:text-ink"
              >
                <X className="size-4" />
              </button>
            </div>
          )}

          <Composer />
        </aside>

        {isNarrow && railOpen && (
          <div
            className="absolute inset-0 z-20 bg-void/60 backdrop-blur-sm"
            onClick={() => setRailOpen(false)}
            aria-hidden
          />
        )}

        <main className="relative min-w-0 flex-1">
          {/*
            The toggle used to float at the top-left corner of this pane,
            directly on top of the gallery's search field. It lives in the
            toolbar now, where it has a column of its own.
          */}
          <Canvas
            composerOpen={railOpen}
            onOpenComposer={() => setRailOpen(true)}
            showComposerButton={!isNarrow}
          />

          {/*
            On a phone the primary action gets a thumb-reachable button of its
            own. The top-left corner of a 390px screen is the worst place to
            put the one control that leads to Generate.
          */}
          {isNarrow && !railOpen && (
            <button
              type="button"
              onClick={() => setRailOpen(true)}
              className="animate-rise absolute bottom-5 right-4 z-10 flex h-12 items-center gap-2 rounded-full bg-accent pl-4 pr-5 text-[14px] font-semibold text-black shadow-2xl shadow-black/50 transition-transform active:scale-[0.97]"
            >
              <Sparkles className="size-4" />
              Create
            </button>
          )}
        </main>
      </div>
    </div>
  )
}
