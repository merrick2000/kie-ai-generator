'use client'

import {
  ArrowRight,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Lock,
  Mail,
  Music,
  Type,
  Video,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/Button'
import { MODELS } from '@/lib/kie/catalog'
import { cn } from '@/lib/utils'

type Mode = 'signup' | 'login'

interface AuthResponse {
  user?: { id: string; email: string }
  error?: string
  field?: 'email' | 'password'
}

const MIN_PASSWORD_LENGTH = 8

/**
 * Sign up and sign in.
 *
 * One screen with a mode toggle rather than two routes: the fields are
 * identical, and switching should not cost a page load or lose what was typed.
 */
export function AuthScreen({
  initialMode = 'signup',
  signupsAllowed = true,
}: {
  initialMode?: Mode
  signupsAllowed?: boolean
}) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>(signupsAllowed ? initialMode : 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [reveal, setReveal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorField, setErrorField] = useState<'email' | 'password' | null>(null)

  // Hidden entries are the sibling slugs a reference field routes to. They
  // are not separate choices, so counting them would overstate the catalog.
  const listed = MODELS.filter((m) => !m.hidden)

  const counts = {
    total: listed.length,
    image: listed.filter((m) => m.category === 'image' || m.category === 'utility').length,
    video: listed.filter((m) => m.category === 'video').length,
    audio: listed.filter((m) => m.category === 'audio').length,
    text: listed.filter((m) => m.category === 'text').length,
  }

  const switchMode = (next: Mode) => {
    setMode(next)
    setError(null)
    setErrorField(null)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return

    setBusy(true)
    setError(null)
    setErrorField(null)

    try {
      const res = await fetch(`/api/auth/${mode === 'signup' ? 'signup' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = (await res.json()) as AuthResponse

      if (!res.ok || !data.user) {
        setError(data.error ?? 'Something went wrong.')
        setErrorField(data.field ?? null)
        return
      }

      // The server decides what comes next: key setup, or the studio.
      router.refresh()
    } catch {
      setError('Network error. Is the server running?')
    } finally {
      setBusy(false)
    }
  }

  const canSubmit =
    email.trim().length > 0 && password.length >= MIN_PASSWORD_LENGTH

  return (
    <div className="h-dvh overflow-y-auto bg-void">
      <div className="mx-auto grid min-h-full max-w-5xl items-center gap-12 px-6 py-12 lg:grid-cols-2 lg:gap-16">
        <section>
          <div className="mb-6 flex items-center gap-2.5">
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

          <h1 className="text-[32px] font-semibold leading-[1.15] tracking-tight text-ink">
            One studio for every
            <br />
            generative model.
          </h1>

          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-ink-muted">
            {counts.total} models from Google, OpenAI, Anthropic, ByteDance,
            Kuaishou, xAI, Black Forest Labs, ElevenLabs and Suno, behind a
            single interface.
          </p>

          <ul className="mt-8 space-y-3">
            <Capability
              icon={<ImageIcon className="size-4" />}
              count={counts.image}
              label="image models"
              hint="Generate, edit, upscale, cut out"
            />
            <Capability
              icon={<Type className="size-4" />}
              count={counts.text}
              label="language models"
              hint="Writing, reasoning, long documents"
            />
            <Capability
              icon={<Video className="size-4" />}
              count={counts.video}
              label="video models"
              hint="Text, image, avatars, motion transfer"
            />
            <Capability
              icon={<Music className="size-4" />}
              count={counts.audio}
              label="audio models"
              hint="Music, speech, isolation"
            />
          </ul>
        </section>

        <section className="rounded-2xl border border-line bg-surface p-6">
          {signupsAllowed && (
          <div className="mb-5 flex gap-1 rounded-xl border border-line bg-raised p-1">
            {(['signup', 'login'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={cn(
                  'flex-1 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
                  mode === m
                    ? 'bg-overlay text-ink shadow-[inset_0_0_0_1px_var(--color-line-bright)]'
                    : 'text-ink-faint hover:text-ink-muted',
                )}
              >
                {m === 'signup' ? 'Create account' : 'Sign in'}
              </button>
            ))}
          </div>
          )}

          <h2 className="text-[17px] font-semibold text-ink">
            {mode === 'signup' ? 'Create your account' : 'Welcome back'}
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
            {mode === 'signup'
              ? 'You will connect your Kie.ai API key on the next step.'
              : 'Sign in to pick up where you left off.'}
          </p>

          <form onSubmit={submit} className="mt-5 space-y-3">
            <div>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
                <input
                  autoFocus
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    if (error) setError(null)
                  }}
                  placeholder="you@example.com"
                  autoComplete="email"
                  aria-label="Email address"
                  aria-invalid={errorField === 'email'}
                  className={cn(
                    'w-full rounded-xl border bg-raised py-3 pl-10 pr-3 text-sm text-ink',
                    'placeholder:text-ink-faint transition-colors focus:outline-none',
                    errorField === 'email'
                      ? 'border-danger'
                      : 'border-line focus:border-accent',
                  )}
                />
              </div>
            </div>

            <div>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
                <input
                  type={reveal ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    if (error) setError(null)
                  }}
                  placeholder={
                    mode === 'signup'
                      ? `At least ${MIN_PASSWORD_LENGTH} characters`
                      : 'Your password'
                  }
                  autoComplete={
                    mode === 'signup' ? 'new-password' : 'current-password'
                  }
                  aria-label="Password"
                  aria-invalid={errorField === 'password'}
                  className={cn(
                    'w-full rounded-xl border bg-raised py-3 pl-10 pr-11 text-sm text-ink',
                    'placeholder:text-ink-faint transition-colors focus:outline-none',
                    errorField === 'password'
                      ? 'border-danger'
                      : 'border-line focus:border-accent',
                  )}
                />
                <button
                  type="button"
                  onClick={() => setReveal((v) => !v)}
                  aria-label={reveal ? 'Hide password' : 'Show password'}
                  className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-overlay hover:text-ink"
                >
                  {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              {/*
                Only shown while the password is still too short. Confirming
                that a valid password is valid adds a line of coloured text
                that says nothing the enabled button does not already say.
              */}
              {mode === 'signup' &&
                password.length > 0 &&
                password.length < MIN_PASSWORD_LENGTH && (
                  <p className="mt-1.5 text-[11px] text-ink-faint">
                    {MIN_PASSWORD_LENGTH - password.length} more character
                    {MIN_PASSWORD_LENGTH - password.length === 1 ? '' : 's'}
                  </p>
                )}
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
              disabled={!canSubmit}
              loading={busy}
            >
              {!busy && (
                <>
                  {mode === 'signup' ? 'Create account' : 'Sign in'}
                  <ArrowRight className="size-4" />
                </>
              )}
              {busy && (mode === 'signup' ? 'Creating account…' : 'Signing in…')}
            </Button>
          </form>

          {signupsAllowed ? (
            <p className="mt-5 text-center text-[12px] text-ink-faint">
              {mode === 'signup' ? 'Already have an account?' : 'No account yet?'}{' '}
              <button
                type="button"
                onClick={() => switchMode(mode === 'signup' ? 'login' : 'signup')}
                className="font-medium text-accent transition-opacity hover:opacity-80"
              >
                {mode === 'signup' ? 'Sign in' : 'Create one'}
              </button>
            </p>
          ) : (
            <p className="mt-5 text-center text-[12px] text-ink-faint">
              Sign-ups are closed on this instance.
            </p>
          )}
        </section>
      </div>
    </div>
  )
}

function Capability({
  icon,
  count,
  label,
  hint,
}: {
  icon: React.ReactNode
  count: number
  label: string
  hint: string
}) {
  return (
    <li className="flex items-center gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-surface text-ink-muted">
        {icon}
      </span>
      <span>
        <span className="block text-[13px] text-ink">
          <strong className="font-semibold tabular-nums">{count}</strong> {label}
        </span>
        <span className="block text-[12px] text-ink-faint">{hint}</span>
      </span>
    </li>
  )
}
