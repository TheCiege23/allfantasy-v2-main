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

import process from 'node:process'
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
 */
const DEFAULT_TIMEOUT_MS = 600_000

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
      const timedOut = err?.name === 'AbortError'
      if (timedOut) {
        return {
          ok: false, status: null, elapsedMs, body: '', attempt,
          error: `timed out after ${timeoutMs}ms (NOT retried -- the handler is probably still running)`,
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

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    // Never interpolate the secret into output. It is only ever a header value above.
    console.error(`cron-dispatch crashed: ${err?.message ?? err}`)
    process.exit(1)
  })
