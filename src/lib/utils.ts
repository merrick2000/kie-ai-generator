import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

/** Compact relative time: "just now", "4m ago", "3d ago". */
export function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp
  if (diff < 45_000) return 'just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString()
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

/** Crockford-ish random id, unique enough for client-side records. */
export function uid(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** Build a same-origin URL that streams a remote asset (see /api/kie/proxy). */
export function proxied(url: string, opts?: { download?: boolean; filename?: string }): string {
  const params = new URLSearchParams({ url })
  if (opts?.download) params.set('download', '1')
  if (opts?.filename) params.set('filename', opts.filename)
  return `/api/kie/proxy?${params.toString()}`
}

/** Aspect ratio string ("16:9") → CSS aspect-ratio value. */
export function ratioToCss(ratio: string | undefined): string {
  if (!ratio || !ratio.includes(':')) return '1 / 1'
  const [w, h] = ratio.split(':')
  const nw = Number(w)
  const nh = Number(h)
  if (!nw || !nh) return '1 / 1'
  return `${nw} / ${nh}`
}
