/**
 * cron-runner.mjs — fires cron-schedule.json against the running app.
 *
 * Vercel used to read cron-schedule.json (via vercel.json) and call each path
 * on its schedule with `Authorization: Bearer $CRON_SECRET`. Railway has no
 * equivalent, so after the move to Railway nothing was scheduling the 55 jobs
 * in that file: waivers, the notification outbox relay, score sync, every
 * data import, the alert sweep. This process is the replacement. It runs as
 * its own Railway service (start command `node scripts/cron-runner.mjs`),
 * wakes every minute on the UTC minute boundary, and issues the same GET the
 * Vercel scheduler issued, with the same header, at the same times.
 *
 * Scope is deliberately narrow: same file, same paths, same UTC semantics,
 * same auth. No new schedule format, no persistence, no retries — a missed
 * or failed fire is logged and the next scheduled fire happens on time, which
 * is exactly what Vercel did.
 *
 * Environment
 *   CRON_TARGET_ORIGIN      required  e.g. https://allfantasy-v2-main-production-5897.up.railway.app
 *   CRON_SECRET             required  sent as `Authorization: Bearer` and `x-cron-secret`
 *   CRON_RUNNER_TIMEOUT_MS  optional  per-request timeout, default 300000 (Vercel's 300s cap)
 *   CRON_RUNNER_CONCURRENCY optional  max in-flight requests, default 6
 *
 * Flags
 *   --validate         parse every schedule and exit (0 ok, 1 invalid) — used as the build step
 *   --at <iso-8601>    print which jobs are due at that UTC minute and exit
 *   --once <path>      fire one path now, print the status, exit 0 on 2xx
 *   --dry-run          run the loop but log instead of fetching
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCHEDULE_FILE = path.join(HERE, '..', 'cron-schedule.json')

// ---------------------------------------------------------------------------
// Cron expression parsing. Five fields, standard ranges:
//   minute 0-59, hour 0-23, day-of-month 1-31, month 1-12, day-of-week 0-7 (7 = Sunday)
// Supports `*`, `*/n`, `a`, `a-b`, `a-b/n`, and comma lists of those.
// ---------------------------------------------------------------------------
const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'dayOfMonth', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'dayOfWeek', min: 0, max: 7 },
]

function parseField(text, { name, min, max }, expr) {
  const allowed = new Set()
  const bad = (why) => new Error(`invalid cron "${expr}": ${name} field "${text}" ${why}`)
  for (const part of text.split(',')) {
    if (part === '') throw bad('has an empty list item')
    const [rangeText, stepText] = part.split('/')
    if (part.split('/').length > 2) throw bad('has more than one "/"')
    let lo
    let hi
    if (rangeText === '*') {
      lo = min
      hi = max
    } else if (rangeText.includes('-')) {
      const [a, b] = rangeText.split('-')
      lo = Number(a)
      hi = Number(b)
      if (!Number.isInteger(lo) || !Number.isInteger(hi)) throw bad('is not an integer range')
      if (lo > hi) throw bad('is a reversed range')
    } else {
      lo = Number(rangeText)
      hi = lo
      if (!Number.isInteger(lo)) throw bad('is not an integer')
      if (stepText !== undefined) hi = max // `5/10` means "from 5, every 10" in most crons
    }
    if (lo < min || hi > max) throw bad(`is outside ${min}-${max}`)
    let step = 1
    if (stepText !== undefined) {
      step = Number(stepText)
      if (!Number.isInteger(step) || step < 1) throw bad('has a non-positive step')
    }
    for (let v = lo; v <= hi; v += step) allowed.add(name === 'dayOfWeek' && v === 7 ? 0 : v)
  }
  return allowed
}

/** @returns {{ expr: string, fields: Set<number>[], domRestricted: boolean, dowRestricted: boolean }} */
export function parseCron(expr) {
  if (typeof expr !== 'string') throw new Error(`invalid cron: expected a string, got ${typeof expr}`)
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error(`invalid cron "${expr}": expected 5 fields, got ${parts.length}`)
  const fields = parts.map((p, i) => parseField(p, FIELDS[i], expr))
  return {
    expr,
    fields,
    domRestricted: parts[2] !== '*',
    dowRestricted: parts[4] !== '*',
  }
}

/** Standard cron semantics, evaluated in UTC. When BOTH day-of-month and
 *  day-of-week are restricted, either one matching is enough (that is what
 *  cron does, and what Vercel's scheduler does). */
export function matches(parsed, date) {
  const [minute, hour, dom, month, dow] = parsed.fields
  if (!minute.has(date.getUTCMinutes())) return false
  if (!hour.has(date.getUTCHours())) return false
  if (!month.has(date.getUTCMonth() + 1)) return false
  const domOk = dom.has(date.getUTCDate())
  const dowOk = dow.has(date.getUTCDay())
  if (parsed.domRestricted && parsed.dowRestricted) return domOk || dowOk
  if (parsed.domRestricted) return domOk
  if (parsed.dowRestricted) return dowOk
  return true
}

/** @returns {{ path: string, schedule: string, parsed: ReturnType<typeof parseCron> }[]} */
export function loadSchedule(file = SCHEDULE_FILE) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  const crons = Array.isArray(raw?.crons) ? raw.crons : null
  if (!crons) throw new Error(`${file}: expected { "crons": [...] }`)
  return crons.map((entry, i) => {
    if (!entry || typeof entry.path !== 'string' || !entry.path.startsWith('/')) {
      throw new Error(`${file}: crons[${i}] has no "/path"`)
    }
    return { path: entry.path, schedule: entry.schedule, parsed: parseCron(entry.schedule) }
  })
}

/** Jobs due at the given UTC minute. */
export function dueAt(jobs, date) {
  return jobs.filter((job) => matches(job.parsed, date))
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------
function readConfig() {
  const origin = (process.env.CRON_TARGET_ORIGIN || '').trim().replace(/\/+$/, '')
  const secret = (process.env.CRON_SECRET || '').trim()
  const timeoutMs = Number(process.env.CRON_RUNNER_TIMEOUT_MS || 300_000)
  const concurrency = Number(process.env.CRON_RUNNER_CONCURRENCY || 6)
  return { origin, secret, timeoutMs, concurrency }
}

function log(level, message, extra) {
  const line = `${new Date().toISOString()} [cron-runner] ${message}`
  if (extra !== undefined) console[level](line, extra)
  else console[level](line)
}

async function fire(job, config, { dryRun = false } = {}) {
  const url = `${config.origin}${job.path}`
  if (dryRun) {
    log('info', `dry-run ${job.path}`)
    return { ok: true, status: 0, ms: 0 }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)
  const started = Date.now()
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${config.secret}`,
        'x-cron-secret': config.secret,
        'user-agent': 'allfantasy-cron-runner/1',
        accept: 'application/json, text/plain, */*',
      },
      redirect: 'manual',
      signal: controller.signal,
    })
    const ms = Date.now() - started
    // Drain the body so the socket is released; the content is not needed.
    await res.arrayBuffer().catch(() => undefined)
    const ok = res.status >= 200 && res.status < 300
    log(ok ? 'info' : 'warn', `${ok ? 'ok' : 'FAILED'} ${job.path} -> ${res.status} in ${ms}ms`)
    return { ok, status: res.status, ms }
  } catch (error) {
    const ms = Date.now() - started
    const reason = error && error.name === 'AbortError' ? `timeout after ${config.timeoutMs}ms` : String(error && error.message ? error.message : error)
    log('error', `ERROR ${job.path} after ${ms}ms: ${reason}`)
    return { ok: false, status: 0, ms }
  } finally {
    clearTimeout(timer)
  }
}

function msUntilNextMinute(now = Date.now()) {
  return 60_000 - (now % 60_000)
}

async function runLoop(jobs, config, { dryRun }) {
  const inFlight = new Map() // path -> started timestamp
  let active = 0
  let stopping = false
  const queue = []

  const pump = () => {
    while (!stopping && active < config.concurrency && queue.length > 0) {
      const job = queue.shift()
      active += 1
      inFlight.set(job.path, Date.now())
      fire(job, config, { dryRun }).finally(() => {
        active -= 1
        inFlight.delete(job.path)
        pump()
      })
    }
  }

  const tick = () => {
    if (stopping) return
    // Evaluate the minute that just started; setTimeout can wake a few ms late.
    const now = new Date()
    now.setUTCSeconds(0, 0)
    const due = dueAt(jobs, now)
    for (const job of due) {
      if (inFlight.has(job.path)) {
        const ageS = Math.round((Date.now() - inFlight.get(job.path)) / 1000)
        log('warn', `skipped ${job.path}: previous run still in flight (${ageS}s)`)
        continue
      }
      queue.push(job)
    }
    if (due.length > 0) log('info', `${now.toISOString()} due=${due.length} queued=${queue.length} active=${active}`)
    pump()
    timer = setTimeout(tick, msUntilNextMinute())
  }

  log('info', `starting: ${jobs.length} schedule(s), target ${config.origin}, concurrency ${config.concurrency}, timeout ${config.timeoutMs}ms${dryRun ? ', DRY RUN' : ''}`)
  let timer = setTimeout(tick, msUntilNextMinute())

  await new Promise((resolve) => {
    const stop = (signal) => {
      if (stopping) return
      stopping = true
      clearTimeout(timer)
      log('info', `${signal}: stopping; ${active} request(s) still in flight will finish or time out`)
      resolve()
    }
    process.on('SIGTERM', () => stop('SIGTERM'))
    process.on('SIGINT', () => stop('SIGINT'))
  })
}

async function main(argv) {
  const args = argv.slice(2)
  const flag = (name) => args.includes(name)
  const value = (name) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }

  const jobs = loadSchedule()

  if (flag('--validate')) {
    console.log(`cron-runner: ${jobs.length} schedule(s) in ${path.relative(process.cwd(), SCHEDULE_FILE)} parse cleanly`)
    return 0
  }

  if (value('--at') !== undefined) {
    const at = new Date(value('--at'))
    if (Number.isNaN(at.getTime())) throw new Error(`--at: cannot parse "${value('--at')}"`)
    at.setUTCSeconds(0, 0)
    const due = dueAt(jobs, at)
    console.log(`${at.toISOString()}: ${due.length} due`)
    for (const job of due) console.log(`  ${job.schedule.padEnd(16)} ${job.path}`)
    return 0
  }

  const config = readConfig()
  if (!config.origin || !/^https?:\/\//.test(config.origin)) {
    throw new Error('CRON_TARGET_ORIGIN must be set to the app origin, e.g. https://example.up.railway.app')
  }
  if (!config.secret) throw new Error('CRON_SECRET must be set; it is what the cron routes authenticate against')
  if (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0) throw new Error('CRON_RUNNER_TIMEOUT_MS must be a positive number')
  if (!Number.isInteger(config.concurrency) || config.concurrency < 1) throw new Error('CRON_RUNNER_CONCURRENCY must be a positive integer')

  if (value('--once') !== undefined) {
    const target = value('--once')
    const job = jobs.find((j) => j.path === target) || { path: target, schedule: '(manual)' }
    const result = await fire(job, config)
    return result.ok ? 0 : 1
  }

  await runLoop(jobs, config, { dryRun: flag('--dry-run') })
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // process.exitCode, not process.exit(): every path resolves with no timers
  // left, so the process exits on its own once the last socket closes. Calling
  // process.exit() while a fetch socket is still closing trips a libuv
  // assertion on Windows (UV_HANDLE_CLOSING) and turns a 200 into exit 127.
  main(process.argv).then(
    (code) => {
      process.exitCode = code
    },
    (error) => {
      console.error(`[cron-runner] fatal: ${error && error.message ? error.message : error}`)
      process.exitCode = 1
    },
  )
}
