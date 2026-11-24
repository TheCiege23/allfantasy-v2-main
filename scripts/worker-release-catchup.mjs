/**
 * worker-release-catchup.mjs — starts the morning worker update when GitHub's own schedule does not.
 *
 * WHY (2026-11-24). `.github/workflows/worker-release.yml` advances the cron worker once a day, from
 * three GitHub schedules at 13:20, 14:20 and 15:20 UTC. On 2026-11-24 GitHub created NONE of them —
 * not late, absent — while its other scheduled workflows went quiet from 11:05 to 16:01. A fix merged
 * the night before stayed off the worker all day. More GitHub schedules cannot fix that: the outage
 * was GitHub's scheduler itself.
 *
 * This runs inside scripts/cron-scheduler.mjs (the `allfantasy-cron` Railway service), which ticks
 * every minute on its own clock. At :50 past 13, 14 and 15 UTC — half an hour after each GitHub
 * attempt — it looks at the workflow's recent runs and, if no attempt has succeeded in the last
 * BACKUP_GAP_H hours and none is queued or running, dispatches the workflow with `catchup=true`.
 *
 * The decision is the SAME function the scheduled attempt uses (decideScheduledAdvance), and the
 * dispatched run applies it again itself: a catch-up run is a scheduled attempt by another route,
 * not a manual override. So a GitHub attempt that turns up late after a catch-up succeeded stands
 * down, and a catch-up that races a late GitHub attempt stands down — the worker still deploys at
 * most once a morning, inside the quiet window.
 *
 * Disabled (one log line) without WORKER_RELEASE_GH_TOKEN: a fine-grained token for this repository
 * with Actions read & write. It is sent only as an Authorization header and never logged.
 * Env: WORKER_RELEASE_GH_TOKEN, WORKER_RELEASE_REPO (default TheCiege23/allfantasy-v2-main).
 */
import { decideScheduledAdvance } from './worker-release-window.mjs'

const API = 'https://api.github.com'
const WORKFLOW = 'worker-release.yml'
const DEFAULT_REPO = 'TheCiege23/allfantasy-v2-main'

/** UTC hours and minute at which a catch-up may fire: 30 minutes after each GitHub attempt. */
export const CATCHUP_HOURS = [13, 14, 15]
export const CATCHUP_MINUTE = 50

const IN_FLIGHT = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested'])

/**
 * Pure. Should the catch-up dispatch the workflow now?
 * @param {Date} now
 * @param {{ status: string, conclusion: string | null, created_at: string }[]} runs newest first
 * @returns {{ dispatch: boolean, line: string }}
 */
export function decideCatchup(now, runs) {
  if (!CATCHUP_HOURS.includes(now.getUTCHours()) || now.getUTCMinutes() !== CATCHUP_MINUTE) {
    return { dispatch: false, line: 'not a catch-up minute' }
  }
  const busy = runs.find((r) => IN_FLIGHT.has(r.status))
  if (busy) return { dispatch: false, line: `skip: a run is already ${busy.status} (created ${busy.created_at})` }
  const last = runs.find((r) => r.status === 'completed' && r.conclusion === 'success')
  const verdict = decideScheduledAdvance(now, last ? new Date(last.created_at) : null)
  return { dispatch: verdict.run, line: verdict.line }
}

async function gh(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'allfantasy-cron',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`${method} ${path.split('?')[0]} -> HTTP ${res.status}`)
  return res.status === 204 ? null : res.json()
}

let warnedDisabled = false

/** One tick. Never throws. */
export async function catchupOnce({ now = new Date(), log = console.log, env = process.env, request = gh } = {}) {
  const token = env.WORKER_RELEASE_GH_TOKEN?.trim()
  if (!token) {
    if (!warnedDisabled) log('[worker-catchup] disabled: WORKER_RELEASE_GH_TOKEN is not set')
    warnedDisabled = true
    return { dispatched: false }
  }
  if (!CATCHUP_HOURS.includes(now.getUTCHours()) || now.getUTCMinutes() !== CATCHUP_MINUTE) return { dispatched: false }
  const repo = env.WORKER_RELEASE_REPO?.trim() || DEFAULT_REPO
  try {
    const data = await request(token, 'GET', `/repos/${repo}/actions/workflows/${WORKFLOW}/runs?per_page=20`)
    const decision = decideCatchup(now, data?.workflow_runs ?? [])
    log(`[worker-catchup] ${decision.line}`)
    if (!decision.dispatch) return { dispatched: false }
    await request(token, 'POST', `/repos/${repo}/actions/workflows/${WORKFLOW}/dispatches`, {
      ref: 'main',
      inputs: { catchup: 'true' },
    })
    log('[worker-catchup] dispatched worker-release (catchup=true); the run re-checks the window itself')
    return { dispatched: true }
  } catch (e) {
    log(`[worker-catchup] failed: ${e?.message ?? e}`)
    return { dispatched: false }
  }
}
