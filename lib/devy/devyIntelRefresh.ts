/**
 * The four CFBD intel feeds that were written, work, and had never run.
 *
 * WHY THIS EXISTS. `ingestCFBDRecruitingData`, `ingestCFBDTransferPortal`,
 * `ingestCFBDUsageAndPPA` and `ingestCFBDTeamContext` are all reachable only
 * through `runFullDevySync`, which has zero callers. Measured in production
 * 2026-08-27, every column they populate was empty across all 1,718 rows:
 *
 *     usageOverall 0 · ppaTotal 0 · wepaTotal 0
 *     returningProdPct 0 · teamSpRating 0 · portalStatus 0
 *
 * Only `recruitingState` had anything (733), from a hand-run months ago. This is
 * the same failure as `ingestCFBDStats` — correct code with no scheduled caller —
 * and it is why `draftProjectionScore` covers 812 of 1,718 players.
 *
 * ⚠ THESE ARE SEASON-WIDE FETCHES, NOT PER-TEAM ONES. Unlike the roster and stat
 * phases, each pulls one payload for the whole season (portal is a single call;
 * usage/PPA/WEPA is four; team context is two), and then loops TOP_CFB_TEAMS only
 * to WRITE. So there is nothing to slice — the cost is the DB loop, not the
 * provider. Roughly 8-11 provider calls per full pass against a 75,000/month
 * allowance.
 *
 * ⚠ WHAT IS GATED IS THE CADENCE, NOT THE QUOTA. The cron runs every 6 hours and
 * these feeds do not move that fast: a transfer portal entry is news, a returning
 * production percentage is a preseason constant, and a recruiting class changes
 * on signing day. Re-running the 50-team write loop four times a day to rewrite
 * identical values is how a cheap phase becomes the reason a cron times out —
 * which is exactly what happened to import-scores this week.
 */

import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { hasCfbdApiKey, CFBD_ENV_VARS } from '@/lib/cfbd-env'
import { CfbdUnavailableError } from '@/lib/cfb-player-data'
import {
  ingestCFBDRecruitingData,
  ingestCFBDTransferPortal,
  ingestCFBDUsageAndPPA,
  ingestCFBDTeamContext,
  ingestCFBDPassingProfile,
} from '@/lib/devy-classification'
import { defaultStatSeason } from '@/lib/devy/devyStatsRefresh'
import { rotateForFairness, type RunBudget } from '@/lib/cron/runBudget'

const HOUR_MS = 60 * 60 * 1000
/*
 * ⚠ ONE FEED PER TICK, AND ONLY WITH REAL TIME LEFT.
 *
 * Measured on the test pool 2026-08-27: a full four-feed pass took 312s against
 * 285 players. Production holds 1,718 — six times that — and this route shares a
 * 240s budget with the importer under a 300s platform ceiling that answers 502
 * itself. A full pass in one tick would not finish.
 *
 * These feeds fetch season-wide and then write per player, so the cost is the
 * write loop, and the loops are inside functions that take no budget. Until they
 * do, the bound has to be here: run ONE due feed per tick and refuse to start one
 * without enough runway to be worth beginning.
 *
 * The cadences still hold. The cron fires every 6h — four slots a day against
 * intervals of 12h/24h/24h/168h — so each feed gets its turn well inside its
 * window even taking one slot at a time.
 */
const MAX_PHASES_PER_RUN = 1
/*
 * Set from the SLOWEST measured feed, not from a round number.
 *
 * Measured 2026-08-27 against the test pool:
 *   transferPortal 137s · usageAndPpa 36s
 *
 * transferPortal is the ceiling and its cost does not scale with the pool: it
 * walks all 4,463 portal entries doing a lookup each, so production will pay
 * roughly the same 137s. A guard below that would let it START with less runway
 * than it needs and overrun into the 300s platform edge, which answers 502 and
 * loses the whole handler's response — including the phases that DID succeed.
 *
 * Deferring costs nothing: the feed is due again next tick, six hours away, well
 * inside its 12h cadence.
 */
const MIN_RUNWAY_MS = 150 * 1000
/**
 * How long one phase holds the lead position. Matches the `?intel=1` tick in
 * `cron-schedule.json` (`10 STAR/6 * * *`), so a different phase leads each fire.
 */
const INTEL_TICK_MS = 6 * HOUR_MS
const CACHE_PREFIX = 'devy_intel_refresh:'
/** Marker rows outlive their cadence so a lapsed phase is still visible. */
const MARKER_TTL_MS = 90 * 24 * HOUR_MS

type IngestResult = { updated: number; errors: string[] }

/**
 * Each feed with the interval it is worth re-reading at.
 *
 * Chosen from how fast the underlying thing actually changes, not from a round
 * number: the portal is the only one that moves daily.
 */
const PHASES: Array<{
  key: string
  everyMs: number
  why: string
  run: (season?: number) => Promise<IngestResult>
}> = [
  {
    key: 'transferPortal',
    everyMs: 12 * HOUR_MS,
    why: 'entries land daily during a window',
    run: (season) => ingestCFBDTransferPortal(season),
  },
  {
    key: 'usageAndPpa',
    everyMs: 24 * HOUR_MS,
    why: 'derived from games, so it moves at most once a week',
    run: (season) => ingestCFBDUsageAndPPA(season),
  },
  {
    /*
     * Air yards, ADOT, pass location and YAC — the five passing endpoints CFBD
     * published 2026-08-30.
     *
     * ⚠ THIS PHASE IS THE WHOLE POINT OF THE FEATURE, NOT A FOLLOW-UP. Three
     * separate times this repo has shipped correct CFBD ingest code with no
     * scheduled caller — `ingestCFBDStats`, and the four feeds in this very
     * list — and each time the columns sat empty in production while every
     * surface reading them looked healthy. A passing profile nothing refreshes
     * is worse than no passing profile: `draftProjectionScore` would start
     * ordering the board on a snapshot that silently ages out.
     *
     * Same cadence as usageAndPpa and for the same reason: both are derived
     * from games, and a season aggregate cannot move more than once a week.
     * Season is passed explicitly — see the note on ingestCFBDPassingProfile.
     */
    key: 'passingProfile',
    everyMs: 24 * HOUR_MS,
    why: 'season air-yard aggregates move only when games are played',
    run: (season) => ingestCFBDPassingProfile(season ?? defaultStatSeason()),
  },
  {
    key: 'teamContext',
    everyMs: 24 * HOUR_MS,
    why: 'SP+ and returning production are near-constant in season',
    run: (season) => ingestCFBDTeamContext(season),
  },
  {
    key: 'recruiting',
    everyMs: 7 * 24 * HOUR_MS,
    why: 'a class changes on signing day, not hourly',
    run: (season) => ingestCFBDRecruitingData(season),
  },
]

export interface DevyIntelPhaseOutcome {
  phase: string
  updated?: number
  errors?: number
  /** Recorded so the real per-feed cost at production scale is observable. */
  durationMs?: number
  /** Present ONLY when the phase did not run — always says why. */
  skipped?: string
}

export interface DevyIntelRefreshSummary {
  phases: DevyIntelPhaseOutcome[]
  ran: number
  skipped: number
}

function markerKey(phase: string): string {
  return `${CACHE_PREFIX}${phase}`
}

/** Last successful run, or null when it has never run. */
async function lastRunAt(phase: string): Promise<number | null> {
  const row = await prisma.sportsDataCache
    .findUnique({ where: { cacheKey: markerKey(phase) } })
    .catch(() => null)
  if (!row?.data || typeof row.data !== 'object' || Array.isArray(row.data)) return null
  const at = (row.data as Record<string, unknown>).at
  if (typeof at !== 'string') return null
  const ms = new Date(at).getTime()
  return Number.isFinite(ms) ? ms : null
}

async function recordRun(phase: string, result: IngestResult, durationMs: number): Promise<void> {
  const expiresAt = new Date(Date.now() + MARKER_TTL_MS)
  const data = toPrismaJsonInput({
    at: new Date().toISOString(),
    updated: result.updated,
    errors: result.errors.length,
    durationMs,
    firstError: result.errors[0] ?? null,
  })
  await prisma.sportsDataCache
    .upsert({
      where: { cacheKey: markerKey(phase) },
      update: { data, expiresAt },
      create: { cacheKey: markerKey(phase), data, expiresAt },
    })
    .catch((e) => {
      // The ingest already succeeded; a failed marker write must not undo it.
      // Loud, though — without the marker this phase re-runs every 6 hours.
      console.error(`[devy-intel] marker write failed for ${phase}:`, e instanceof Error ? e.message : String(e))
    })
}

/**
 * Run whichever intel feeds are due, in cheapest-first order.
 *
 * Returns per-phase outcomes rather than a single number, because "0 updated"
 * is ambiguous on its own: it is the correct answer for a quiet portal and the
 * symptom of a dead one, and only the `skipped` label separates them.
 */
export async function refreshDevyIntelSources(budget: RunBudget): Promise<DevyIntelRefreshSummary> {
  const phases: DevyIntelPhaseOutcome[] = []

  if (!hasCfbdApiKey()) {
    // Same labeled-absence contract as the roster and stat phases: never report
    // a zero that actually means "we could not ask".
    return {
      phases: PHASES.map((p) => ({
        phase: p.key,
        skipped: `no CFBD key (${CFBD_ENV_VARS.join(' / ')} all unset)`,
      })),
      ran: 0,
      skipped: PHASES.length,
    }
  }

  /*
   * 🛑 ROTATE, OR THE TAIL NEVER RUNS.
   *
   * This loop runs the FIRST DUE phase in order and stops. `runBudget.ts` names
   * that exact shape as a starvation bug and ships `rotateForFairness` for it;
   * the sweep was iterating a fixed array anyway, and the arithmetic had already
   * gone bad before this feature touched it.
   *
   * Four ticks a day (`10 STAR/6`), one phase each, against cadences of
   * 12h/24h/24h/24h/168h — 5.14 slots of demand against 4 of supply. Simulated
   * over 28 days on the FIXED order:
   *
   *   transferPortal 2.00/day · usageAndPpa 1.00 · passingProfile 1.00
   *   teamContext 0.00 · recruiting 0.00
   *
   * transferPortal leads and is due twice a day, so it takes half of every
   * day's supply forever and the back of the list is never reached. `recruiting`
   * was ALREADY at zero before the passing phase existed — it has never run on
   * this schedule — and adding a fifth phase pushed `teamContext` to zero too.
   *
   * Rotated by tick, the same simulation serves all five:
   *
   *   transferPortal 1.43/day · usageAndPpa 0.82 · passingProfile 0.82
   *   teamContext 0.79 · recruiting 0.14   (= exactly its 1-per-7-days cadence)
   *
   * Each phase now leads one tick in five, and a phase that is not leading still
   * runs when nothing ahead of it is due. The cost is that transferPortal drifts
   * from 2.00 to 1.43 runs a day — its 12h cadence becomes closer to 17h. That
   * is the right trade: a portal entry landing a few hours later is news slightly
   * stale, whereas teamContext and recruiting at zero are columns that are simply
   * never written, which is the failure this file's own header was written about.
   */
  const order = rotateForFairness(PHASES, INTEL_TICK_MS)

  let ranThisTick = 0
  for (const phase of order) {
    if (ranThisTick >= MAX_PHASES_PER_RUN) {
      phases.push({ phase: phase.key, skipped: 'deferred: one feed per tick' })
      continue
    }
    if (budget.exhausted() || budget.remainingMs() < MIN_RUNWAY_MS) {
      phases.push({ phase: phase.key, skipped: 'deferred: not enough runway left this tick' })
      continue
    }

    const last = await lastRunAt(phase.key)
    if (last != null && Date.now() - last < phase.everyMs) {
      const hours = Math.round((Date.now() - last) / HOUR_MS)
      phases.push({ phase: phase.key, skipped: `ran ${hours}h ago (every ${Math.round(phase.everyMs / HOUR_MS)}h — ${phase.why})` })
      continue
    }

    try {
      const startedAt = Date.now()
      const result = await phase.run()
      const durationMs = Date.now() - startedAt
      ranThisTick += 1
      await recordRun(phase.key, result, durationMs)
      phases.push({ phase: phase.key, updated: result.updated, errors: result.errors.length, durationMs })
      // Duration is recorded because the per-feed cost is currently unknown at
      // production scale; it is what tells us whether one-per-tick is enough.
      console.log(`[devy-intel] ${phase.key}: updated=${result.updated} errors=${result.errors.length} in ${Math.round(durationMs / 1000)}s`)
      if (result.errors.length) {
        console.error(`[devy-intel] ${phase.key} errors:`, result.errors.slice(0, 3).join(' | '))
      }
    } catch (e) {
      if (e instanceof CfbdUnavailableError) {
        // Provider refusal is not "no data" — stop the whole group rather than
        // burning the remaining phases against a wall, and say so.
        console.error(`[devy-intel] provider unavailable during ${phase.key}: ${e.message}`)
        phases.push({ phase: phase.key, skipped: e.message })
        // Sliced from the ROTATED order, not from PHASES: after rotation the two
        // disagree about what "the rest" is, and indexing the wrong one would
        // report a phase as unattempted while marking an already-reported one
        // for a second time.
        for (const rest of order.slice(order.indexOf(phase) + 1)) {
          phases.push({ phase: rest.key, skipped: 'not attempted: provider unavailable' })
        }
        break
      }
      const message = e instanceof Error ? e.message : String(e)
      console.error(`[devy-intel] ${phase.key} failed:`, message)
      phases.push({ phase: phase.key, skipped: `error: ${message.slice(0, 120)}` })
    }
  }

  return {
    phases,
    ran: phases.filter((p) => p.skipped == null).length,
    skipped: phases.filter((p) => p.skipped != null).length,
  }
}
