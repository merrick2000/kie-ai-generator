/**
 * The admin view, against a real Postgres.
 *
 * Every number on that page is an aggregate, and an aggregate that is quietly
 * wrong is worse than one that is missing: it will be believed. So each is
 * checked against a fixture whose answer is known by construction, and the
 * gate in front of them is checked too, since a monitoring page that anyone
 * can read is a different product from the one that was asked for.
 *
 *   DATABASE_URL=postgres://... bun --preload ./scripts/preload.ts scripts/test-admin.mts
 *
 * Give it a database nothing else is using: a dev server pointed at the same
 * one will reconcile the fixture jobs and move the counts mid-test.
 */

import assert from 'node:assert/strict'

import { createPostgresClient } from '../src/lib/db/postgres'
import { migrate } from '../src/lib/db/schema'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is required. Start one with:')
  console.error('  docker compose -f docker-compose.dev.yml up -d')
  process.exit(1)
}

let passed = 0
async function check(name: string, fn: () => Promise<void>) {
  await fn()
  passed++
  console.log(`  ok  ${name}`)
}

const db = createPostgresClient(url)
;(globalThis as Record<string, unknown>).__highfieldDb = Promise.resolve(db)

await db.run('DROP SCHEMA public CASCADE')
await db.run('CREATE SCHEMA public')
await migrate(db)

const admin = await import('../src/lib/admin')
const activity = await import('../src/lib/activity/store')

const DAY = 24 * 60 * 60 * 1000
const now = Date.now()

/* ────────────────────────────────────────────────────────────────────────────
 * Fixture
 *
 * Two accounts. The first joined a month ago and has run four jobs: two that
 * succeeded, one that failed, one still going. The second joined an hour ago
 * and has run nothing, which is the case every "last seen" bug hides in.
 * ──────────────────────────────────────────────────────────────────────────*/

const OWNER = 'user-owner'
const LATE = 'user-late'

await db.run(
  `INSERT INTO users (id, email, password_hash, api_key_enc, created_at, last_login_at)
   VALUES (?, ?, ?, ?, ?, ?)`,
  [OWNER, 'owner@example.com', 'hash', 'sealed', now - 30 * DAY, now - 2 * DAY],
)
await db.run(
  `INSERT INTO users (id, email, password_hash, api_key_enc, created_at, last_login_at)
   VALUES (?, ?, ?, ?, ?, ?)`,
  [LATE, 'late@example.com', 'hash', null, now - 60 * 60 * 1000, null],
)

interface Fixture {
  id: string
  user: string
  state: string
  createdAt: number
  credits: number | null
  model?: string
}

const JOBS: Fixture[] = [
  { id: 'j1', user: OWNER, state: 'success', createdAt: now - 2 * 60 * 60 * 1000, credits: 10 },
  { id: 'j2', user: OWNER, state: 'success', createdAt: now - 3 * 60 * 60 * 1000, credits: 20 },
  { id: 'j3', user: OWNER, state: 'fail', createdAt: now - 4 * 60 * 60 * 1000, credits: null },
  { id: 'j4', user: OWNER, state: 'generating', createdAt: now - 60 * 1000, credits: null },
  // Older than a week, so it counts towards all-time totals and nothing else.
  { id: 'j5', user: OWNER, state: 'success', createdAt: now - 20 * DAY, credits: 70, model: 'old/model' },
]

for (const job of JOBS) {
  await db.run(
    `INSERT INTO jobs (id, user_id, api, model_id, model_name, category, output,
                       prompt_preview, state, credits_consumed, created_at, updated_at)
     VALUES (?, ?, 'market', ?, ?, 'image', 'image', ?, ?, ?, ?, ?)`,
    [
      job.id,
      job.user,
      job.model ?? 'vendor/nano-banana',
      job.model ?? 'Nano Banana',
      `prompt for ${job.id}`,
      job.state,
      job.credits,
      job.createdAt,
      job.createdAt,
    ],
  )
}

await db.run(
  `INSERT INTO projects (id, user_id, name, settings, archived, created_at, updated_at)
   VALUES (?, ?, ?, '{}', FALSE, ?, ?)`,
  ['p1', OWNER, 'Campaign', now - 5 * DAY, now - 5 * DAY],
)

console.log('the activity trail')

await check('an event round-trips', async () => {
  await activity.record({
    kind: 'signup',
    userId: LATE,
    email: 'late@example.com',
    ip: '203.0.113.9',
  })

  const [event] = await activity.listActivity({ limit: 1 })
  assert.equal(event?.kind, 'signup')
  assert.equal(event?.email, 'late@example.com')
  assert.equal(event?.ip, '203.0.113.9')
  assert.deepEqual(event?.meta, {})
})

await check('recording never throws on a broken write', async () => {
  // The whole point of the try/catch: a failed audit insert must not be able
  // to take down the sign-up it was recording.
  const broken = { run: async () => { throw new Error('disk full') } }
  const saved = (globalThis as Record<string, unknown>).__highfieldDb
  ;(globalThis as Record<string, unknown>).__highfieldDb = Promise.resolve(broken)

  await activity.record({ kind: 'signin', userId: OWNER })

  ;(globalThis as Record<string, unknown>).__highfieldDb = saved
})

await check('meta survives the round trip', async () => {
  // Written against an id with no row in `users`, which both keeps this event
  // out of the "last seen" fixtures below and proves the deliberate absence
  // of a foreign key: the trail has to outlive the account it describes.
  await activity.record({
    kind: 'project_created',
    userId: 'deleted-account',
    email: 'gone@example.com',
    summary: 'Campaign',
    meta: { projectId: 'p1' },
  })

  const [event] = await activity.listActivity({ limit: 1 })
  assert.equal(event?.summary, 'Campaign')
  assert.deepEqual(event?.meta, { projectId: 'p1' })
})

await check('the feed can be narrowed to one account', async () => {
  const mine = await activity.listActivity({ userId: LATE })
  assert.equal(mine.length, 1)
  assert.equal(mine[0]!.userId, LATE)
})

await check('the feed can be narrowed to one kind', async () => {
  const signups = await activity.listActivity({ kind: 'signup' })
  assert.equal(signups.length, 1)
  assert.equal(signups[0]!.kind, 'signup')
})

await check('paging by id does not repeat or skip a row', async () => {
  const all = await activity.listActivity({ limit: 100 })
  assert.ok(all.length >= 2)

  const firstPage = await activity.listActivity({ limit: 1 })
  const secondPage = await activity.listActivity({ limit: 1, before: firstPage[0]!.id })

  assert.equal(secondPage[0]!.id, all[1]!.id)
  assert.notEqual(secondPage[0]!.id, firstPage[0]!.id)
})

await check('trimming removes only what is past the cutoff', async () => {
  await db.run(
    "INSERT INTO activity (at, user_id, kind, summary, meta) VALUES (?, ?, 'signin', '', '{}')",
    [now - 100 * DAY, OWNER],
  )

  const before = await activity.listActivity({ limit: 100 })
  const removed = await activity.trimActivity(90 * DAY)
  const after = await activity.listActivity({ limit: 100 })

  assert.equal(removed, 1)
  assert.equal(after.length, before.length - 1)
})

console.log('\nthe overview')

const view = await admin.overview()

await check('counts accounts and this week’s arrivals', () => {
  assert.equal(view.users.total, 2)
  assert.equal(view.users.newDay, 1, 'only the late account joined today')
  assert.equal(view.users.newWeek, 1)
})

await check('counts only accounts that actually ran something as active', () => {
  // The late account signed up and left. Counting it as active is the mistake
  // that makes a dead instance look busy.
  assert.equal(view.users.activeWeek, 1)
})

await check('separates today, this week and all time', () => {
  assert.equal(view.runs.total, 5)
  assert.equal(view.runs.day, 4, 'j5 is twenty days old')
  assert.equal(view.runs.week, 4)
})

await check('counts unfinished work as running', () => {
  // Anything not success or fail is still costing money upstream.
  assert.equal(view.runs.running, 1)
})

await check('counts today’s failures', () => {
  assert.equal(view.runs.failedDay, 1)
})

await check('the success rate ignores work still in flight', () => {
  // Two successes and one failure finished this week. The generating job is
  // not a failure yet, and counting it as one would make every busy moment
  // look like an outage.
  assert.equal(view.runs.successRateWeek, 2 / 3)
})

await check('sums spend over each window', () => {
  assert.equal(view.spend.totalCredits, 100)
  assert.equal(view.spend.dayCredits, 30)
  assert.equal(view.spend.weekCredits, 30)
})

await check('counts refused sign-ins from the trail', async () => {
  await activity.record({ kind: 'signin_failed', email: 'nobody@example.com' })
  const fresh = await admin.overview()
  assert.equal(fresh.security.failedSigninsDay, 1)
})

await check('ranks models by use over the last week', () => {
  // The twenty-day-old job's model must not appear: a weekly ranking that
  // quietly includes everything is just an all-time ranking.
  assert.equal(view.topModels.length, 1)
  assert.equal(view.topModels[0]!.modelId, 'vendor/nano-banana')
  assert.equal(view.topModels[0]!.runs, 4)
  assert.equal(view.topModels[0]!.credits, 30)
})

await check('buckets runs by day', () => {
  const total = view.daily.reduce((sum, day) => sum + day.runs, 0)
  // Only the fortnight, so j5 is outside it.
  assert.equal(total, 4)
  assert.ok(view.daily.every((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.day)))
})

console.log('\nthe account table')

await check('reports each account’s work', async () => {
  const users = await admin.listUsers()
  assert.equal(users.length, 2)

  const owner = users.find((u) => u.id === OWNER)!
  assert.equal(owner.runs, 5)
  assert.equal(owner.failedRuns, 1)
  assert.equal(owner.credits, 100)
  assert.equal(owner.projects, 1)
  assert.equal(owner.hasApiKey, true)
})

await check('an account that has run nothing reports zero, not null', async () => {
  const users = await admin.listUsers()
  const late = users.find((u) => u.id === LATE)!

  // A LEFT JOIN with no matching rows gives SUM(NULL). Sending that to a page
  // that formats currency is how "$NaN" gets shipped.
  assert.equal(late.runs, 0)
  assert.equal(late.credits, 0)
  assert.equal(late.lastRunAt, null)
  assert.equal(late.hasApiKey, false)
})

await check('last seen is the latest of sign-in, run and event', async () => {
  const users = await admin.listUsers()
  const owner = users.find((u) => u.id === OWNER)!

  // The owner last signed in two days ago but ran something a minute ago, so
  // reading last_login_at alone would report them as gone for two days.
  assert.ok(owner.lastSeenAt! > now - 5 * 60 * 1000)
  assert.equal(owner.lastAction, 'started a run')
})

await check('an account that never signed in says so', async () => {
  const users = await admin.listUsers()
  const late = users.find((u) => u.id === LATE)!

  // last_login_at is null and there are no jobs, so the signup event is the
  // only thing left that knows when they were here.
  assert.equal(late.lastAction, 'created the account')
  assert.ok(late.lastSeenAt != null)
})

console.log('\nthe run feed')

await check('lists runs newest first with the account attached', async () => {
  const runs = await admin.listRuns({ limit: 10 })
  assert.equal(runs.length, 5)
  assert.equal(runs[0]!.id, 'j4')
  assert.equal(runs[0]!.email, 'owner@example.com')

  for (let i = 1; i < runs.length; i++) {
    assert.ok(runs[i - 1]!.at >= runs[i]!.at, 'runs are out of order')
  }
})

await check('narrows to one account', async () => {
  assert.equal((await admin.listRuns({ userId: LATE })).length, 0)
  assert.equal((await admin.listRuns({ userId: OWNER })).length, 5)
})

await check('pages by timestamp', async () => {
  // j4 is the newest, so the page after it starts at j1.
  const [first] = await admin.listRuns({ limit: 1 })
  const next = await admin.listRuns({ limit: 1, before: first!.at })
  assert.equal(next[0]!.id, 'j1')
})

await check('a run keeps its live state rather than a logged one', async () => {
  await db.run("UPDATE jobs SET state = 'success' WHERE id = ?", ['j4'])
  const [run] = await admin.listRuns({ limit: 1 })
  assert.equal(run!.state, 'success')
  await db.run("UPDATE jobs SET state = 'generating' WHERE id = ?", ['j4'])
})

console.log('\nwho gets in')

await check('with ADMIN_EMAILS set, only those addresses', async () => {
  process.env.ADMIN_EMAILS = 'owner@example.com'

  assert.equal(await admin.adminMode(), 'configured')
  assert.equal(
    await admin.isAdmin({ id: OWNER, email: 'owner@example.com', hasApiKey: true, createdAt: 0 }),
    true,
  )
  assert.equal(
    await admin.isAdmin({ id: LATE, email: 'late@example.com', hasApiKey: false, createdAt: 0 }),
    false,
  )
})

await check('the list is matched case-insensitively and trimmed', async () => {
  // Nobody types an env var carefully, and locking the owner out of their own
  // instance over a stray space is the worst possible failure here.
  process.env.ADMIN_EMAILS = ' OWNER@Example.com , spare@example.com '

  assert.equal(
    await admin.isAdmin({ id: OWNER, email: 'owner@example.com', hasApiKey: true, createdAt: 0 }),
    true,
  )
})

await check('without it, the oldest account and nobody else', async () => {
  delete process.env.ADMIN_EMAILS

  assert.equal(await admin.adminMode(), 'first-account')
  assert.equal(
    await admin.isAdmin({ id: OWNER, email: 'owner@example.com', hasApiKey: true, createdAt: 0 }),
    true,
  )
  assert.equal(
    await admin.isAdmin({ id: LATE, email: 'late@example.com', hasApiKey: false, createdAt: 0 }),
    false,
  )
})

await check('a second account cannot become admin by changing its email', async () => {
  // The fallback is by id, not by address, so the check cannot be defeated by
  // signing up as the owner's address on a fresh account.
  assert.equal(
    await admin.isAdmin({ id: LATE, email: 'owner@example.com', hasApiKey: false, createdAt: 0 }),
    false,
  )
})

console.log(`\n${passed} checks passed`)
await db.close()
