'use client'

import { ArrowLeft, Pause, Play, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { Feed, toFeed } from './Feed'
import { StatGrid } from './StatGrid'
import { UsersTable } from './UsersTable'
import type { ActivityEvent, AdminRun, AdminUser, Overview } from './types'

/** Often enough to watch a run finish, rarely enough to leave open all day. */
const POLL_MS = 10_000

interface Snapshot {
  overview: Overview
  mode: 'configured' | 'first-account'
  users: AdminUser[]
  events: ActivityEvent[]
  runs: AdminRun[]
}

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, cache: 'no-store' })
  if (!res.ok) throw new Error(`${url} answered ${res.status}`)
  return res.json() as Promise<T>
}

export function AdminDashboard({ email }: { email: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)

  // Held in a ref so the poll effect does not restart on every fetch, which
  // would reset the interval and quietly poll far faster than intended.
  const userIdRef = useRef(userId)
  userIdRef.current = userId

  const load = useCallback(async (signal: AbortSignal) => {
    const who = userIdRef.current
    const query = who ? `?userId=${encodeURIComponent(who)}&limit=80` : '?limit=80'

    const [overview, users, activity] = await Promise.all([
      fetchJson<{ overview: Overview; mode: Snapshot['mode'] }>(
        '/api/admin/overview',
        signal,
      ),
      fetchJson<{ users: AdminUser[] }>('/api/admin/users', signal),
      fetchJson<{ events: ActivityEvent[]; runs: AdminRun[] }>(
        `/api/admin/activity${query}`,
        signal,
      ),
    ])

    setSnapshot({
      overview: overview.overview,
      mode: overview.mode,
      users: users.users,
      events: activity.events,
      runs: activity.runs,
    })
    setError(null)
  }, [])

  const refresh = useCallback(async () => {
    const controller = new AbortController()
    setRefreshing(true)
    try {
      await load(controller.signal)
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Could not reach the server.')
      }
    } finally {
      setRefreshing(false)
    }
  }, [load])

  // First load, and every change of the account filter.
  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal).catch((err: unknown) => {
      if (controller.signal.aborted) return
      setError(err instanceof Error ? err.message : 'Could not reach the server.')
    })
    return () => controller.abort()
  }, [load, userId])

  useEffect(() => {
    if (!live) return

    const controller = new AbortController()
    const timer = setInterval(() => {
      // A tab nobody is looking at does not need to be up to date, and
      // polling one for hours is how a dashboard becomes the thing generating
      // the load it reports.
      if (document.hidden) return
      load(controller.signal).catch(() => {
        // Left to the visible error from an explicit refresh: a blip between
        // two polls should not replace a working page with a failure.
      })
    }, POLL_MS)

    return () => {
      clearInterval(timer)
      controller.abort()
    }
  }, [live, load])

  const feed = useMemo(
    () => (snapshot ? toFeed(snapshot.events, snapshot.runs) : []),
    [snapshot],
  )

  const selectedUser = snapshot?.users.find((u) => u.id === userId) ?? null

  return (
    <main className="min-h-dvh bg-void text-ink">
      <header className="sticky top-0 z-20 border-b border-line bg-void/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-6 py-3">
          <a
            href="/"
            className="flex items-center gap-1.5 text-[13px] text-ink-faint transition-colors hover:text-ink"
          >
            <ArrowLeft className="size-3.5" />
            Studio
          </a>

          <h1 className="ml-2 text-[15px] font-semibold">Admin</h1>

          <span className="text-[12px] text-ink-faint">
            {email}
            {snapshot?.mode === 'first-account' && (
              <span
                className="ml-2 rounded bg-overlay px-1.5 py-0.5 text-[11px] text-ink-faint"
                title="ADMIN_EMAILS is not set, so the first account created is the admin. Set it to be explicit."
              >
                first account
              </span>
            )}
          </span>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLive((v) => !v)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors',
                live
                  ? 'border-line bg-raised text-ink-muted hover:text-ink'
                  : 'border-warn/30 bg-warn/10 text-warn',
              )}
              title={live ? 'Stop refreshing' : 'Refresh every 10 seconds'}
            >
              {live ? <Pause className="size-3" /> : <Play className="size-3" />}
              {live ? 'Live' : 'Paused'}
            </button>

            <Button size="sm" onClick={refresh} loading={refreshing}>
              {!refreshing && <RefreshCw className="size-3.5" />}
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1400px] space-y-6 px-6 py-6">
        {error && (
          <p className="rounded-[--radius-card] border border-danger/30 bg-danger/10 px-4 py-3 text-[13px] text-danger">
            {error}
          </p>
        )}

        {!snapshot ? (
          <p className="py-20 text-center text-[13px] text-ink-faint">Reading the database…</p>
        ) : (
          <>
            <StatGrid overview={snapshot.overview} />

            <section className="space-y-2">
              <h2 className="text-[11px] uppercase tracking-wide text-ink-faint">
                Accounts
              </h2>
              <UsersTable
                users={snapshot.users}
                selectedId={userId}
                onSelect={setUserId}
              />
            </section>

            <section className="space-y-2">
              <div className="flex items-center gap-2">
                <h2 className="text-[11px] uppercase tracking-wide text-ink-faint">
                  Activity
                </h2>
                {selectedUser && (
                  <button
                    type="button"
                    onClick={() => setUserId(null)}
                    className="rounded-full bg-overlay px-2 py-0.5 text-[11px] text-ink-muted transition-colors hover:text-ink"
                  >
                    {selectedUser.email} ✕
                  </button>
                )}
              </div>
              <Feed items={feed} />
            </section>
          </>
        )}
      </div>
    </main>
  )
}
