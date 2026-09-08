'use client'

import {
  AlertCircle,
  FolderPlus,
  FolderMinus,
  KeyRound,
  LogIn,
  LogOut,
  ShieldAlert,
  Sparkles,
  Trash2,
  UploadCloud,
  UserPlus,
} from 'lucide-react'
import type { ComponentType } from 'react'

import { labelFor, toneFor } from '@/lib/activity/labels'
import { creditsToUsd, formatUsd } from '@/lib/kie/pricing'
import { cn, timeAgo, truncate } from '@/lib/utils'
import type { ActivityEvent, AdminRun, FeedItem } from './types'

const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  signup: UserPlus,
  signup_blocked: ShieldAlert,
  signin: LogIn,
  signin_failed: ShieldAlert,
  signout: LogOut,
  password_changed: KeyRound,
  api_key_set: KeyRound,
  api_key_cleared: KeyRound,
  project_created: FolderPlus,
  project_deleted: FolderMinus,
  history_imported: UploadCloud,
  history_cleared: Trash2,
}

/**
 * Merge the two sources into one column, newest first.
 *
 * They arrive separately because they are paginated on different keys and a
 * run's state is still changing while an event's never will. Interleaving is
 * the only thing that has to happen for them to read as one story.
 */
export function toFeed(events: ActivityEvent[], runs: AdminRun[]): FeedItem[] {
  const items: FeedItem[] = [
    ...events.map((event): FeedItem => ({
      type: 'event',
      at: event.at,
      key: `e${event.id}`,
      event,
    })),
    ...runs.map((run): FeedItem => ({ type: 'run', at: run.at, key: `r${run.id}`, run })),
  ]

  return items.sort((a, b) => b.at - a.at)
}

const RUN_TONE: Record<string, string> = {
  success: 'text-ok',
  fail: 'text-danger',
}

function Who({ email, userId }: { email: string | null; userId: string | null }) {
  return (
    <span className="text-ink" title={userId ?? undefined}>
      {email ?? 'a deleted account'}
    </span>
  )
}

function EventRow({ event }: { event: ActivityEvent }) {
  const Icon = ICONS[event.kind] ?? AlertCircle
  const tone = toneFor(event.kind)

  return (
    <>
      <Icon
        className={cn(
          'mt-0.5 size-3.5 shrink-0',
          tone === 'good' && 'text-ok',
          tone === 'warn' && 'text-warn',
          tone === 'normal' && 'text-ink-faint',
        )}
      />
      <span className="min-w-0 flex-1 text-[13px] text-ink-muted">
        <Who email={event.email} userId={event.userId} /> {labelFor(event.kind)}
        {event.summary && (
          <span className="text-ink-faint"> · {truncate(event.summary, 80)}</span>
        )}
        {event.ip && (
          <span className="ml-1 font-mono text-[11px] text-ink-faint">{event.ip}</span>
        )}
      </span>
    </>
  )
}

function RunRow({ run }: { run: AdminRun }) {
  return (
    <>
      <Sparkles className="mt-0.5 size-3.5 shrink-0 text-accent/70" />
      <span className="min-w-0 flex-1 text-[13px] text-ink-muted">
        <Who email={run.email} userId={run.userId} /> ran{' '}
        <span className="text-ink">{run.modelName}</span>
        <span className={cn('ml-1 font-mono text-[11px]', RUN_TONE[run.state] ?? 'text-warn')}>
          {run.state}
        </span>
        {run.credits != null && run.credits > 0 && (
          <span className="ml-1 font-mono text-[11px] text-ink-faint">
            {formatUsd(creditsToUsd(run.credits))}
          </span>
        )}
        {run.prompt && (
          <span className="block truncate text-[12px] text-ink-faint">
            {truncate(run.prompt, 120)}
          </span>
        )}
        {run.error && (
          <span className="block truncate text-[12px] text-danger">{truncate(run.error, 120)}</span>
        )}
      </span>
    </>
  )
}

export function Feed({ items }: { items: FeedItem[] }) {
  if (items.length === 0) {
    return (
      <p className="rounded-[--radius-card] border border-line bg-raised p-6 text-center text-[13px] text-ink-faint">
        Nothing has happened yet.
      </p>
    )
  }

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-[--radius-card] border border-line bg-raised">
      {items.map((item) => (
        <li key={item.key} className="flex items-start gap-2.5 px-4 py-2.5">
          {item.type === 'event' ? (
            <EventRow event={item.event} />
          ) : (
            <RunRow run={item.run} />
          )}
          <time
            className="shrink-0 pt-0.5 font-mono text-[11px] tabular-nums text-ink-faint"
            dateTime={new Date(item.at).toISOString()}
            title={new Date(item.at).toLocaleString()}
          >
            {timeAgo(item.at)}
          </time>
        </li>
      ))}
    </ul>
  )
}
