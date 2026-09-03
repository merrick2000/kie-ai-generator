'use client'

import { Check, ExternalLink, KeyRound, LogOut, ShieldCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { ApiKeyForm, KeyAccepted } from './ApiKeyForm'

const KIE_SIGNUP = 'https://kie.ai/api-key'

/**
 * Second step of onboarding, shown once the user has an account.
 *
 * Highfield never holds credits of its own: every generation is billed to the
 * user's Kie.ai account, so a key is required before the studio is usable.
 */
export function KeySetup({ email }: { email: string }) {
  const router = useRouter()
  const [credits, setCredits] = useState<number | null>(null)

  const onSaved = (verified: number) => {
    setCredits(verified)
    // Let the confirmation register before swapping to the studio.
    setTimeout(() => router.refresh(), 900)
  }

  const signOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.refresh()
  }

  return (
    <div className="grid h-dvh place-items-center overflow-y-auto bg-void px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-lg bg-accent text-black">
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
            <span className="text-[15px] font-semibold tracking-tight text-ink">
              Highfield
            </span>
          </div>

          <button
            type="button"
            onClick={() => void signOut()}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] text-ink-faint transition-colors hover:bg-raised hover:text-ink"
          >
            <LogOut className="size-3.5" />
            Sign out
          </button>
        </div>

        <ol className="mb-6 flex items-center gap-2 text-[11px]">
          <Step done label="Account" />
          <span className="h-px flex-1 bg-line" aria-hidden />
          <Step label="API key" current />
        </ol>

        <div className="rounded-2xl border border-line bg-surface p-6">
          {credits !== null ? (
            <div className="space-y-4 py-4 text-center">
              <div className="mx-auto grid size-11 place-items-center rounded-xl bg-accent text-black">
                <Check className="size-5" />
              </div>
              <div>
                <h1 className="text-[17px] font-semibold text-ink">All set</h1>
                <p className="mt-1 text-[13px] text-ink-muted">Opening the studio…</p>
              </div>
              <KeyAccepted credits={credits} />
            </div>
          ) : (
            <>
              <div className="mb-5 flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-line bg-raised text-accent">
                  <KeyRound className="size-4" />
                </span>
                <div className="min-w-0">
                  <h1 className="text-[15px] font-semibold text-ink">
                    Connect your Kie.ai key
                  </h1>
                  <p className="mt-0.5 truncate text-[12px] text-ink-faint">
                    Signed in as {email}
                  </p>
                </div>
              </div>

              <p className="mb-4 text-[13px] leading-relaxed text-ink-muted">
                Highfield runs on your own Kie.ai account, so generations are
                billed to you and nothing is shared with other users of this
                instance.
              </p>

              <ApiKeyForm onSaved={onSaved} submitLabel="Open the studio" />

              <div className="my-5 flex items-center gap-3">
                <span className="h-px flex-1 bg-line" />
                <span className="text-[11px] uppercase tracking-[0.08em] text-ink-faint">
                  No key yet
                </span>
                <span className="h-px flex-1 bg-line" />
              </div>

              <a
                href={KIE_SIGNUP}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between gap-3 rounded-xl border border-line bg-raised px-3.5 py-3 transition-colors hover:border-line-bright"
              >
                <span>
                  <span className="block text-[13px] font-medium text-ink">
                    Get a Kie.ai API key
                  </span>
                  <span className="mt-0.5 block text-[12px] text-ink-faint">
                    Free to start. Your key appears right after sign-up
                  </span>
                </span>
                <ExternalLink className="size-4 shrink-0 text-ink-faint" />
              </a>

              <p className="mt-5 flex items-start gap-2 text-[12px] leading-relaxed text-ink-faint">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Your key is encrypted before it is stored and is only ever
                  sent from this server to Kie.ai.
                </span>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Step({
  label,
  done,
  current,
}: {
  label: string
  done?: boolean
  current?: boolean
}) {
  return (
    <li className="flex items-center gap-1.5">
      <span
        className={
          done
            ? 'grid size-4 place-items-center rounded-full bg-accent text-black'
            : current
              ? 'grid size-4 place-items-center rounded-full border border-accent text-accent'
              : 'grid size-4 place-items-center rounded-full border border-line text-ink-faint'
        }
      >
        {done ? <Check className="size-2.5" /> : <span className="size-1 rounded-full bg-current" />}
      </span>
      <span className={done || current ? 'text-ink-muted' : 'text-ink-faint'}>
        {label}
      </span>
    </li>
  )
}
