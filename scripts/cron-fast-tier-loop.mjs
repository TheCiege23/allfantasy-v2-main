/**
 * Fast-tier cron loop.
 *
 * Drives the 12 sub-hourly crons declared in `vercel.json` from a single long-running GitHub
 * Actions job, because GitHub schedules cannot fire more often than hourly and the host's own
 * scheduler is unavailable.
 *
 *   node scripts/cron-fast-tier-loop.mjs --window-minutes 55
 *   node scripts/cron-fast-tier-loop.mjs --once --dry-run
 *
 * ENV
 *   APP_URL       base URL of the deployed app
 *   CRON_SECRET   sent as `Authorization: Bearer <secret>`
 *
 * `CRON_SECRET` is the right one and the only one — `app/api/cron/_auth.ts` resolves it before
 * LEAGUE_CRON_SECRET deliberately, and the reverse order 401'd every cron that did not pass an
 * explicit override (#289/#304). Do not add a LEAGUE_CRON_SECRET fallback here either.
 *
 * ⚠ THIS IS A WORKAROUND FOR A BILLING OUTAGE, NOT AN ARCHITECTURE. A host scheduler fires a
 * 2-minute job 720 times a day whether or not a runner is free; this fires it only while a runner
 * is holding the job open. When the host's scheduler returns, delete this workflow — leaving both
 * running would double-fire every job.
 *
 * ⚠ CALLS ARE NOT AWAITED IN SEQUENCE, AND THAT IS THE WHOLE DESIGN. `live-score-tick` runs a 105s
 * internal poll loop (POLL_BUDGET_MS) under a 120s maxDuration, so awaiting it would block for
 * nearly two minutes — during which `draft-tick`, which must fire every 60s, would miss its slot
 * entirely. Each job therefore has its own in-flight guard and the scheduler never blocks on one
 * job to service another.
 *
 * ⚠ A JOB NEVER OVERLAPS ITSELF. If a tick is still running when the next is due, the next is
 * SKIPPED rather than queued. Queueing would stack requests on a handler that is already slow and
 * turn a transient delay into a pile-up; skipping loses one tick and self-corrects.
 */

import process from 'node:process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readVercelCrons, classifyCrons } from './cron-tier.mjs'

/**
 * Above the largest fast-tier `maxDuration` (120s on live-score-tick and import-scores), for the
 * reason cron-dispatch.mjs documents at length: a client timeout equal to the server's own budget
 * makes the runner give up at the same instant the platform would, reporting a failure over work
 * that then completes. 180s leaves the handler room to answer for itself.
 */
const DEFAULT_TIMEOUT_MS = 180_000

/** Default window. Under the hour so a delayed next run cannot overlap this one for long. */
const DEFAULT_WINDOW_MINUTES = 55

/** Scheduler resolution. Every job here is on a whole-minute cadence; 1s is ample. */
const SCHEDULER_INTERVAL_MS = 1_000

/** Stagger the startup burst so 12 jobs do not hit the app in the same second. */
const STARTUP_STAGGER_MS = 3_000

/** Simultaneous in-flight requests, across all jobs. */
const MAX_CONCURRENCY = 4

/**
 * A job is only reported as systemically broken after this many attempts, all failed.
 *
 * ⚠ THE WORKFLOW MUST NOT REDDEN ON ONE BAD TICK. Over a 55-minute window a 1-minute job fires ~55
 * times; a single blip is noise, and a workflow that alarms hourly on noise is one people learn to
 * ignore. A job that fails EVERY attempt is different in kind — that is a 401, a 404 or a route
 * that no longer exists, and it will not fix itself.
 */
const SYSTEMIC_FAILURE_MIN_ATTEMPTS = 3

/** `*` -> 60s, `*\/N` -> N*60s. Returns null for anything not a fast-tier minute field. */
export function intervalMsForSchedule(schedule) {
  const minute = String(schedule ?? '').trim().split(/\s+/)[0]
  if (minute === '*') return 60_000
  const m = minute.match(/^\*\/(\d+)$/)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n) || n < 1 || n > 59) return null
  return n * 60_000
}

/**
 * Next wall-clock boundary at or after `now` for a given interval.
 *
 * Aligned to the epoch rather than to process start, so a job keeps the same slots a real cron
 * would use and two overlapping runs of this workflow choose the SAME instants instead of
 * interleaving into double the intended rate.
 */
export function nextBoundary(now, intervalMs) {
  return Math.ceil((now + 1) / intervalMs) * intervalMs
}

/** A job failed every time it was tried, enough times to mean configuration rather than weather. */
export function isSystemicFailure(stat) {
  return stat.attempts >= SYSTEMIC_FAILURE_MIN_ATTEMPTS && stat.succeeded === 0
}

function parseArgs(argv) {
  const args = {
    windowMinutes: DEFAULT_WINDOW_MINUTES,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    once: false,
    dryRun: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--window-minutes') args.windowMinutes = Number(argv[++i]) || DEFAULT_WINDOW_MINUTES
    else if (a === '--timeout') args.timeoutMs = Number(argv[++i]) || DEFAULT_TIMEOUT_MS
    else if (a === '--once') args.once = true
    else if (a === '--dry-run') args.dryRun = true
  }
  return args
}

/**
 * One request. No retry, deliberately.
 *
 * The slow-tier dispatcher retries because its jobs run once a day and a lost run means stale data
 * for 24 hours. Here the next attempt is 60–120 seconds away regardless, so a retry only doubles
 * load on a handler that is already struggling and risks double-writing an ingest.
 */
async function callJob(baseUrl, secret, path, timeoutMs) {
  const url = `${baseUrl.replace(/\/+$/, '')}${path}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = Date.now()
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${secret}`, 'user-agent': 'allfantasy-cron-fast-loop/1' },
      signal: controller.signal,
    })
    const elapsedMs = Date.now() - startedAt
    const body = (await res.text().catch(() => '')).slice(0, 400)
    if (res.ok) return { ok: true, status: res.status, elapsedMs, body }
    return { ok: false, status: res.status, elapsedMs, body, error: `HTTP ${res.status}` }
  } catch (err) {
    const elapsedMs = Date.now() - startedAt
    const timedOut = err?.name === 'AbortError'
    return {
      ok: false,
      status: null,
      elapsedMs,
      body: '',
      error: timedOut ? `timed out after ${timeoutMs}ms` : (err?.message ?? String(err)),
    }
  } finally {
    clearTimeout(timer)
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const hhmmss = (t) => new Date(t).toISOString().slice(11, 19)

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const baseUrl = process.env.APP_URL?.trim()
  const secret = process.env.CRON_SECRET?.trim()

  const { fast, excluded } = classifyCrons(readVercelCrons())

  const jobs = []
  for (const c of fast) {
    const intervalMs = intervalMsForSchedule(c.schedule)
    if (intervalMs == null) {
      // Classified fast but not parseable here — report it rather than silently dropping it.
      console.log(`::warning::Skipping ${c.path}: cannot derive an interval from "${c.schedule}".`)
      continue
    }
    jobs.push({ path: c.path, schedule: c.schedule, intervalMs })
  }

  if (jobs.length === 0) {
    console.log('No fast-tier jobs found in vercel.json — nothing to do.')
    return 0
  }

  console.log(`Fast-tier loop: ${jobs.length} job(s), window ${args.windowMinutes}m`)
  for (const j of jobs) console.log(`  ${j.schedule.padEnd(14)} every ${j.intervalMs / 1000}s  ${j.path}`)
  if (excluded?.length) console.log(`  (${excluded.length} cron(s) excluded by cron-tier.mjs — not handled here)`)
  console.log()

  if (args.dryRun) {
    console.log('--dry-run: no requests sent.')
    return 0
  }
  if (!baseUrl || !secret) {
    const missing = [!baseUrl && 'APP_URL', !secret && 'CRON_SECRET'].filter(Boolean).join(' and ')
    // Same contract as cron-dispatch.mjs: a fork with no configuration goes quiet, not red.
    console.log(`::notice::${missing} not set — skipping. Configure them to enable the fast tier.`)
    return 0
  }

  const stats = new Map(jobs.map((j) => [j.path, { attempts: 0, succeeded: 0, skipped: 0, lastError: null }]))
  const inFlight = new Set()
  let concurrency = 0

  const startedAt = Date.now()
  const deadline = startedAt + args.windowMinutes * 60_000

  // Startup catch-up: fire everything once, staggered. Without this a */30 job starting at :00
  // would wait until :30 for its first boundary, so a short window could run it zero times.
  const nextDueAt = new Map()
  jobs.forEach((j, i) => nextDueAt.set(j.path, startedAt + i * STARTUP_STAGGER_MS))

  const fire = (job) => {
    inFlight.add(job.path)
    concurrency += 1
    const s = stats.get(job.path)
    s.attempts += 1
    callJob(baseUrl, secret, job.path, args.timeoutMs)
      .then((r) => {
        if (r.ok) {
          s.succeeded += 1
          console.log(`${hhmmss(Date.now())}  OK   ${job.path} (${r.elapsedMs}ms)`)
        } else {
          s.lastError = r.error
          console.log(`${hhmmss(Date.now())}  FAIL ${job.path} — ${r.error} (${r.elapsedMs}ms)`)
          if (r.body) console.log(`        ${r.body.replace(/\n/g, ' ')}`)
        }
      })
      .finally(() => {
        inFlight.delete(job.path)
        concurrency -= 1
      })
  }

  while (Date.now() < deadline) {
    const now = Date.now()
    for (const job of jobs) {
      if (now < nextDueAt.get(job.path)) continue
      if (inFlight.has(job.path)) {
        // Still running from last time. Skip this slot; do not queue.
        stats.get(job.path).skipped += 1
        nextDueAt.set(job.path, nextBoundary(now, job.intervalMs))
        continue
      }
      if (concurrency >= MAX_CONCURRENCY) continue // re-evaluated next tick
      fire(job)
      nextDueAt.set(job.path, nextBoundary(now, job.intervalMs))
    }
    if (args.once) break
    await sleep(SCHEDULER_INTERVAL_MS)
  }

  // Let anything in flight finish so its result is reported rather than lost with the process.
  const drainUntil = Date.now() + args.timeoutMs
  while (inFlight.size > 0 && Date.now() < drainUntil) await sleep(500)

  console.log(`\n=== fast-tier summary (${Math.round((Date.now() - startedAt) / 1000)}s) ===`)
  const systemic = []
  for (const j of jobs) {
    const s = stats.get(j.path)
    const line = `  ${j.path.padEnd(52)} fired ${String(s.attempts).padStart(3)}  ok ${String(s.succeeded).padStart(3)}  skipped ${String(s.skipped).padStart(3)}`
    console.log(s.lastError ? `${line}  last: ${s.lastError}` : line)
    if (isSystemicFailure(s)) systemic.push({ path: j.path, error: s.lastError })
  }

  if (systemic.length > 0) {
    console.log('\nEvery attempt failed for:')
    for (const f of systemic) console.log(`  ${f.path} — ${f.error}`)
    console.log('\nThat is configuration, not weather — check APP_URL, CRON_SECRET and the route itself.')
    return 1
  }
  return 0
}

/**
 * ⚠ ONLY RUN WHEN EXECUTED DIRECTLY. Without this guard, merely IMPORTING this module for its pure
 * scheduling helpers starts the loop — and if APP_URL and CRON_SECRET happen to be present in the
 * environment, a unit test would begin firing real crons at production. The test suite caught
 * exactly that: `process.exit` from an imported module, mid-run.
 */
const invokedDirectly =
  process.argv[1] != null &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])

if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      // Never interpolate the secret into output. It is only ever a header value above.
      console.error(`cron-fast-tier-loop crashed: ${err?.message ?? err}`)
      process.exit(1)
    })
}
