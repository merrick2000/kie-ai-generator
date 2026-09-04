/**
 * Job storage, against a real Postgres.
 *
 * These are the queries that decide whether a generation survives a reload,
 * so they are checked against the real engine rather than a stub: the claim
 * uses FOR UPDATE SKIP LOCKED, the aggregates use FILTER, and the search uses
 * ILIKE. None of those behave the same anywhere else.
 *
 *   DATABASE_URL=postgres://... bun --preload ./scripts/preload.ts scripts/test-jobs.mts
 *
 * Give it a database nothing else is using. The reconciler claims due jobs
 * every second, so a dev server pointed at the same one will take them out
 * from under the queue checks below and they will fail for the wrong reason.
 */

import assert from 'node:assert/strict'

import { createPostgresClient } from '../src/lib/db/postgres'
import { migrate } from '../src/lib/db/schema'
import type { DatabaseClient } from '../src/lib/db/types'
import type { NormalizedTask } from '../src/lib/kie/tasks'

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

/**
 * The store reads its connection from the module-level `getDb`, which caches
 * on globalThis. Priming that cache lets the real repository run against this
 * throwaway database without a parallel implementation in the test.
 */
const db = createPostgresClient(url)
;(globalThis as Record<string, unknown>).__highfieldDb = Promise.resolve(db)

await db.run('DROP SCHEMA public CASCADE')
await db.run('CREATE SCHEMA public')
await migrate(db)

const store = await import('../src/lib/jobs/store')
const projects = await import('../src/lib/projects/store')

const USER = 'user-1'
const OTHER = 'user-2'

for (const id of [USER, OTHER]) {
  await db.run(
    `INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)`,
    [id, `${id}@example.com`, 'hash', Date.now()],
  )
}

function task(overrides: Partial<NormalizedTask> = {}): NormalizedTask {
  return {
    taskId: 't-1',
    state: 'success',
    progress: 100,
    assets: [{ url: 'https://example.com/a.png', kind: 'image' }],
    creditsConsumed: 4,
    costTimeMs: 3000,
    ...overrides,
  }
}

const base = {
  userId: USER,
  projectId: null,
  api: 'market' as const,
  modelId: 'google/nano-banana',
  submittedModelId: null,
  modelName: 'Nano Banana',
  category: 'image' as const,
  output: 'image' as const,
  promptPreview: 'a cat on a roof',
  values: { prompt: 'a cat on a roof', aspect_ratio: '1:1' },
}

console.log('\njobs')

await check('a submission is recorded before it is sent', async () => {
  const job = await store.insertJob(base)

  assert.equal(job.state, 'waiting')
  assert.equal(job.taskId, null)
  assert.deepEqual(job.values, base.values)
  // Not pollable until a task id exists, so the reconciler cannot pick up a
  // row that has nothing to ask about.
  const row = await db.get<{ next_poll_at: string }>(
    'SELECT next_poll_at FROM jobs WHERE id = ?',
    [job.id],
  )
  assert.equal(Number(row!.next_poll_at), Number.MAX_SAFE_INTEGER)
})

await check('attaching a task opens it for polling', async () => {
  const job = await store.insertJob(base)
  await store.attachTask(job.id, 'task-abc', Date.now() - 1)

  const fetched = await store.getJob(USER, job.id)
  assert.equal(fetched!.taskId, 'task-abc')
  assert.equal(fetched!.state, 'queuing')
})

await check('a result is written onto the job', async () => {
  const job = await store.insertJob(base)
  await store.attachTask(job.id, 'task-result', Date.now())
  await store.applyTaskResult(job.id, task(), Date.now() + 1000)

  const fetched = await store.getJob(USER, job.id)
  assert.equal(fetched!.state, 'success')
  assert.equal(fetched!.assets.length, 1)
  assert.equal(fetched!.creditsConsumed, 4)
  assert.ok(fetched!.completedAt)
})

await check('a finished job is never reopened', async () => {
  const job = await store.insertJob(base)
  await store.attachTask(job.id, 'task-race', Date.now())
  await store.applyTaskResult(job.id, task(), Date.now())

  // A callback and a poll can land in either order. The late one must not
  // drag a finished job back to "generating" or wipe its assets.
  await store.applyTaskResult(
    job.id,
    task({ state: 'generating', progress: 40, assets: [], creditsConsumed: null }),
    Date.now(),
  )

  const fetched = await store.getJob(USER, job.id)
  assert.equal(fetched!.state, 'success')
  assert.equal(fetched!.assets.length, 1)
  assert.equal(fetched!.creditsConsumed, 4)
})

await check('failing a job is also guarded', async () => {
  const job = await store.insertJob(base)
  await store.attachTask(job.id, 'task-done', Date.now())
  await store.applyTaskResult(job.id, task(), Date.now())
  await store.failJob(job.id, 'too late')

  const fetched = await store.getJob(USER, job.id)
  assert.equal(fetched!.state, 'success')
  assert.equal(fetched!.error, null)
})

await check('a text answer completes a chat job', async () => {
  const job = await store.insertJob({
    ...base,
    api: 'chat',
    modelId: 'chat/claude-opus-5',
    modelName: 'Claude Opus 5',
    category: 'text',
    output: 'text',
  })
  await store.completeText(job.id, 'The answer.', 0.25, 4200)

  const fetched = await store.getJob(USER, job.id)
  assert.equal(fetched!.state, 'success')
  assert.equal(fetched!.text, 'The answer.')
  assert.equal(fetched!.creditsConsumed, 0.25)
})

console.log('\nownership')

await check('one account cannot read another account’s job', async () => {
  const job = await store.insertJob(base)
  assert.equal(await store.getJob(OTHER, job.id), null)
})

await check('a listing only returns the caller’s work', async () => {
  await store.insertJob({ ...base, userId: OTHER, promptPreview: 'not yours' })

  const mine = await store.listJobs(USER)
  assert.equal(
    mine.some((job) => job.promptPreview === 'not yours'),
    false,
  )
})

console.log('\nfilters')

await check('search matches the prompt, the name and the model', async () => {
  const job = await store.insertJob({ ...base, promptPreview: 'a lighthouse at dusk' })
  await store.patchJob(USER, job.id, { title: 'Hero shot' })

  assert.equal((await store.listJobs(USER, { search: 'lighthouse' })).length, 1)
  assert.equal((await store.listJobs(USER, { search: 'Hero' })).length, 1)
  assert.ok((await store.listJobs(USER, { search: 'Nano' })).length > 0)
  assert.equal((await store.listJobs(USER, { search: 'zebra' })).length, 0)
})

await check('a wildcard in the query is searched for, not applied', async () => {
  await store.insertJob({ ...base, promptPreview: '50% grey card' })

  // Unescaped, "%" would match every row rather than the one containing it.
  const hits = await store.listJobs(USER, { search: '50%' })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].promptPreview, '50% grey card')
})

await check('status narrows to running, done or failed', async () => {
  const running = await store.insertJob({ ...base, promptPreview: 'still going' })
  await store.attachTask(running.id, 'task-running', Date.now())

  const listed = await store.listJobs(USER, { status: 'running' })
  assert.ok(listed.every((job) => job.state !== 'success' && job.state !== 'fail'))
  assert.ok(listed.some((job) => job.id === running.id))
})

await check('the sync mark is account-wide, not filtered', async () => {
  await db.run('DELETE FROM jobs')

  const hidden = await store.insertJob({ ...base, promptPreview: 'zebra crossing' })

  // A filtered read must still report the newest change on the account.
  // Reporting the newest matching row instead leaves the mark behind this
  // job, and the sync loop then re-fetches it on every tick forever.
  const filtered = await store.listJobs(USER, { search: 'nothing matches this' })
  assert.equal(filtered.length, 0)

  const mark = await store.latestUpdatedAt(USER)
  const actual = await store.getJob(USER, hidden.id)
  assert.equal(mark, actual!.updatedAt)
})

await check('updatedSince returns only what changed', async () => {
  const before = Date.now()
  // A millisecond of daylight, so the new row cannot share a timestamp with
  // the mark it is compared against.
  await new Promise((resolve) => setTimeout(resolve, 5))

  const job = await store.insertJob({ ...base, promptPreview: 'fresh' })
  const changed = await store.listJobs(USER, { updatedSince: before })

  assert.ok(changed.some((j) => j.id === job.id))
  assert.ok(changed.every((j) => j.updatedAt > before))
})

console.log('\nprojects')

await check('a job can be filed into a project', async () => {
  const project = await projects.createProject(USER, { name: 'Campaign', color: 'amber' })
  const job = await store.insertJob(base)

  await store.patchJob(USER, job.id, { projectId: project.id })

  const inProject = await store.listJobs(USER, { projectId: project.id })
  assert.equal(inProject.length, 1)
  assert.equal(inProject[0].id, job.id)
})

await check('deleting a project keeps the work it held', async () => {
  const project = await projects.createProject(USER, { name: 'Doomed' })
  const job = await store.insertJob({ ...base, projectId: project.id })

  await projects.deleteProject(USER, project.id)

  const survivor = await store.getJob(USER, job.id)
  assert.ok(survivor, 'the job was deleted with its project')
  assert.equal(survivor!.projectId, null)
})

await check('project settings merge rather than replace', async () => {
  const project = await projects.createProject(USER, { name: 'Merging' })

  await projects.updateProject(USER, project.id, {
    settings: { promptPrefix: 'Shot on film' },
  })
  await projects.updateProject(USER, project.id, { settings: { brief: 'Warm tones' } })

  const fetched = await projects.getProject(USER, project.id)
  // A client that only knows about one setting must not wipe the others.
  assert.equal(fetched!.settings.promptPrefix, 'Shot on film')
  assert.equal(fetched!.settings.brief, 'Warm tones')
})

await check('an emptied setting is removed rather than stored blank', async () => {
  const project = await projects.createProject(USER, { name: 'Clearing' })
  await projects.updateProject(USER, project.id, { settings: { promptSuffix: 'no text' } })
  await projects.updateProject(USER, project.id, { settings: { promptSuffix: '' } })

  const fetched = await projects.getProject(USER, project.id)
  assert.equal('promptSuffix' in fetched!.settings, false)
})

await check('an unknown colour is refused', async () => {
  const project = await projects.createProject(USER, {
    name: 'Injected',
    color: 'javascript:alert(1)',
  })
  assert.equal(project.color, null)
})

console.log('\nthe reconciler queue')

await check('only due jobs with a task id are claimed', async () => {
  await db.run('DELETE FROM jobs')

  const due = await store.insertJob(base)
  await store.attachTask(due.id, 'task-due', Date.now() - 1000)

  const later = await store.insertJob(base)
  await store.attachTask(later.id, 'task-later', Date.now() + 60_000)

  // Never submitted, so there is nothing to ask about.
  await store.insertJob(base)

  const claimed = await store.claimDueJobs(10, 30_000)
  assert.equal(claimed.length, 1)
  assert.equal(claimed[0].id, due.id)
  assert.equal(claimed[0].userId, USER)
})

await check('a claimed job is not handed out twice', async () => {
  await db.run('DELETE FROM jobs')

  const job = await store.insertJob(base)
  await store.attachTask(job.id, 'task-lease', Date.now() - 1000)

  const first = await store.claimDueJobs(10, 30_000)
  const second = await store.claimDueJobs(10, 30_000)

  // The lease is what makes two instances safe to run at once.
  assert.equal(first.length, 1)
  assert.equal(second.length, 0)
})

await check('a lapsed lease is reclaimed', async () => {
  await db.run('DELETE FROM jobs')

  const job = await store.insertJob(base)
  await store.attachTask(job.id, 'task-lapse', Date.now() - 1000)
  await store.claimDueJobs(10, 30_000)

  // A container that crashed mid-poll must not strand the job forever.
  await db.run('UPDATE jobs SET lease_until = ? WHERE id = ?', [Date.now() - 1, job.id])

  const reclaimed = await store.claimDueJobs(10, 30_000)
  assert.equal(reclaimed.length, 1)
})

await check('a finished job leaves the queue', async () => {
  await db.run('DELETE FROM jobs')

  const job = await store.insertJob(base)
  await store.attachTask(job.id, 'task-finish', Date.now() - 1000)
  await store.applyTaskResult(job.id, task(), Date.now())

  assert.equal((await store.claimDueJobs(10, 30_000)).length, 0)
  assert.equal(await store.countPending(), 0)
})

await check('a callback brings the next poll forward', async () => {
  await db.run('DELETE FROM jobs')

  const job = await store.insertJob(base)
  await store.attachTask(job.id, 'task-callback', Date.now() + 60_000)

  assert.equal((await store.claimDueJobs(10, 30_000)).length, 0)

  const expedited = await store.expediteByTaskId('task-callback')
  assert.equal(expedited, true)
  assert.equal((await store.claimDueJobs(10, 30_000)).length, 1)
})

await check('a job that was never submitted is eventually closed', async () => {
  await db.run('DELETE FROM jobs')

  const job = await store.insertJob(base)
  await db.run('UPDATE jobs SET created_at = ? WHERE id = ?', [
    Date.now() - 10 * 60_000,
    job.id,
  ])

  const closed = await store.failOrphanedJobs(2 * 60_000)
  assert.equal(closed, 1)

  const fetched = await store.getJob(USER, job.id)
  assert.equal(fetched!.state, 'fail')
  // The message has to say no money was spent, or it reads as a lost result.
  assert.ok(fetched!.error!.includes('Nothing was charged'))
})

await check('a chat job is not treated as an orphan', async () => {
  await db.run('DELETE FROM jobs')

  const job = await store.insertJob({ ...base, api: 'chat', output: 'text' })
  await db.run('UPDATE jobs SET created_at = ? WHERE id = ?', [
    Date.now() - 10 * 60_000,
    job.id,
  ])

  // Chat jobs never get a task id, so the orphan sweep must skip them or it
  // would kill every long-running answer.
  assert.equal(await store.failOrphanedJobs(2 * 60_000), 0)
})

await check('a text run left by a restart is eventually closed', async () => {
  await db.run('DELETE FROM jobs')

  const running = await store.insertJob({ ...base, api: 'chat', output: 'text' })
  await db.run('UPDATE jobs SET created_at = ? WHERE id = ?', [
    Date.now() - 30 * 60_000,
    running.id,
  ])

  // Nothing polls a chat job: it is finished by a promise in one process, so
  // a restart mid-answer would otherwise leave it spinning forever.
  assert.equal(await store.failStalledChatJobs(10 * 60_000), 1)
  assert.equal((await store.getJob(USER, running.id))!.state, 'fail')
})

await check('a text run still inside its deadline is left alone', async () => {
  await db.run('DELETE FROM jobs')

  const fresh = await store.insertJob({ ...base, api: 'chat', output: 'text' })
  // A high-effort reasoning model routinely runs for minutes; the sweep must
  // not be what ends it.
  assert.equal(await store.failStalledChatJobs(10 * 60_000), 0)
  assert.notEqual((await store.getJob(USER, fresh.id))!.state, 'fail')
})

console.log('\nimporting a browser history')

const legacy = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  taskId: 'old-task',
  api: 'market',
  modelId: 'google/nano-banana',
  modelName: 'Nano Banana',
  category: 'image',
  output: 'image',
  promptPreview: 'made before the move',
  values: { prompt: 'made before the move' },
  state: 'success',
  assets: [{ url: 'https://example.com/old.png', kind: 'image' }],
  text: null,
  error: null,
  favorite: false,
  creditsConsumed: 4,
  costTimeMs: 2000,
  createdAt: 1_700_000_000_000,
  completedAt: 1_700_000_002_000,
  ...over,
})

await check('old work is written into a project', async () => {
  await db.run('DELETE FROM jobs')

  const project = await projects.findOrCreateProject(USER, projects.DEFAULT_PROJECT_NAME)
  const result = await store.importJobs(USER, project.id, [legacy('a'), legacy('b')])

  assert.equal(result.imported, 2)

  const filed = await store.listJobs(USER, { projectId: project.id })
  assert.equal(filed.length, 2)
  // The original timestamps survive, or the history arrives out of order.
  assert.equal(filed[0].createdAt, 1_700_000_000_000)
  assert.equal(filed[0].assets.length, 1)
  assert.equal(filed[0].creditsConsumed, 4)
})

await check('importing twice adds nothing', async () => {
  await db.run('DELETE FROM jobs')

  const project = await projects.findOrCreateProject(USER, projects.DEFAULT_PROJECT_NAME)
  await store.importJobs(USER, project.id, [legacy('a')])

  // The same browser reloading, or a second device with the same history.
  const again = await store.importJobs(USER, project.id, [legacy('a')])
  assert.equal(again.imported, 0)
  assert.equal(again.skipped, 1)
  assert.equal((await store.listJobs(USER)).length, 1)
})

await check('two accounts with the same old id do not collide', async () => {
  await db.run('DELETE FROM jobs')

  // The old ids were Date.now() plus six random characters, which is not
  // enough to rule out a repeat across accounts.
  const project = await projects.findOrCreateProject(USER, projects.DEFAULT_PROJECT_NAME)
  const other = await projects.findOrCreateProject(OTHER, projects.DEFAULT_PROJECT_NAME)

  await store.importJobs(USER, project.id, [legacy('shared-id')])
  const theirs = await store.importJobs(OTHER, other.id, [legacy('shared-id')])

  assert.equal(theirs.imported, 1)
  assert.equal((await store.listJobs(USER)).length, 1)
  assert.equal((await store.listJobs(OTHER)).length, 1)
})

await check('imported work is never polled again', async () => {
  await db.run('DELETE FROM jobs')

  const project = await projects.findOrCreateProject(USER, projects.DEFAULT_PROJECT_NAME)
  // A run the old build left mid-flight, carrying a task id from days ago.
  await store.importJobs(USER, project.id, [legacy('stuck', { state: 'generating' })])

  const [job] = await store.listJobs(USER)
  // Polling a task that expired long before this row existed would report it
  // as a fresh failure, so it is stored closed instead.
  assert.equal(job.state, 'fail')
  assert.ok(job.error)
  assert.equal((await store.claimDueJobs(10, 30_000)).length, 0)
})

await check('duplicating copies the defaults but not the work', async () => {
  await db.run('DELETE FROM jobs')

  const source = await projects.createProject(USER, { name: 'Campaign', color: 'rose' })
  await projects.updateProject(USER, source.id, {
    settings: { promptPrefix: 'Shot on film', brief: 'Warm tones' },
  })
  await store.insertJob({ ...base, projectId: source.id })

  const result = await projects.duplicateProject(USER, source.id, { withJobs: false })
  assert.ok(result)
  assert.equal(result!.copiedJobs, 0)
  assert.equal(result!.project.settings.promptPrefix, 'Shot on film')
  assert.equal(result!.project.color, 'rose')
  assert.notEqual(result!.project.id, source.id)

  // The original keeps everything it had.
  assert.equal((await store.listJobs(USER, { projectId: source.id })).length, 1)
  assert.equal((await store.listJobs(USER, { projectId: result!.project.id })).length, 0)
})

await check('duplicating with the work copies finished results only', async () => {
  await db.run('DELETE FROM jobs')

  const source = await projects.createProject(USER, { name: 'With work' })

  const done = await store.insertJob({ ...base, projectId: source.id })
  await store.attachTask(done.id, 'dup-1', Date.now())
  await store.applyTaskResult(done.id, task(), Date.now())
  await store.patchJob(USER, done.id, { favorite: true })

  // Still running upstream, so copying it would mean two rows waiting on one
  // task and both being polled.
  const running = await store.insertJob({ ...base, projectId: source.id })
  await store.attachTask(running.id, 'dup-2', Date.now())

  const result = await projects.duplicateProject(USER, source.id, { withJobs: true })
  assert.equal(result!.copiedJobs, 1)

  const copied = await store.listJobs(USER, { projectId: result!.project.id })
  assert.equal(copied.length, 1)
  assert.notEqual(copied[0].id, done.id)
  assert.equal(copied[0].assets.length, 1)
  // A copy is a starting point, not a second claim on a pinned result.
  assert.equal(copied[0].favorite, false)

  // And nothing new for the reconciler to poll.
  assert.equal((await store.claimDueJobs(10, 30_000)).length, 1)
})

await check('one account cannot duplicate another’s project', async () => {
  const mine = await projects.createProject(USER, { name: 'Private' })
  assert.equal(await projects.duplicateProject(OTHER, mine.id, { withJobs: true }), null)
})

await check('the default project is reused, not duplicated', async () => {
  const first = await projects.findOrCreateProject(USER, projects.DEFAULT_PROJECT_NAME)
  const second = await projects.findOrCreateProject(USER, projects.DEFAULT_PROJECT_NAME)
  assert.equal(first.id, second.id)
})

console.log('\nhistory and usage')

await check('clearing keeps pinned and running work', async () => {
  await db.run('DELETE FROM jobs')

  const done = await store.insertJob(base)
  await store.attachTask(done.id, 'c-1', Date.now())
  await store.applyTaskResult(done.id, task(), Date.now())

  const pinned = await store.insertJob(base)
  await store.attachTask(pinned.id, 'c-2', Date.now())
  await store.applyTaskResult(pinned.id, task(), Date.now())
  await store.patchJob(USER, pinned.id, { favorite: true })

  const running = await store.insertJob(base)
  await store.attachTask(running.id, 'c-3', Date.now())

  const removed = await store.clearJobs(USER)
  assert.equal(removed, 1)

  const left = await store.listJobs(USER)
  assert.equal(left.length, 2)
  // Deleting a running job would abandon a task that is still being paid for.
  assert.ok(left.some((j) => j.id === running.id))
  assert.ok(left.some((j) => j.id === pinned.id))
})

await check('usage counts successes, failures and spend per model', async () => {
  await db.run('DELETE FROM jobs')

  for (const credits of [2, 6]) {
    const job = await store.insertJob(base)
    await store.attachTask(job.id, `u-${credits}`, Date.now())
    await store.applyTaskResult(job.id, task({ creditsConsumed: credits }), Date.now())
  }

  const failed = await store.insertJob(base)
  await store.attachTask(failed.id, 'u-fail', Date.now())
  await store.failJob(failed.id, 'upstream said no')

  const usage = await store.modelUsage(USER)
  const banana = usage.find((u) => u.modelId === 'google/nano-banana')!

  assert.equal(banana.runs, 3)
  assert.equal(banana.succeeded, 2)
  assert.equal(banana.failed, 1)
  assert.equal(banana.credits, 8)
  // Min and max matter because options move the price within one model.
  assert.equal(banana.minCredits, 2)
  assert.equal(banana.maxCredits, 6)

  const totals = await store.usageTotals(USER)
  assert.equal(totals.runs, 3)
  assert.equal(totals.credits, 8)
  assert.equal(totals.models, 1)
})

await check('project counts separate filed from unfiled work', async () => {
  await db.run('DELETE FROM jobs')

  const project = await projects.createProject(USER, { name: 'Counted' })
  await store.insertJob({ ...base, projectId: project.id })
  await store.insertJob(base)

  const counts = await store.projectCounts(USER)
  assert.equal(counts[project.id].runs, 1)
  assert.equal(counts.unfiled.runs, 1)
})

await db.close()
console.log(`\n${passed} checks passed`)
