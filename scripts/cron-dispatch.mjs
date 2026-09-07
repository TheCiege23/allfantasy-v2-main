/**
 * Slow-tier cron dispatcher.
 *
 * Fires the hourly-or-slower jobs declared in `vercel.json` by calling the deployed app, so that
 * scheduling survives a host outage. See `scripts/cron-tier.mjs` for why the tiers are split.
 *
 *   node scripts/cron-dispatch.mjs --schedule "0 * * * *"
 *   node scripts/cron-dispatch.mjs --path /api/cron/import-injuries
 *   node scripts/cron-dispatch.mjs --all --dry-run
 *
 * ENV
 *   APP_URL       base URL of the deployed app, e.g. https://example.up.railway.app
 *   CRON_SECRET   sent as `Authorization: Bearer <secret>`
 *
 * `CRON_SECRET` is the right one and the only one. `app/api/cron/_auth.ts` resolves
 * CRON_SECRET before LEAGUE_CRON_SECRET deliberately -- the reverse order shadowed it and 401'd
 * every cron that did not pass an explicit override (#289/#304). Do not "helpfully" add a
 * LEAGUE_CRON_SECRET fallback here.
 *
 * NO-OP WHEN UNCONFIGURED, rather than failing. A fork or a fresh clone has neither variable set,
 * and wc-cron.yml already learned what the alternative looks like: every scheduled run failing
 * with `curl: (3) URL rejected: No host part in the URL` and mailing the owner about it forever.
 */

import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { readVercelCrons, classifyCrons, slowTierJobsForSchedule } from './cron-tier.mjs'

/**
 * Longer than any route's own `maxDuration`, on purpose.
 *
 * This was 300_000 — the EXACT value these routes declare — so the dispatcher gave up at the same
 * instant the platform would, and the run reported a timeout while the handler carried on and
 * finished. Observed on three jobs in one morning: `import-players`, `import-season-stats` and
 * `import-schedules?source=tsdb-only` all "failed" at exactly 300s, and two of them WROTE THEIR
 * ROWS ANYWAY — the freshness monitor showed them healthy at 1.8h and 7.4h while the workflow was
 * red.
 *
 * A red run over work that succeeded is the worst kind of alarm: it is indistinguishable from a
 * real failure and it arrives on a schedule, which is how a team learns to close the tab.
 *
 * 600s gives the handler room to finish and be OBSERVED. It does not paper over a hang: the job
 * still fails, just with the route's own answer instead of a race the dispatcher started, and the
 * workflow's own `timeout-minutes: 30` remains the real backstop.
 *
 * ⚠ Keep this ABOVE the largest `maxDuration` in app/api/cron/*. If a route ever declares more
 * than 600, raise this too or the race comes back.
 *
 * 🛑 AND THIS NUMBER IS NOT THE CEILING THAT ACTUALLY APPLIES. Node's global `fetch` (undici)
 * enforces its own `headersTimeout`, which no option on this call can raise and which fires long
 * before the AbortController above. Measured on Node v22.22.2 against a server that accepts the
 * connection and never sends headers, with the AbortController set to this same 600_000:
 *
 *     elapsedMs 300894   name TypeError   message "fetch failed"
 *     cause.code UND_ERR_HEADERS_TIMEOUT  isAbortError false
 *
 * So the real ceiling is ~301s, and 23 cron routes declare `maxDuration = 300` -- which is exactly
 * the dead heat the paragraph above says was removed. It was not removed; it moved from the
 * platform's edge to our own HTTP client, where nothing named it. Raising this constant cannot fix
 * that: the fix would be to stop using `fetch` here, and the workflow deliberately runs with no
 * `npm ci`, so an undici `Agent` is not available to widen it.
 *
 * What IS fixed below is the consequence, which was the expensive half -- see `isTimeoutError`.
 */
const DEFAULT_TIMEOUT_MS = 600_000

/**
 * Is this error the request running out of time, rather than the connection failing?
 *
 * 🛑 `err.name === 'AbortError'` ALONE IS NOT THAT TEST, AND GETTING IT WRONG DOUBLE-RUNS AN
 * INGEST. An undici headers/body timeout arrives as `TypeError: fetch failed` carrying
 * `cause.code`, so the AbortError test says "not a timeout" and `callJob` takes its RETRY branch --
 * the one thing its own docblock says must never happen for a timeout.
 *
 * Observed in production on 2026-09-07, run 34122569411, with no deploy or outage anywhere near it:
 *
 *     12:38:58  /api/cron/import-schedules  300,007ms  499
 *     12:43:58  /api/cron/import-schedules  300,009ms  499   <- the wrongful retry
 *     12:48:58  step fails
 *
 * The first handler was still running server-side when the second was fired at it, which is the
 * concurrent double-ingest the docblock warns about. In the same window `/api/cron/legacy-import-drain`
 * went from its usual 460-1040ms to 90s.
 *
 * The shapes below are the MEASURED ones, not guessed: `UND_ERR_HEADERS_TIMEOUT` from the run
 * quoted above the constant, and `UND_ERR_BODY_TIMEOUT` is its sibling for a response whose body
 * stalls mid-stream -- same class, same correct answer, and cheaper to include than to rediscover.
 */
export function isTimeoutError(err) {
  if (err?.name === 'AbortError') return true
  const code = err?.cause?.code ?? err?.code
  return code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT'
}

function parseArgs(argv) {
  const args = { schedule: null, path: null, all: false, dryRun: false, timeoutMs: DEFAULT_TIMEOUT_MS }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--schedule') args.schedule = argv[++i] ?? null
    else if (a === '--path') args.path = argv[++i] ?? null
    else if (a === '--all') args.all = true
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--timeout') args.timeoutMs = Number(argv[++i]) || DEFAULT_TIMEOUT_MS
  }
  return args
}

function selectJobs(crons, args) {
  if (args.all) return classifyCrons(crons).slow
  if (args.path) {
    const wanted = args.path.split('?')[0]
    return classifyCrons(crons).slow.filter((c) => c.path.split('?')[0] === wanted)
  }
  if (args.schedule) return slowTierJobsForSchedule(crons, args.schedule)
  return []
}

/**
 * One job, with a single retry.
 *
 * RETRIES ON 5xx AND CONNECTION FAILURE ONLY -- never on timeout. A timeout means the request was
 * abandoned client-side, not that the server stopped: the handler is very likely still running and
 * still writing. Retrying would double-run an ingest and, for anything wrapped in withSyncJobRun,
 * leave a second row stuck in `running` -- which makes computeJobHealth report amber forever
 * because it checks runningTooLong before freshness and can never escalate to red.
 *
 * 4xx is not retried either: a 401 or 404 will not fix itself on a second attempt.
 */
async function callJob(baseUrl, secret, job, timeoutMs) {
  const url = `${baseUrl.replace(/\/+$/, '')}${job.path}`
  let lastError = null

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const startedAt = Date.now()
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { authorization: `Bearer ${secret}`, 'user-agent': 'allfantasy-cron-dispatch/1' },
        signal: controller.signal,
      })
      const elapsedMs = Date.now() - startedAt
      // Echo the body. `curl --fail --silent` used to discard it here, which left every failure in
      // the workflow log undiagnosable.
      const body = (await res.text().catch(() => '')).slice(0, 1500)

      if (res.ok) return { ok: true, status: res.status, elapsedMs, body, attempt }
      if (res.status >= 500 && attempt === 1) {
        lastError = `HTTP ${res.status}`
        continue
      }
      return { ok: false, status: res.status, elapsedMs, body, attempt, error: `HTTP ${res.status}` }
    } catch (err) {
      const elapsedMs = Date.now() - startedAt
      if (isTimeoutError(err)) {
        // Report the elapsed time, never `timeoutMs`. The undici ceiling fires at ~301s while
        // `timeoutMs` says 600000, and a message quoting the budget rather than the clock is how
        // this stayed invisible: the run reads "timed out after 600000ms" at the 300s mark.
        const cause = err?.cause?.code ?? err?.code
        return {
          ok: false, status: null, elapsedMs, body: '', attempt,
          error:
            `timed out after ${elapsedMs}ms` +
            (cause ? ` (${cause})` : '') +
            ' (NOT retried -- the handler is probably still running)',
        }
      }
      lastError = err?.message ?? String(err)
      if (attempt === 1) continue
      return { ok: false, status: null, elapsedMs, body: '', attempt, error: lastError }
    } finally {
      clearTimeout(timer)
    }
  }
  return { ok: false, status: null, elapsedMs: 0, body: '', attempt: 2, error: lastError ?? 'unknown' }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const baseUrl = process.env.APP_URL?.trim()
  const secret = process.env.CRON_SECRET?.trim()

  const crons = readVercelCrons()
  const jobs = selectJobs(crons, args)

  if (jobs.length === 0) {
    const label = args.all ? 'all' : (args.schedule ?? args.path ?? '(nothing selected)')
    // Not a failure. A schedule listed in the workflow whose last job was removed from vercel.json
    // should go quiet, not turn red every hour until someone edits the YAML.
    console.log(`No slow-tier jobs match ${JSON.stringify(label)} -- nothing to do.`)
    return 0
  }

  console.log(`Selected ${jobs.length} slow-tier job(s):`)
  for (const j of jobs) console.log(`  ${j.schedule.padEnd(14)} ${j.path}`)
  console.log()

  if (args.dryRun) {
    console.log('--dry-run: no requests sent.')
    return 0
  }
  if (!baseUrl || !secret) {
    const missing = [!baseUrl && 'APP_URL', !secret && 'CRON_SECRET'].filter(Boolean).join(' and ')
    console.log(`::notice::${missing} not set -- skipping. Configure them to enable the slow tier.`)
    return 0
  }

  const results = []
  // Sequential on purpose. These are ingest jobs against one Postgres, and the unbounded
  // per-league fan-out shape already took production to an OOM (53200) once.
  for (const job of jobs) {
    process.stdout.write(`-> ${job.path} ... `)
    const r = await callJob(baseUrl, secret, job, args.timeoutMs)
    results.push({ job, ...r })
    console.log(r.ok ? `OK ${r.status} (${r.elapsedMs}ms)` : `FAIL ${r.error} (${r.elapsedMs}ms)`)
    if (r.body) console.log(`   ${r.body.replace(/\n/g, '\n   ')}`)
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} succeeded.`)
  if (failed.length > 0) {
    console.log('\nFailed:')
    for (const f of failed) console.log(`  ${f.job.path} -- ${f.error}`)
    return 1
  }
  return 0
}

/**
 * ⚠ ONLY RUN WHEN EXECUTED DIRECTLY, for the reason `scripts/cron-fast-tier-loop.mjs` already
 * records against its own copy of this guard: without it, merely IMPORTING this module fires every
 * selected cron -- at production, if APP_URL and CRON_SECRET happen to be in the environment. That
 * is what makes `isTimeoutError` testable at all.
 */
const invokedDirectly =
  process.argv[1] != null &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])

if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      // Never interpolate the secret into output. It is only ever a header value above.
      console.error(`cron-dispatch crashed: ${err?.message ?? err}`)
      process.exit(1)
    })
}
