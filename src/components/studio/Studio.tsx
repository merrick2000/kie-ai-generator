'use client'

import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useEffect, useState } from 'react'

import { useWorkspace } from '@/hooks/useWorkspace'
import { cn } from '@/lib/utils'
import { Canvas } from './Canvas'
import { Composer } from './Composer'
import { TopBar } from './TopBar'

/**
 * Studio shell.
 *
 * Two panes on desktop: composer left, results right. On narrow screens the
 * composer becomes a slide-over so the results grid keeps the full width.
 */
export function Studio() {
  const [railOpen, setRailOpen] = useState(true)
  const [isMobile, setIsMobile] = useState(false)

  // One sync loop for the whole studio. Mounted here rather than per card,
  // so the number of requests does not grow with the size of the gallery.
  useWorkspace()

  useEffect(() => {
    const query = window.matchMedia('(max-width: 1023px)')
    const sync = () => {
      setIsMobile(query.matches)
      // Start collapsed on mobile so results are visible on first paint.
      setRailOpen(!query.matches)
    }
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  return (
    // overflow-hidden belongs here rather than on the body: the studio is the
    // pane that fills the viewport and scrolls internally.
    <div className="flex h-dvh flex-col overflow-hidden bg-void">
      <TopBar />

      <div className="relative flex min-h-0 flex-1">
        <aside
          className={cn(
            'z-30 flex w-[340px] shrink-0 flex-col border-r border-line bg-surface transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
            isMobile && 'absolute inset-y-0 left-0 shadow-2xl shadow-black/60',
            isMobile && !railOpen && '-translate-x-full',
            !isMobile && !railOpen && 'hidden',
          )}
        >
          <Composer />
        </aside>

        {isMobile && railOpen && (
          <div
            className="absolute inset-0 z-20 bg-void/60 backdrop-blur-sm"
            onClick={() => setRailOpen(false)}
            aria-hidden
          />
        )}

        <main className="relative min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setRailOpen((v) => !v)}
            aria-label={railOpen ? 'Hide composer' : 'Show composer'}
            className={cn(
              'absolute left-3 top-3 z-10 grid size-8 place-items-center rounded-lg border border-line bg-surface/90 text-ink-faint backdrop-blur transition-colors hover:text-ink',
              railOpen && !isMobile && 'hidden',
            )}
          >
            {railOpen ? (
              <PanelLeftClose className="size-4" />
            ) : (
              <PanelLeftOpen className="size-4" />
            )}
          </button>

          <Canvas />
        </main>
      </div>
    </div>
  )
}
