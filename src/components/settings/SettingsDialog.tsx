'use client'

import {
  ExternalLink,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  ShieldCheck,
  Trash2,
  User,
  X,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { ApiKeyForm } from '@/components/onboarding/ApiKeyForm'
import { BillingTab } from './BillingTab'
import { Button } from '@/components/ui/Button'
import { useCredits } from '@/hooks/useCredits'
import { useSession } from '@/hooks/useSession'
import { MODELS, getModel } from '@/lib/kie/catalog'
import { cn } from '@/lib/utils'
import { useStudio } from '@/store/studio'

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
}

type Tab = 'account' | 'key' | 'billing' | 'defaults' | 'data'

const TABS: { id: Tab; label: string }[] = [
  { id: 'account', label: 'Account' },
  { id: 'key', label: 'API key' },
  { id: 'billing', label: 'Billing' },
  { id: 'defaults', label: 'Defaults' },
  { id: 'data', label: 'Data' },
]

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const [tab, setTab] = useState<Tab>('account')

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-void/80 p-4 backdrop-blur-sm">
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="animate-rise relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line-bright bg-surface shadow-2xl shadow-black/60"
      >
        <header className="rule flex shrink-0 items-center justify-between px-5 py-3.5">
          <h2 className="text-[15px] font-semibold text-ink">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="grid size-7 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-raised hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </header>

        <nav className="rule flex shrink-0 gap-1 px-3 py-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors',
                tab === t.id
                  ? 'bg-raised text-ink'
                  : 'text-ink-faint hover:text-ink-muted',
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {tab === 'account' && <AccountTab />}
          {tab === 'key' && <ApiKeyTab />}
          {tab === 'billing' && <BillingTab />}
          {tab === 'defaults' && <DefaultsTab />}
          {tab === 'data' && <DataTab onClose={onClose} />}
        </div>
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */

function AccountTab() {
  const router = useRouter()
  const session = useSession()
  const [changing, setChanging] = useState(false)

  if (session.loading) return <Loading />

  if (!session.user) {
    return (
      <p className="py-8 text-[13px] text-ink-faint">
        You are not signed in.
      </p>
    )
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-line bg-raised p-4">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-line bg-surface text-accent">
            <User className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-ink">
              {session.user.email}
            </p>
            <p className="mt-0.5 text-[12px] text-ink-faint">
              Member since{' '}
              {new Date(session.user.createdAt).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </p>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setChanging((v) => !v)}>
            {changing ? 'Cancel' : 'Change password'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await session.signOut()
              router.refresh()
            }}
          >
            <LogOut className="size-3.5" />
            Sign out
          </Button>
        </div>
      </div>

      {changing && <ChangePasswordForm onDone={() => setChanging(false)} />}
    </div>
  )
}

function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)

    try {
      const res = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string }

      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Could not change the password.')
        return
      }

      toast.success('Password updated')
      onDone()
    } catch {
      setError('Network error.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-line p-4">
      <input
        type="password"
        value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)}
        placeholder="Current password"
        autoComplete="current-password"
        aria-label="Current password"
        className="w-full rounded-xl border border-line bg-raised px-3 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
      />
      <input
        type="password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        placeholder="New password"
        autoComplete="new-password"
        aria-label="New password"
        className="w-full rounded-xl border border-line bg-raised px-3 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
      />
      {error && (
        <p role="alert" className="text-[12px] text-danger">
          {error}
        </p>
      )}
      <Button
        type="submit"
        size="sm"
        variant="primary"
        loading={busy}
        disabled={!currentPassword || newPassword.length < 8}
      >
        Update password
      </Button>
    </form>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */

function ApiKeyTab() {
  const router = useRouter()
  const session = useSession()
  const { credits, refresh: refreshCredits } = useCredits()
  const [replacing, setReplacing] = useState(false)

  if (session.loading) return <Loading />

  const onSaved = async () => {
    setReplacing(false)
    await session.refresh()
    await refreshCredits()
    toast.success('API key updated')
  }

  const showForm = replacing || session.source === 'none'

  return (
    <div className="space-y-5">
      {!showForm && (
        <div className="rounded-xl border border-line bg-raised p-4">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-line bg-surface text-accent">
              <KeyRound className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-ink">
                {session.source === 'user'
                  ? 'Your API key'
                  : 'Using this deployment\u2019s key'}
              </p>
              <p className="mt-0.5 font-mono text-[12px] text-ink-faint">
                {session.masked ?? 'Set via KIE_API_KEY on the server'}
              </p>
              {credits != null && (
                <p className="mt-2 text-[12px] text-ink-muted">
                  <strong className="font-semibold tabular-nums text-ink">
                    {credits.toLocaleString()}
                  </strong>{' '}
                  credits available
                </p>
              )}
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setReplacing(true)}>
              {session.source === 'user' ? 'Replace key' : 'Use my own key'}
            </Button>
            {session.source === 'user' && (
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await session.removeKey()
                  await refreshCredits()
                  toast.success('API key removed')
                  // Without a fallback the studio has nothing to call, so the
                  // server should send the key setup screen again.
                  if (!session.envAvailable) router.refresh()
                }}
              >
                <Trash2 className="size-3.5" />
                Remove
              </Button>
            )}
          </div>
        </div>
      )}

      {showForm && (
        <div className="space-y-3">
          <ApiKeyForm onSaved={onSaved} submitLabel="Save key" autoFocus={replacing} />
          {replacing && (
            <Button
              size="sm"
              variant="ghost"
              className="w-full"
              onClick={() => setReplacing(false)}
            >
              Cancel
            </Button>
          )}
        </div>
      )}

      <div className="space-y-2.5 rounded-xl border border-line p-4">
        <p className="flex items-start gap-2 text-[12px] leading-relaxed text-ink-faint">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Encrypted with AES-256-GCM before it is stored, and sent only from
            this server to Kie.ai.
          </span>
        </p>
        {!session.secretFromEnv && (
          <p className="flex items-start gap-2 text-[12px] leading-relaxed text-ink-faint">
            <Lock className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Using a generated local secret. Set{' '}
              <code className="font-mono">APP_SECRET</code> in your environment
              so keys survive a lost data directory.
            </span>
          </p>
        )}
        <a
          href="https://kie.ai/api-key"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 text-[12px] text-ink-muted transition-colors hover:text-accent"
        >
          Manage keys on kie.ai
          <ExternalLink className="size-3" />
        </a>
      </div>
    </div>
  )
}

function Loading() {
  return (
    <div className="flex items-center gap-2 py-8 text-[13px] text-ink-faint">
      <Loader2 className="size-4 animate-spin" />
      Loading…
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */

function DefaultsTab() {
  const modelId = useStudio((s) => s.modelId)
  const selectModel = useStudio((s) => s.selectModel)
  const current = getModel(modelId)

  const grouped = ['image', 'video', 'audio', 'utility'] as const

  return (
    <div className="space-y-5">
      <div>
        <label
          htmlFor="default-model"
          className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted"
        >
          Active model
        </label>
        <p className="mb-2 mt-1 text-[12px] leading-relaxed text-ink-faint">
          The studio reopens on whichever model you used last. Pick a different
          one here to switch immediately.
        </p>
        <select
          id="default-model"
          value={modelId}
          onChange={(e) => selectModel(e.target.value)}
          className="w-full cursor-pointer rounded-xl border border-line bg-raised px-3 py-2.5 text-sm text-ink focus:border-accent focus:outline-none"
        >
          {grouped.map((category) => (
            <optgroup key={category} label={category.toUpperCase()}>
              {MODELS.filter((m) => m.category === category).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.family})
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {current && (
        <div className="rounded-xl border border-line bg-raised p-4">
          <p className="text-[13px] font-medium text-ink">{current.name}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
            {current.tagline}
          </p>
          <dl className="mt-3 space-y-1.5 border-t border-line pt-3">
            <Row label="Vendor" value={current.family} />
            <Row label="Mode" value={current.mode.replace(/-/g, ' ')} />
            <Row label="Output" value={current.output} />
            <Row label="Model ID" value={current.id} mono />
          </dl>
        </div>
      )}
    </div>
  )
}

function Row({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-[11px] text-ink-faint">{label}</dt>
      <dd
        className={cn(
          'truncate text-right text-[12px] text-ink-muted',
          mono && 'font-mono text-[11px]',
        )}
      >
        {value}
      </dd>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */

function DataTab({ onClose }: { onClose: () => void }) {
  // The account's whole history, which is what a clear actually affects. The
  // gallery may be filtered, and quoting a filtered number beside a delete
  // button would understate what is about to go.
  const totals = useStudio((s) => s.totals)
  const library = useStudio((s) => s.library)
  const clearHistory = useStudio((s) => s.clearHistory)
  const [confirming, setConfirming] = useState(false)

  const runs = totals?.runs ?? 0
  const pinned = library.filter((j) => j.favorite).length
  const running = totals?.running ?? 0
  // Running jobs are never swept: deleting one abandons a task that is still
  // being paid for upstream.
  const doomed = Math.max(0, runs - pinned - running)

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-line bg-raised p-4">
        <p className="text-[13px] font-medium text-ink">Your history</p>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
          {runs} generation{runs === 1 ? '' : 's'} on your account
          {pinned > 0 ? `, ${pinned} pinned` : ''}. Stored on the server, not in
          this browser, which is why a reload never loses a run in progress and
          why the same history follows you to another device.
        </p>
      </div>

      <div className="rounded-xl border border-warn/25 bg-warn/5 p-4">
        <p className="text-[13px] font-medium text-ink">Asset links expire</p>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
          Kie.ai serves generated files from temporary URLs. Download anything
          worth keeping. Once a link lapses, the thumbnail in your history will
          show as unavailable.
        </p>
      </div>

      {confirming ? (
        <div className="space-y-2 rounded-xl border border-danger/30 bg-danger/5 p-4">
          <p className="text-[13px] text-ink">
            Delete {doomed} generation{doomed === 1 ? '' : 's'}?
            {pinned > 0 && ` ${pinned} pinned item${pinned === 1 ? '' : 's'} will be kept.`}
            {running > 0 &&
              ` ${running} still running, and ${running === 1 ? 'it stays' : 'they stay'} too.`}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                // 'all' rather than the open project: this button sits under
                // a count for the whole account, so it has to match it.
                void clearHistory('all')
                setConfirming(false)
                onClose()
                toast.success('History cleared')
              }}
            >
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          variant="danger"
          disabled={doomed === 0}
          onClick={() => setConfirming(true)}
        >
          <Trash2 className="size-3.5" />
          Clear history
        </Button>
      )}
    </div>
  )
}
