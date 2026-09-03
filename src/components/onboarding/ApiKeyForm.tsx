'use client'

import { ArrowRight, Check, Eye, EyeOff, Loader2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

interface ApiKeyFormProps {
  /** Called after the key is validated and stored. */
  onSaved: (credits: number, masked: string) => void
  submitLabel?: string
  autoFocus?: boolean
}

interface SaveResponse {
  ok?: boolean
  credits?: number
  masked?: string
  error?: string
}

/**
 * Key entry with server-side validation.
 *
 * The key is POSTed to /api/kie/session, which checks it against Kie.ai
 * before storing it: a typo is caught here rather than on the first
 * generation, and the balance comes back as proof it works.
 */
export function ApiKeyForm({
  onSaved,
  submitLabel = 'Connect',
  autoFocus = true,
}: ApiKeyFormProps) {
  const [key, setKey] = useState('')
  const [reveal, setReveal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!key.trim() || saving) return

    setSaving(true)
    setError(null)

    try {
      const res = await fetch('/api/kie/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key.trim() }),
      })
      const data = (await res.json()) as SaveResponse

      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Could not save that key.')
        return
      }

      setKey('')
      onSaved(data.credits ?? 0, data.masked ?? '')
    } catch {
      setError('Network error. Is the server running?')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="relative">
        <input
          autoFocus={autoFocus}
          value={key}
          onChange={(e) => {
            setKey(e.target.value)
            if (error) setError(null)
          }}
          type={reveal ? 'text' : 'password'}
          placeholder="Paste your Kie.ai API key"
          autoComplete="off"
          spellCheck={false}
          aria-label="Kie.ai API key"
          aria-invalid={Boolean(error)}
          className={cn(
            'w-full rounded-xl border bg-raised py-3 pl-3 pr-11 font-mono text-sm text-ink',
            'placeholder:font-sans placeholder:text-ink-faint',
            'transition-colors focus:outline-none',
            error ? 'border-danger' : 'border-line focus:border-accent',
          )}
        />
        <button
          type="button"
          onClick={() => setReveal((v) => !v)}
          aria-label={reveal ? 'Hide key' : 'Show key'}
          className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-overlay hover:text-ink"
        >
          {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>

      {error && (
        <p role="alert" className="text-[12px] leading-relaxed text-danger">
          {error}
        </p>
      )}

      <Button
        type="submit"
        variant="primary"
        size="lg"
        className="w-full"
        disabled={!key.trim()}
        loading={saving}
      >
        {saving ? (
          'Verifying with Kie.ai…'
        ) : (
          <>
            {submitLabel}
            <ArrowRight className="size-4" />
          </>
        )}
      </Button>
    </form>
  )
}

/** Small success confirmation reused by the onboarding and settings screens. */
export function KeyAccepted({ credits }: { credits: number }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-ok/30 bg-ok/10 px-3 py-2.5 text-[13px] text-ok">
      <Check className="size-4 shrink-0" />
      <span>
        Key verified. <strong className="font-semibold">{credits.toLocaleString()}</strong>{' '}
        credits available.
      </span>
    </div>
  )
}

export function KeyChecking() {
  return (
    <div className="flex items-center gap-2 text-[13px] text-ink-faint">
      <Loader2 className="size-4 animate-spin" />
      Checking…
    </div>
  )
}
