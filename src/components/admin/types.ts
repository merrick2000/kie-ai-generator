/** Shapes the admin endpoints return. Mirrors `lib/admin` and `lib/activity`. */

export interface Overview {
  users: { total: number; newDay: number; newWeek: number; activeWeek: number }
  runs: {
    total: number
    day: number
    week: number
    running: number
    failedDay: number
    successRateWeek: number | null
  }
  spend: { totalCredits: number; dayCredits: number; weekCredits: number }
  security: { failedSigninsDay: number; activeSessions: number }
  topModels: { modelId: string; name: string; runs: number; credits: number }[]
  daily: { day: string; runs: number; credits: number }[]
}

export interface AdminUser {
  id: string
  email: string
  createdAt: number
  lastLoginAt: number | null
  hasApiKey: boolean
  runs: number
  failedRuns: number
  credits: number
  lastRunAt: number | null
  lastSeenAt: number | null
  lastAction: string
  projects: number
}

export interface ActivityEvent {
  id: number
  at: number
  userId: string | null
  email: string | null
  kind: string
  summary: string
  meta: Record<string, unknown>
  ip: string | null
}

export interface AdminRun {
  id: string
  at: number
  userId: string
  email: string | null
  modelId: string
  modelName: string
  category: string
  output: string
  state: string
  prompt: string
  credits: number | null
  error: string | null
  completedAt: number | null
}

/** One line in the feed, from either source. */
export type FeedItem =
  | { type: 'event'; at: number; key: string; event: ActivityEvent }
  | { type: 'run'; at: number; key: string; run: AdminRun }
