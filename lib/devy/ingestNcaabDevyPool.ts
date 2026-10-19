import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { seedCollegePlayers } from '@/lib/devy/CollegePlayerSeedService'

/**
 * The scheduled writer for the NCAAB `DevyPlayer` pool (rows with sport 'NCAAB', the college
 * layer for NBA dynasty prospects). Runs on the `/api/cron/import-players?intel=1` tick.
 *
 * 🛑 WHY THIS EXISTS. `seedCollegeBasketballPlayers` is the only writer of those rows, and until
 * this its only caller was `lib/workers/devy-data-worker.ts`, reached through the BullMQ
 * `ncaa_player_sync` job — a job type nothing enqueues (`enqueueDevy` has zero callers), consumed
 * by `scripts/start-worker.ts`, which no package script or deploy starts. So the pool had no
 * scheduled writer. That is the `ingestCFBDStats` failure CLAUDE.md records: a table nothing
 * refreshes, read as if it were current.
 *
 * Scheduled ingestion only — this is the one place a provider call is allowed to happen on behalf
 * of this pool. The seed reads through `apiChain` (sportsDataCache → SportsPlayer → Rolling
 * Insights, which tries both RI accounts' tokens and retries a 304 once with a fresh buster →
 * fallbacks). Nothing here logs a URL or a token.
 *
 * ⚠ DATA CAVEAT, NOT FIXED HERE. The seed does not read player `status`, so it keeps whatever the
 * chain returns. For NCAABB, RI `ACT` is NOT the current roster (`contracts/espn/GAPS.md` M-01,
 * `contracts/rolling-insights/GAPS.md` N-17): former players stay `ACT` and 2026-27 newcomers are
 * absent. Scheduling the seed refreshes the pool on that basis; it does not make the pool a
 * current roster.
 *
 * Cadence: weekly, by a `sportsDataCache` marker (the `ingestMlbFantraxIdentities` pattern). A run
 * a deadline stopped stores `resumeFrom` and continues on the next tick instead of waiting a week;
 * the chain caches the payload for 24h and intel ticks are 6h apart, so the offset indexes the
 * same row order. An empty provider answer does NOT stamp the week — it records the attempt and
 * backs off for a day.
 */
export const NCAAB_DEVY_POOL_MARKER_KEY = 'devy:ncaab-pool:last-run'

const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS
const FAILURE_BACKOFF_MS = DAY_MS
const MARKER_TTL_MS = 30 * DAY_MS

type Marker = {
  at?: string | null
  resumeFrom?: number
  lastAttemptAt?: string
  lastError?: string | null
}

export type NcaabDevyPoolResult =
  | { skipped: 'weekly cadence' | 'retry backoff'; lastRunAt: string | null }
  | {
      seeded: number
      fetched: number
      totalInPool: number
      source: string
      complete: boolean
      resumeFrom: number
      errors: number
    }

function readMarker(data: unknown): Marker {
  return data && typeof data === 'object' && !Array.isArray(data) ? (data as Marker) : {}
}

function ageMs(iso: string | null | undefined, now: number): number {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? now - t : Number.POSITIVE_INFINITY
}

async function writeMarker(marker: Marker & Record<string, unknown>): Promise<void> {
  const data = toPrismaJsonInput(marker)
  const expiresAt = new Date(Date.now() + MARKER_TTL_MS)
  await prisma.sportsDataCache.upsert({
    where: { cacheKey: NCAAB_DEVY_POOL_MARKER_KEY },
    create: { cacheKey: NCAAB_DEVY_POOL_MARKER_KEY, data, expiresAt },
    update: { data, expiresAt },
  })
}

export async function ingestNcaabDevyPoolIfDue(input: { deadlineAt: number }): Promise<NcaabDevyPoolResult> {
  const now = Date.now()
  const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey: NCAAB_DEVY_POOL_MARKER_KEY } })
  const marker = readMarker(row?.data)
  const lastRunAt = typeof marker.at === 'string' ? marker.at : null
  const resumeFrom = typeof marker.resumeFrom === 'number' && marker.resumeFrom > 0 ? Math.floor(marker.resumeFrom) : 0

  if (marker.lastError && ageMs(marker.lastAttemptAt, now) < FAILURE_BACKOFF_MS) {
    return { skipped: 'retry backoff', lastRunAt }
  }
  if (resumeFrom === 0 && ageMs(lastRunAt, now) < WEEK_MS) {
    return { skipped: 'weekly cadence', lastRunAt }
  }

  const seed = await seedCollegePlayers({ sport: 'NCAAB', deadlineAt: input.deadlineAt, startAt: resumeFrom })
  const attemptAt = new Date().toISOString()

  if (!seed.fetched) {
    const lastError = seed.errors[0]?.slice(0, 160) ?? 'no rows'
    // Keep `at` and `resumeFrom` as they were: a failed fetch finished nothing.
    await writeMarker({ at: lastRunAt, resumeFrom, lastAttemptAt: attemptAt, lastError })
    throw new Error(`NCAAB players: provider chain returned no rows (${lastError})`)
  }

  const complete = seed.nextOffset == null
  const nextResume = complete ? 0 : (seed.nextOffset as number)
  const summary = {
    seeded: seed.seeded,
    fetched: seed.fetched,
    totalInPool: seed.totalInPool,
    source: seed.source,
    complete,
    resumeFrom: nextResume,
    errors: seed.errors.length,
  }
  // Only a pass that reached the last row stamps the week.
  await writeMarker({ ...summary, at: complete ? attemptAt : lastRunAt, lastAttemptAt: attemptAt, lastError: null })
  return summary
}
