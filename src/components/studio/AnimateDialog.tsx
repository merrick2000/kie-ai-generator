'use client'

import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { useReuseAsset } from '@/hooks/useReuseAsset'
import { getModel } from '@/lib/kie/catalog'
import type { TaskAsset } from '@/lib/kie/tasks'
import { cn } from '@/lib/utils'

/**
 * Where an audio result can go to become a talking or singing face.
 *
 * Ordered by how much audio each takes, since the likeliest input is a Suno
 * song of two to four minutes: only Kling Avatar accepts that whole, and
 * OmniHuman degrades past fifteen seconds.
 */
const TARGETS: { id: string; hint: string; needsVideo?: boolean }[] = [
  { id: 'kling/ai-avatar-pro', hint: 'A photo and up to 5 minutes of audio. Best for whole songs.' },
  { id: 'kling/ai-avatar-standard', hint: 'Same as Pro, cheaper and a little softer.' },
  { id: 'infinitalk/from-audio', hint: 'A photo, any length. Good for long speech.' },
  { id: 'wan/2-2-a14b-speech-to-video-turbo', hint: 'A photo and a prompt. Short clips.' },
  { id: 'omnihuman-1-5', hint: 'Most expressive. Under 60 s, best under 15 s.' },
  { id: 'volcengine/video-to-video-lip-sync', hint: 'Puts this audio on an existing video.', needsVideo: true },
]

export function AnimateDialog({ asset, onClose }: { asset: TaskAsset; onClose: () => void }) {
  const { reuse, working } = useReuseAsset()
  const [mounted, setMounted] = useState(false)
  const [choice, setChoice] = useState<string | null>(null)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  const targets = TARGETS.filter((t) => getModel(t.id))

  return createPortal(
    <div className="fixed inset-0 z-[120] grid place-items-center bg-void/80 p-4 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Animate with this audio"
        className="animate-rise relative w-full max-w-md overflow-hidden rounded-2xl border border-line-bright bg-surface shadow-2xl shadow-black/60"
      >
        <header className="rule flex items-center justify-between gap-3 px-5 py-3.5">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Animate with this audio</h2>
            <p className="mt-0.5 text-[12px] text-ink-faint">
              The audio is loaded into the model. Add a photo there, then generate.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-7 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-overlay hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </header>

        <ul className="max-h-[60vh] space-y-1 overflow-y-auto p-2">
          {targets.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                disabled={working}
                onClick={async () => {
                  setChoice(t.id)
                  if (await reuse(asset, t.id)) onClose()
                  setChoice(null)
                }}
                className={cn(
                  'w-full rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-raised disabled:opacity-60',
                  choice === t.id && 'bg-raised',
                )}
              >
                <span className="block text-[13px] font-medium text-ink">
                  {getModel(t.id)!.name}
                  {choice === t.id && working && <span className="ml-2 text-[11px] text-ink-faint">Loading…</span>}
                </span>
                <span className="block text-[12px] text-ink-faint">{t.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  )
}
