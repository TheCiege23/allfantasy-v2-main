/**
 * External live-scoring worker (G11 Phase 3c).
 *
 * A long-running daemon that ticks the SAME `runLiveScoringForActiveSeasons` the
 * cron uses (no second scoring impl) at the true engine cadence — 30s while games
 * are live, idle re-checks otherwise. Vercel cron's 1-minute floor remains the
 * fallback/reconciliation trigger; this worker provides sub-minute polling when
 * deployed on a long-running host (Railway, a container, etc.).
 *
 * SAFETY:
 *   - Runs ONLY when `LIVE_SCORE_WORKER_ENABLED=true` (never starts by accident).
 *   - Logs the (masked) DATABASE_URL host every start — never silent about which DB.
 *   - Sequential loop + overlap guard → ticks never overlap.
 *   - Graceful shutdown on SIGINT/SIGTERM (finishes the in-flight tick, then exits).
 *
 *   START (staging):  LIVE_SCORE_WORKER_ENABLED=true DATABASE_URL=<staging> npx tsx scripts/live-score-worker.ts
 *   START (prod):     deploy with LIVE_SCORE_WORKER_ENABLED=true + the prod DATABASE_URL on a long-running host.
 */
import { loadDotEnv } from '../tests/helpers/redraftSeasonHarness'
import {
  runWorkerLoop,
  resolveWorkerSleepMs,
  DEFAULT_WORKER_SLEEP,
  type WorkerSleepOptions,
} from '../lib/live-scoring/workerLoop'

loadDotEnv()

function maskDbHost(url: string | undefined): string {
  if (!url) return '(no DATABASE_URL)'
  const m = /@([^/]+)\//.exec(url)
  if (!m) return '(unparsed)'
  const host = m[1]
  return `${host.split('.')[0]}…`
}

function intEnv(name: string, fallback: number): number {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

async function main(): Promise<void> {
  if (process.env.LIVE_SCORE_WORKER_ENABLED !== 'true') {
    console.log('[live-score-worker] LIVE_SCORE_WORKER_ENABLED is not "true" — refusing to start. Set it explicitly to run.')
    process.exit(0)
  }
  if (!process.env.DATABASE_URL) {
    console.error('[live-score-worker] DATABASE_URL is required.')
    process.exit(1)
  }

  const sleepOptions: WorkerSleepOptions = {
    minMs: intEnv('LIVE_SCORE_WORKER_MIN_MS', DEFAULT_WORKER_SLEEP.minMs),
    maxMs: intEnv('LIVE_SCORE_WORKER_MAX_MS', DEFAULT_WORKER_SLEEP.maxMs),
    idleMs: intEnv('LIVE_SCORE_WORKER_IDLE_MS', DEFAULT_WORKER_SLEEP.idleMs),
  }

  console.log(`[live-score-worker] starting · DB=${maskDbHost(process.env.DATABASE_URL)} · cadence min=${sleepOptions.minMs} max=${sleepOptions.maxMs} idle=${sleepOptions.idleMs}ms`)

  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()
  const { runLiveScoringForActiveSeasons } = await import('../server/services/liveScoring/liveScoreRunner')

  let stopping = false
  const onSignal = (sig: string) => {
    if (stopping) return
    stopping = true
    console.log(`[live-score-worker] received ${sig} — finishing in-flight tick, then exiting.`)
  }
  process.on('SIGINT', () => onSignal('SIGINT'))
  process.on('SIGTERM', () => onSignal('SIGTERM'))

  const { ticks } = await runWorkerLoop({
    tick: async () => {
      const r = await runLiveScoringForActiveSeasons(prisma)
      return { nextPollDelayMs: r.nextPollDelayMs, polled: r.polled, ticked: r.ticked }
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    shouldStop: () => stopping,
    sleepOptions,
    onTick: (result, sleptMs) => {
      console.log(
        `[live-score-worker] tick · seasons=${result.ticked} polled=${result.polled} cadence=${result.nextPollDelayMs}ms → sleep ${sleptMs}ms`,
      )
    },
  })

  await prisma.$disconnect().catch(() => undefined)
  console.log(`[live-score-worker] stopped cleanly after ${ticks} tick(s).`)
  process.exit(0)
}

// Surface the resolver so an operator can sanity-check cadence math without booting.
void resolveWorkerSleepMs

main().catch((err) => {
  console.error('[live-score-worker] fatal:', err instanceof Error ? err.stack ?? err.message : err)
  process.exit(1)
})
