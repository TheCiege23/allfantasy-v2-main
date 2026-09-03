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
import fs from 'node:fs'
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

/**
 * Headroom over a route's OWN declared budget, so the route always answers before we give up.
 *
 * ⚠ A SINGLE GLOBAL TIMEOUT WAS WRONG, AND IT SILENTLY BROKE FOUR JOBS. This file previously used
 * one 180s value, justified by a comment reading "above the largest fast-tier maxDuration (120s on
 * live-score-tick and import-scores)". Two routes were checked; twelve exist. FOUR declare 300:
 *
 *   fantasy-os-exec-sync  300s      alert-sweep         300s
 *   draft-pool-prewarm    300s      trade-grade-notify  300s
 *
 * Each reported `timed out after 180000ms` while its handler was still legitimately working.
 * draft-pool-prewarm read as 0-for-3 permanently broken; it was being killed at 180s by this loop,
 * not failing.
 *
 * That is exactly the trap cron-dispatch.mjs documents and sets 600s to avoid: a client timeout at
 * or below the server's own budget reports a failure over work that then completes.
 */
const TIMEOUT_MARGIN_MS = 30_000

/** Assumed budget for a route that declares none, matching Next's own default. */
const ASSUMED_MAX_DURATION_MS = 60_000

/** Floor and ceiling. The ceiling is the largest declared budget (300s) plus the margin. */
const MIN_JOB_TIMEOUT_MS = 60_000
const MAX_JOB_TIMEOUT_MS = 330_000

/** Default window. Under the hour so a delayed next run cannot overlap this one for long. */
/**
 * ⚠ Must stay in step with `FAST_TIER_WINDOW_MINUTES` in .github/workflows/cron-fast-tier.yml,
 * which is what the scheduled path actually passes. This default only applies to a hand-run
 * invocation. 50 minutes against a 60-minute trigger leaves the window room to finish and re-arm.
 */
const DEFAULT_WINDOW_MINUTES = 50

/** Scheduler resolution. Every job here is on a whole-minute cadence; 1s is ample. */
const SCHEDULER_INTERVAL_MS = 1_000

/** Stagger the startup burst so 12 jobs do not hit the app in the same second. */
const STARTUP_STAGGER_MS = 3_000

/**
 * Simultaneous in-flight requests, across all jobs.
 *
 * ⚠ RAISED FROM 4 AFTER MEASURING STARVATION IN PRODUCTION. Several fast-tier jobs are slow or hang
 * to the timeout — import-news and fantasy-os-exec-sync have both been stale for days — and four
 * slots were not enough to stop them monopolising the pool. Raising this ALONE would not have
 * fixed it; see orderByUrgency.
 */
const MAX_CONCURRENCY = 8

/**
 * A call this slow means the app is struggling, not that the job is big.
 *
 * Measured on 2026-09-03: the same fast-tier jobs that answer in 0.5-9s against a warm container
 * took 51-112s against a cold one — waivers 111,587ms, redraft/score-sync 111,716ms,
 * notification-outbox-relay 110,982ms, draft-tick 63,169ms. 30s is far above the healthy ceiling
 * and far below the sick floor, so it separates the two without needing to know which is which.
 *
 * ⚠ live-score-tick LEGITIMATELY EXCEEDS THIS DURING GAMES, AND THAT IS EXPECTED. It is bimodal:
 * measured over 4,461 runs across 7 days, p50 is 117ms (no live games, early return) and p90 is
 * 94,744ms (its 105s internal poll doing exactly what it exists to do). 26.7% of all its runs cross
 * 30s, and on 2026-08-29 its MEDIAN run was 90s.
 *
 * So on a game day the cap sits at 6-8 rather than 8, BY DESIGN. Do not file that as a bug.
 * Simulating this function against every instrumented completion on that worst day gives cap 8 in
 * 54.8% of windows, 7 in 38.1%, 6 in 7.2%, and never 5 or below — the floor is not approached, and
 * 6 is still above the 4 that caused the starvation MAX_CONCURRENCY was raised from.
 *
 * That bound is not luck, it is the healthy-fraction scaling: the 1- and 2-minute jobs dominate the
 * sample stream, so a job that is slow on EVERY fire still contributes only ~1 sample in 8 and
 * costs one slot rather than six. A fixed threshold with a hard trip would have been unusable here.
 */
const SLOW_CALL_MS = 30_000

/** How many recent calls the latency view remembers. One tick's worth of a full pool, roughly. */
const LATENCY_SAMPLE_SIZE = 8

/**
 * Floor for the adaptive cap. Never zero: the loop must keep making SOME progress, or a cold
 * container would never be given the traffic that warms it and the backoff would be permanent.
 */
const MIN_CONCURRENCY = 2

/**
 * Effective concurrency, given how the app has been answering lately.
 *
 * ⚠ WHY THIS EXISTS. `MAX_CONCURRENCY` is a fixed 8, and 8 simultaneous requests against a
 * container that has just restarted is what turned a routine deploy into a user-visible outage on
 * 2026-09-02. The container is single-threaded Node with 24 vCPU and 24 GB it cannot use in
 * parallel (measured: memory peaked 5.1 GB, CPU 1.25 cores), so the ceiling is the event loop, not
 * the box. Everything is due at once after a restart, eight of them fire, each takes ~110s instead
 * of ~1s, and real user requests queue behind them.
 *
 * ⚠ AND LOWERING MAX_CONCURRENCY IS NOT THE FIX. It was RAISED from 4 to 8 for a measured reason —
 * slow jobs monopolised four slots and starved the every-minute jobs. A fixed cap cannot be right
 * for both a warm app and a cold one, because the two want opposite things.
 *
 * So the cap is left alone for the healthy case and lowered only while the app is demonstrably
 * struggling. This is ordinary congestion control: back off under load, restore on recovery, and
 * never coordinate with the deploy — the loop cannot see a deploy, but it CAN see latency, and
 * latency is the thing that actually matters.
 *
 * `orderByUrgency` still decides WHO gets the reduced slots, so the every-minute jobs this loop
 * exists for keep their priority while it is backed off.
 *
 * Pure and exported so it is tested directly rather than inferred from a live run.
 */
export function effectiveConcurrency(recentDurations, max = MAX_CONCURRENCY) {
  // Not enough evidence yet — do not throttle on one unlucky call at startup.
  if (!Array.isArray(recentDurations) || recentDurations.length < LATENCY_SAMPLE_SIZE) return max

  const sample = recentDurations.slice(-LATENCY_SAMPLE_SIZE)
  const slow = sample.filter((d) => Number.isFinite(d) && d >= SLOW_CALL_MS).length
  if (slow === 0) return max

  // Scale with the HEALTHY fraction, so one slow call among eight barely moves it and a pool that
  // is entirely slow drops straight to the floor.
  const healthyFraction = (sample.length - slow) / sample.length
  return Math.max(MIN_CONCURRENCY, Math.round(max * healthyFraction))
}

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

/**
 * Order due jobs so the one most overdue RELATIVE TO ITS OWN CADENCE goes first.
 *
 * ⚠ FIXED ARRAY ORDER STARVED EXACTLY THE JOBS THIS LOOP EXISTS FOR. `classifyCrons` returns
 * vercel.json order, which happens to put the every-minute jobs LAST: draft-tick at index 8,
 * live-score-tick at 9, legacy-import-drain at 10. When slower jobs at indices 0-4 filled the
 * concurrency pool, the scheduler re-scanned from index 0 on every tick and never reached the tail.
 *
 * MEASURED ON THE FIRST PRODUCTION RUN — lateness increased monotonically with index:
 *   draft-tick           (idx 8)   14.1 min since last fire   (declared every 1 min)
 *   live-score-tick      (idx 9)   20.8 min                   (declared every 2 min)
 *   legacy-import-drain  (idx 10)  20.8 min                   (declared every 1 min)
 * while waivers (idx 2) and score-sync (idx 5) fired on time throughout.
 *
 * ⚠ RANKING BY ABSOLUTE LATENESS WOULD NOT FIX IT. A 30-minute job three minutes late looks later
 * than a 1-minute job two minutes late, when the second has missed two entire cycles and the first
 * has missed none. The ratio to its own interval is what expresses urgency.
 */
export function orderByUrgency(dueJobs, now) {
  return [...dueJobs].sort((a, b) => {
    const ratio = (j) => (now - j.dueAt) / j.intervalMs
    const d = ratio(b) - ratio(a)
    // Tiebreak on cadence, so equal relative lateness still favours the tighter schedule.
    return d !== 0 ? d : a.intervalMs - b.intervalMs
  })
}

/**
 * Two failures that look identical in a log and mean opposite things.
 *
 * A gateway status or a dropped connection is the HOST refusing to answer — every job in flight
 * gets the same error at the same instant, and none of them is broken. Anything else came from the
 * application: a 401, a 404, a 500 out of the handler. That is the job's own problem.
 *
 * ⚠ TIMEOUTS ARE DELIBERATELY 'job' HERE and are re-classified later if they land inside a detected
 * host outage. A route that always times out while its neighbours answer is broken — that is
 * exactly `draft-pool-prewarm`, which fired 3 times and succeeded 0 in a window where every other
 * job was fine. Calling every timeout a host problem would have hidden it.
 */
export function classifyFailure(status, error) {
  if (status === 502 || status === 503 || status === 504) return 'host'
  const e = String(error ?? '').toLowerCase()
  if (/econnrefused|econnreset|enotfound|eai_again|socket hang up|fetch failed|network/.test(e)) {
    return 'host'
  }
  return 'job'
}

/** Host-class failures this close together are one outage, not several. */
const HOST_OUTAGE_WINDOW_MS = 90_000

/** Distinct jobs that must fail together before it counts as the host rather than the job. */
const HOST_OUTAGE_MIN_JOBS = 2

/**
 * Collapse host-class failures into outage windows.
 *
 * ⚠ ONE JOB FAILING ALONE IS NEVER AN OUTAGE, however gateway-ish the error. A single route can
 * 502 because IT crashed — the platform returns a gateway error for an app that died mid-request.
 * Requiring two DISTINCT jobs inside the same short window is what separates "the host went away"
 * from "this handler fell over", and without it a genuinely broken route could excuse itself by
 * returning the right status code.
 */
export function detectHostOutages(failures, windowMs = HOST_OUTAGE_WINDOW_MS) {
  const host = failures.filter((f) => f.kind === 'host').sort((a, b) => a.at - b.at)
  const windows = []
  for (const f of host) {
    const last = windows[windows.length - 1]
    if (last && f.at - last.end <= windowMs) {
      last.end = f.at
      last.paths.add(f.path)
    } else {
      windows.push({ start: f.at, end: f.at, paths: new Set([f.path]) })
    }
  }
  return windows.filter((w) => w.paths.size >= HOST_OUTAGE_MIN_JOBS)
}

/** True when `at` falls inside any detected outage (with the same slack at both ends). */
export function insideOutage(at, outages, windowMs = HOST_OUTAGE_WINDOW_MS) {
  return outages.some((w) => at >= w.start - windowMs && at <= w.end + windowMs)
}

/**
 * The `maxDuration` a route declares for itself, in ms, or null when it declares none.
 *
 * Read from source rather than configured here on purpose: a second list of budgets would drift
 * from the routes the moment someone changed one, and drift is exactly what produced the 180s bug.
 * `readFile` is injected so this stays testable without touching the filesystem.
 */
export function routeMaxDurationMs(jobPath, readFile) {
  const clean = String(jobPath).split('?')[0].replace(/^\/+|\/+$/g, '')
  for (const ext of ['ts', 'tsx', 'js']) {
    try {
      const src = readFile(`app/${clean}/route.${ext}`)
      const m = src.match(/maxDuration\s*=\s*(\d+)/)
      return m ? Number(m[1]) * 1000 : null
    } catch {
      // try the next extension
    }
  }
  return null
}

/**
 * Per-job request timeout: the route's own budget plus headroom, clamped.
 *
 * ⚠ THE LONG TIMEOUTS CANNOT STARVE THE FAST JOBS, which is what makes this safe. Every route
 * declaring 300s is on a 15- or 30-minute cadence, so 330s is a fraction of its interval. The
 * 1- and 2-minute jobs declare 60-120s and get 90-150s. A job still never overlaps ITSELF -- the
 * in-flight guard skips rather than queues -- so a slow call costs missed ticks, never a pile-up.
 */
export function timeoutForJob(maxDurationMs) {
  const budget = maxDurationMs ?? ASSUMED_MAX_DURATION_MS
  return Math.min(MAX_JOB_TIMEOUT_MS, Math.max(MIN_JOB_TIMEOUT_MS, budget + TIMEOUT_MARGIN_MS))
}

/**
 * A job failed every time it was tried, enough times to mean configuration rather than weather.
 *
 * ⚠ ATTEMPTS LOST TO A HOST OUTAGE DO NOT COUNT. A low-frequency job fires only a handful of times
 * per window — `fantasy-os-exec-sync` fired 3 times in 55 minutes — so a single host outage can
 * consume every one of its attempts and make a perfectly healthy job look permanently broken. That
 * is the false alarm this whole workflow keeps teaching people to ignore.
 */
export function isSystemicFailure(stat, outages = []) {
  if (stat.succeeded > 0) return false
  const ownFailures = (stat.failures ?? []).filter(
    (f) => f.kind === 'job' && !insideOutage(f.at, outages),
  )
  return ownFailures.length >= SYSTEMIC_FAILURE_MIN_ATTEMPTS
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
    const maxDurationMs = routeMaxDurationMs(c.path, (rel) => fs.readFileSync(rel, 'utf8'))
    jobs.push({
      path: c.path,
      schedule: c.schedule,
      intervalMs,
      // An explicit --timeout still wins, for smoke tests; otherwise each job gets its own.
      timeoutMs: args.timeoutMs === DEFAULT_TIMEOUT_MS ? timeoutForJob(maxDurationMs) : args.timeoutMs,
      maxDurationMs,
    })
  }

  if (jobs.length === 0) {
    console.log('No fast-tier jobs found in vercel.json — nothing to do.')
    return 0
  }

  console.log(`Fast-tier loop: ${jobs.length} job(s), window ${args.windowMinutes}m`)
  for (const j of jobs) {
    const budget = j.maxDurationMs == null ? 'no maxDuration' : `maxDuration ${j.maxDurationMs / 1000}s`
    console.log(
      `  ${j.schedule.padEnd(14)} every ${String(j.intervalMs / 1000).padStart(4)}s` +
        `  timeout ${String(j.timeoutMs / 1000).padStart(3)}s (${budget})  ${j.path}`,
    )
  }
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

  // `failures` backs detectHostOutages/isSystemicFailure below -- both read `.kind` off every
  // entry unconditionally. Omitting it here crashed the loop the first time it ran a full
  // window in production: jobs.flatMap((j) => stats.get(j.path).failures) turned the missing
  // array into a literal `undefined` per job, and `.kind` on that `undefined` is what threw
  // ("Cannot read properties of undefined (reading 'kind')"), before a single summary line
  // printed.
  const stats = new Map(
    jobs.map((j) => [j.path, { attempts: 0, succeeded: 0, skipped: 0, lastError: null, failures: [] }]),
  )
  const inFlight = new Set()
  let concurrency = 0
  /** Rolling view of how the app has been answering, for effectiveConcurrency(). */
  const recentDurations = []
  /** Last cap logged, so a change is reported once rather than every second. */
  let lastCap = MAX_CONCURRENCY

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
    callJob(baseUrl, secret, job.path, job.timeoutMs)
      .then((r) => {
        // Latency view for effectiveConcurrency(). Recorded for failures too: a call that hangs to
        // its timeout is the strongest evidence the app is struggling, and dropping it would make
        // the backoff blindest exactly when it is most needed.
        recentDurations.push(r.elapsedMs)
        if (recentDurations.length > LATENCY_SAMPLE_SIZE) recentDurations.shift()
        if (r.ok) {
          s.succeeded += 1
          console.log(`${hhmmss(Date.now())}  OK   ${job.path} (${r.elapsedMs}ms)`)
        } else {
          s.lastError = r.error
          // The other half of the bug above: without this push, `failures` stayed permanently
          // empty, so detectHostOutages() could never find a host outage and isSystemicFailure()
          // could never flag a broken route -- the classification this loop exists to make was
          // wired up on the read side only.
          s.failures.push({ at: Date.now(), kind: classifyFailure(r.status, r.error), error: r.error })
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

    /*
     * Collect what is due, THEN order by urgency. Iterating the job array directly is precisely what
     * starved the every-minute jobs: they sit at the end of vercel.json's order, so a full
     * concurrency pool meant the scan never reached them.
     */
    const due = []
    for (const job of jobs) {
      const dueAt = nextDueAt.get(job.path)
      if (now < dueAt) continue
      if (inFlight.has(job.path)) {
        // Still running from last time. Skip this slot; do not queue.
        stats.get(job.path).skipped += 1
        nextDueAt.set(job.path, nextBoundary(now, job.intervalMs))
        continue
      }
      due.push({ ...job, dueAt })
    }

    // Cap for THIS tick. Full 8 while the app answers normally; lower while it is struggling, so a
    // cold container after a deploy is not met with eight simultaneous requests. See
    // effectiveConcurrency() for why lowering MAX_CONCURRENCY itself would re-introduce starvation.
    const capNow = effectiveConcurrency(recentDurations)
    if (capNow !== lastCap) {
      console.log(`${hhmmss(now)}  concurrency ${lastCap} -> ${capNow} (recent slow calls)`)
      lastCap = capNow
    }

    for (const job of orderByUrgency(due, now)) {
      // `break`, not `continue`: anything past the cap keeps its due time and is re-ranked next
      // tick, so a job that has been waiting longest keeps climbing rather than losing its place.
      if (concurrency >= capNow) break
      fire(job)
      nextDueAt.set(job.path, nextBoundary(now, job.intervalMs))
    }

    if (args.once) break
    await sleep(SCHEDULER_INTERVAL_MS)
  }

  // Let anything in flight finish so its result is reported rather than lost with the process.
  // Drain for the LONGEST per-job timeout, or a slow job still in flight is abandoned unreported.
  const drainUntil = Date.now() + Math.max(...jobs.map((j) => j.timeoutMs), args.timeoutMs)
  while (inFlight.size > 0 && Date.now() < drainUntil) await sleep(500)

  console.log(`\n=== fast-tier summary (${Math.round((Date.now() - startedAt) / 1000)}s) ===`)

  const allFailures = jobs.flatMap((j) => stats.get(j.path).failures)
  const outages = detectHostOutages(allFailures)

  const systemic = []
  for (const j of jobs) {
    const s = stats.get(j.path)
    const hostHits = s.failures.filter((f) => f.kind === 'host' || insideOutage(f.at, outages)).length
    const line =
      `  ${j.path.padEnd(52)} fired ${String(s.attempts).padStart(3)}` +
      `  ok ${String(s.succeeded).padStart(3)}` +
      `  skipped ${String(s.skipped).padStart(3)}` +
      (hostHits > 0 ? `  host ${String(hostHits).padStart(3)}` : '')
    console.log(s.lastError ? `${line}  last: ${s.lastError}` : line)
    if (isSystemicFailure(s, outages)) systemic.push({ path: j.path, error: s.lastError })
  }

  /*
   * Reported, never fatal. The host being unreachable is real and worth seeing -- four jobs all
   * returning 502 in the same minute is a redeploy or a restart, not eleven broken routes -- but
   * failing the workflow for it would make this run red for something no code change can fix, and
   * a workflow that is red for weather is one nobody reads when it finally means something.
   */
  if (outages.length > 0) {
    console.log('')
    console.log(`Host unreachable during ${outages.length} window(s) -- not counted against any job:`)
    for (const w of outages) {
      const secs = Math.max(1, Math.round((w.end - w.start) / 1000))
      console.log(`  ${hhmmss(w.start)}-${hhmmss(w.end)} (~${secs}s)  ${w.paths.size} jobs affected`)
    }
  }

  if (systemic.length > 0) {
    console.log('')
    console.log('Every attempt failed, with the host up:')
    for (const f of systemic) console.log(`  ${f.path} -- ${f.error}`)
    console.log('')
    console.log('That is configuration, not weather -- check APP_URL, CRON_SECRET and the route itself.')
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
