#!/usr/bin/env node
/**
 * cron-scheduler.mjs — runs the app's crons from Railway instead of GitHub Actions.
 *
 * WHY (2026-10-01). Both cron tiers ran as GitHub workflows, on the SAME concurrent-job pool as PR
 * CI. On a busy PR day the crons queued behind it: fast-tier ticks at 17:20/17:21/18:28/18:30 UTC
 * were cancelled unrun, the fourth starvation in four days, and a peer cancelled 112 queued PR
 * runs by hand to free runners for them. A scheduler that shares a queue with CI is only as
 * punctual as CI is idle.
 *
 * This process is the `allfantasy-cron` Railway service (Dockerfile.cron). It does not reimplement
 * any dispatch logic — it runs the SAME two scripts the workflows ran:
 *
 *   fast tier   scripts/cron-fast-tier-loop.mjs, back to back, one 50-minute window after another.
 *               Railway's own cron feature cannot host it: its minimum interval is 5 minutes and
 *               the fast tier has 1-minute jobs.
 *   slow tier   every UTC minute, each schedule from cron-schedule.json that is due is handed to
 *               scripts/cron-dispatch.mjs --schedule "<expr>" — exactly what cron-slow-tier.yml
 *               did with `github.event.schedule`. A schedule still running from its last firing is
 *               skipped, never doubled.
 *
 * DRY-RUN BY DEFAULT. Unless CRON_SCHEDULER_LIVE=1, every child gets --dry-run: the slow tier logs
 * what each minute WOULD fire and the fast tier prints its plan once. That is the cutover check —
 * compare against the GitHub runs — and it means deploying this service cannot double-fire
 * anything while the workflows are still live. Going live and disabling the workflows is one step.
 *
 * Env: CRON_SCHEDULER_LIVE ('1' = send requests), APP_URL, CRON_SECRET (required when live).
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { readCronSchedule, slowTierSchedules } from './cron-tier.mjs'

/** A fast window that ends sooner than this (crash, config error) waits out the rest before respawning. */
const MIN_FAST_WINDOW_MS = 60_000

// ── cron expressions ────────────────────────────────────────────────────────────────────────────

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day-of-month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day-of-week', min: 0, max: 7 }, // 7 is Sunday too
]

/** One crontab field to the set of values it allows. Throws on anything it does not understand. */
export function parseField(field, min, max) {
  const out = new Set()
  for (const part of String(field).split(',')) {
    const m = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/)
    if (!m) throw new Error(`cannot parse cron field "${field}"`)
    let lo = min
    let hi = max
    if (m[1] !== '*') {
      const [a, b] = m[1].split('-').map(Number)
      lo = a
      hi = b ?? (m[2] ? max : a)
    }
    const step = m[2] ? Number(m[2]) : 1
    if (lo < min || hi > max || lo > hi || step < 1) throw new Error(`cron field "${field}" out of range`)
    for (let v = lo; v <= hi; v += step) out.add(v)
  }
  return out
}

/** Parses a 5-field expression once; returns a matcher over a Date, evaluated in UTC like GitHub. */
export function compileCron(expr) {
  const parts = String(expr).trim().split(/\s+/)
  if (parts.length !== 5) throw new Error(`cron "${expr}" must have 5 fields`)
  const sets = parts.map((p, i) => parseField(p, FIELDS[i].min, FIELDS[i].max))
  if (sets[4].has(7)) sets[4].add(0)
  const domRestricted = parts[2] !== '*'
  const dowRestricted = parts[4] !== '*'
  return (date) => {
    if (!sets[0].has(date.getUTCMinutes())) return false
    if (!sets[1].has(date.getUTCHours())) return false
    if (!sets[3].has(date.getUTCMonth() + 1)) return false
    const dom = sets[2].has(date.getUTCDate())
    const dow = sets[4].has(date.getUTCDay())
    // Standard cron: when BOTH day fields are restricted, either may match.
    if (domRestricted && dowRestricted) return dom || dow
    return dom && dow
  }
}

/** The schedules due at `date` (minute resolution). */
export function dueSchedules(compiled, date) {
  return compiled.filter((c) => c.matches(date)).map((c) => c.expr)
}

// ── processes ───────────────────────────────────────────────────────────────────────────────────

const here = path.dirname(fileURLToPath(import.meta.url))
const children = new Set()
let stopping = false

const log = (...a) => console.log(new Date().toISOString(), ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function runScript(script, args, label) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(here, script), ...args], {
      cwd: path.resolve(here, '..'),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    children.add(child)
    const prefix = (stream, out) => {
      let buf = ''
      stream.setEncoding('utf8')
      stream.on('data', (chunk) => {
        buf += chunk
        let i
        while ((i = buf.indexOf('\n')) >= 0) {
          out.write(`[${label}] ${buf.slice(0, i)}\n`)
          buf = buf.slice(i + 1)
        }
      })
      stream.on('end', () => buf && out.write(`[${label}] ${buf}\n`))
    }
    prefix(child.stdout, process.stdout)
    prefix(child.stderr, process.stderr)
    child.on('error', (e) => log(`[${label}] could not start: ${e.message}`))
    child.on('close', (code, signal) => {
      children.delete(child)
      resolve(code ?? (signal ? 1 : 0))
    })
  })
}

async function fastTier(live) {
  if (!live) {
    await runScript('cron-fast-tier-loop.mjs', ['--dry-run'], 'fast')
    log('[fast] dry-run: plan printed above; not looping until CRON_SCHEDULER_LIVE=1')
    return
  }
  while (!stopping) {
    const started = Date.now()
    // No --window-minutes: the loop's own default (50) is what the workflow ran in production.
    const code = await runScript('cron-fast-tier-loop.mjs', [], 'fast')
    const took = Date.now() - started
    log(`[fast] window ended: exit ${code} after ${Math.round(took / 1000)}s`)
    if (!stopping && took < MIN_FAST_WINDOW_MS) await sleep(MIN_FAST_WINDOW_MS - took)
  }
}

async function slowTier(live, compiled) {
  const running = new Set()
  // Fire at second 2 of each UTC minute, keyed to the boundary rather than to "now", so a slow
  // event loop can delay a minute but never skip or repeat one.
  let boundary = Math.floor(Date.now() / 60_000) * 60_000 + 60_000
  while (!stopping) {
    const wait = boundary + 2_000 - Date.now()
    if (wait > 0) await sleep(wait)
    if (stopping) break
    const lateBy = Date.now() - boundary
    if (lateBy > 60_000) {
      log(`[slow] event loop stalled ${Math.round(lateBy / 1000)}s — skipping to the current minute`)
      boundary = Math.floor(Date.now() / 60_000) * 60_000
    }
    const at = new Date(boundary)
    for (const expr of dueSchedules(compiled, at)) {
      if (running.has(expr)) {
        log(`[slow] ${expr} still running from its last firing — skipped this one`)
        continue
      }
      running.add(expr)
      log(`[slow] ${at.toISOString()} due: ${expr}${live ? '' : ' (dry-run)'}`)
      runScript('cron-dispatch.mjs', ['--schedule', expr, ...(live ? [] : ['--dry-run'])], `slow ${expr}`)
        .then((code) => code !== 0 && log(`[slow] ${expr} dispatch exited ${code}`))
        .finally(() => running.delete(expr))
    }
    boundary += 60_000
  }
}

async function main() {
  const live = process.env.CRON_SCHEDULER_LIVE === '1'
  const schedules = slowTierSchedules(readCronSchedule(path.resolve(here, '..')))
  const compiled = schedules.map((expr) => ({ expr, matches: compileCron(expr) }))

  let host = '(unset)'
  try {
    host = new URL(process.env.APP_URL ?? '').host || host
  } catch {
    /* reported below */
  }
  log(`cron-scheduler starting: ${live ? 'LIVE' : 'DRY-RUN'}, ${schedules.length} slow schedule(s), APP_URL host ${host}`)
  if (live && (!process.env.APP_URL?.trim() || !process.env.CRON_SECRET?.trim())) {
    // Loud on purpose: the workflows went quiet without config, but here quiet means no crons at all.
    log('LIVE needs APP_URL and CRON_SECRET — refusing to start')
    process.exit(1)
  }

  const stop = (signal) => {
    if (stopping) return
    stopping = true
    log(`${signal}: stopping ${children.size} child process(es)`)
    for (const c of children) c.kill('SIGTERM')
    setTimeout(() => process.exit(0), 10_000).unref()
  }
  process.on('SIGTERM', () => stop('SIGTERM'))
  process.on('SIGINT', () => stop('SIGINT'))

  await Promise.all([fastTier(live), slowTier(live, compiled)])
  // Only reachable once stopping; let in-flight children finish inside the grace period.
  while (children.size) await sleep(250)
  process.exit(0)
}

if (process.argv[1] != null && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    log('cron-scheduler crashed:', e?.stack || e)
    process.exit(1)
  })
}
