import 'server-only'

import { prisma as defaultPrisma } from '@/lib/prisma'
import { rotateForFairness, remainingFor, type RunBudget } from '@/lib/cron/runBudget'
import { getV2Rankings, RankingsUnavailableError } from './v2-adapter'
import { saveRankingsSnapshot } from './snapshots'

/**
 * THE SCHEDULED WRITER FOR `rankings_snapshots`, WHICH HAD NONE.
 *
 * ── 🛑 WHY THIS EXISTS: A THREE-TABLE CHAIN, EMPTY END TO END ───────────────────────────────
 * Measured against the production branch on 2026-09-11:
 *
 *     rankings_snapshots            0 rows   ← only writer is a membership-gated POST
 *           ↓ loadContext bails: `if (!snap.length) return null`
 *     season_forecast_snapshots     0 rows   ← engine returns null, writes nothing, SILENTLY
 *           ↓ assembleWindowFacts: `if (gaps.length) return { facts: null, … }`
 *     competitive window            refused for 288 of 288 leagues
 *
 * `saveRankingsSnapshot`'s only caller is `POST /api/leagues/[leagueId]/snapshots`, which nothing
 * calls on a schedule. So the bottom table stays empty, the middle engine bails on its first query,
 * and the value-v2 window resolver refuses for every league — not "most", every one.
 *
 * ⚠ AND EVERY LINK FAILS WITHOUT RAISING. That is the reason this file reports counts rather than
 * returning void: a sweep over three silent seams would go green producing zero rows, which is the
 * failure this repo keeps paying for. `written` is read off the write path, never inferred.
 *
 * ── WHY IT LIVES IN THE domain-os-refresh CRON ──────────────────────────────────────────────
 * That cron already fires every 30 minutes (`cron-schedule.json`, fast tier), already sweeps this
 * population — 244 scopes kept fresh inside the hour — and the repo's standing rule is to combine
 * into an existing route rather than add one.
 *
 * 🛑 BUT IT IS NOT LIKE THE FEEDS BESIDE IT, AND THAT DRIVES EVERY LIMIT BELOW. Warming a
 * draft-rules fact is a local derive. Computing rankings is ~6 LIVE Sleeper calls per league, and
 * `lib/sleeper-client.ts` has a 12s per-call timeout and NOTHING else: no throttle, no backoff, no
 * retry, no concurrency cap. So the batch size here IS the rate limiter. Nothing downstream will
 * stop a bad value.
 */

/** Off unless explicitly enabled. Landing this changes nothing until an operator flips it. */
export const RANKINGS_SWEEP_FLAG = 'DECISION_OS_RANKINGS_SWEEP_ENABLED'

export function rankingsSweepEnabled(): boolean {
  return process.env[RANKINGS_SWEEP_FLAG] === 'true'
}

/**
 * Leagues attempted per fire.
 *
 * ⚠ MEASURED, NOT ROUND. 2026-09-11, five real Sleeper leagues in one process: ~1.4s warm median
 * (0.85s / 1.23s / 1.28s / 1.97s / 2.69s) and ~3.6s for the FIRST league, which pays `getAllPlayers`
 * filling its module-level cache. Team count barely matters — a 32-team league measured FASTER
 * than a cold 12-team — because the cost is the fixed round trips, not roster volume.
 *
 * At the host's 30-minute cadence that is 48 fires a day, so 5 leagues covers 240/day against 238
 * active Sleeper leagues: full coverage daily, ~30 Sleeper calls per fire, about one a minute
 * averaged. A competitive window is a weekly judgement with a three-week hysteresis lookback, so
 * day-old
 * rankings are well inside tolerance and week-old ones are not.
 */
const DEFAULT_LEAGUE_CAP = 5

/**
 * How fresh a snapshot has to be for a league to be skipped.
 *
 * ⚠ SHORTER THAN 24h ON PURPOSE. At exactly 24h a league refreshed at 09:00 is not due at 08:59
 * the next day, so one slow cycle pushes it a whole extra day. 18h leaves slack without making a
 * league eligible twice in a day.
 */
const SNAPSHOT_TTL_MS = 18 * 60 * 60 * 1000

/** Matches the host cron's fire interval, so a different slice leads each fire. */
const ROTATION_PERIOD_MS = 30 * 60 * 1000

/**
 * Ceiling on ONE league's compute.
 *
 * 🛑 `budget.exhausted()` IS CHECKED BETWEEN UNITS AND CANNOT BOUND ONE. With a second left it
 * passes and the league then runs for as long as six 12s Sleeper timeouts allow — 72s worst case,
 * inside a cron that shares a 50-minute window with thirteen other sub-hourly jobs including
 * `import-scores` and `live-score-tick` on a two-minute cadence. `remainingFor` is the repo's
 * answer to exactly this, and returns `null` rather than 0 when a call cannot possibly finish, so
 * a call that cannot complete is never started.
 */
const PER_LEAGUE_CAP_MS = 30_000

/** Same list the host cron uses: refreshing a finished league's rankings helps nobody. */
const DEAD_STATUSES = ['ARCHIVED', 'COMPLETE', 'COMPLETED', 'CLOSED']

/**
 * ⚠ SLEEPER ONLY, AND THE DENOMINATOR SHOULD SAY SO. `computeLeagueRankingsV2` reaches Sleeper
 * for rosters, users, league info, bracket, drafts and picks; there is no equivalent path for the
 * other platforms. Of 288 leagues, 238 are Sleeper and all 238 are active — so this covers 238 of
 * 246 active leagues (~97%). The other 8 (6 ESPN, 1 Fleaflicker, 1 Fantrax) are EXCLUDED here
 * rather than attempted and counted as failures: a league with no rankings path is not a failure,
 * and filing it as one would make the failure count meaningless.
 */
const SWEEP_PLATFORM = 'sleeper'

export interface RankingsSweepCounts {
  /** Leagues eligible before the per-fire cap. */
  considered: number
  /** Leagues whose newest snapshot is older than the TTL, or absent. */
  due: number
  /** Snapshots actually persisted. Read off the write path, never inferred. */
  written: number
  /**
   * Leagues the engine declined to rank.
   *
   * ⚠ NORMAL, NOT A FAULT. `RankingsUnavailableError` means `fetchLeagueSettings` could not load
   * the league — a deleted league, a renumbered id, a provider timeout. One league's skip must not
   * end the walk, which is the whole reason that error is named rather than a null.
   */
  skipped: number
  /**
   * Leagues that ranked zero teams.
   *
   * 🛑 REFUSED, NOT WRITTEN. `saveRankingsSnapshot` runs `prisma.$transaction(teams.map(...))`, so
   * an empty array is a no-op transaction that RESOLVES having written nothing. Calling it would
   * count a write that did not happen; an empty roster set is a fact about the league.
   */
  emptyRoster: number
  /** Anything the two named cases above do not cover. */
  failed: number
  /** Leagues not reached because the budget ran out. Reported, never silently dropped. */
  skippedForTime: number
  errors: string[]
}

export function emptyRankingsSweepCounts(): RankingsSweepCounts {
  return { considered: 0, due: 0, written: 0, skipped: 0, emptyRoster: 0, failed: 0, skippedForTime: 0, errors: [] }
}

export interface RankingsSweepDeps {
  prisma?: typeof defaultPrisma
  budget: RunBudget
  leagueCap?: number
  now?: () => number
}

/**
 * Sweep a rotating slice of Sleeper leagues, writing a rankings snapshot for each that is due.
 *
 * Returns counts for every outcome. A fire that attempted leagues and wrote nothing is visible in
 * the numbers rather than reported as success.
 */
export async function runRankingsSweep(deps: RankingsSweepDeps): Promise<RankingsSweepCounts> {
  const counts = emptyRankingsSweepCounts()

  /*
   * ⚠ THE FLAG IS READ AT THE BOUNDARY, SO FLAG-OFF COSTS NOTHING — not one League read, not one
   * Sleeper call. A flag that still paid for the work it disables would not be a flag.
   */
  if (!rankingsSweepEnabled()) return counts

  const prisma = deps.prisma ?? defaultPrisma
  const now = deps.now ?? (() => Date.now())
  const leagueCap = Math.max(1, deps.leagueCap ?? DEFAULT_LEAGUE_CAP)

  const leagues = await prisma.league
    .findMany({
      where: {
        platform: SWEEP_PLATFORM,
        sport: 'NFL',
        NOT: { status: { in: DEAD_STATUSES } },
      },
      select: { platformLeagueId: true },
      orderBy: { updatedAt: 'desc' },
    })
    .catch((e: unknown) => {
      counts.errors.push(`league_query: ${e instanceof Error ? e.message : String(e)}`)
      return [] as { platformLeagueId: string }[]
    })

  /*
   * Distinct because a platform league id can appear on more than one League row — the same
   * Sleeper league imported by two users. Ranking it twice in one fire would spend the Sleeper
   * budget re-deriving an identical snapshot.
   */
  const ids = [...new Set(leagues.map((l) => l.platformLeagueId).filter((v): v is string => !!v))]
  counts.considered = ids.length
  if (ids.length === 0) return counts

  const ordered = rotateForFairness(ids, ROTATION_PERIOD_MS)
  let attempted = 0

  for (const platformLeagueId of ordered) {
    if (attempted >= leagueCap) break

    // Checked BETWEEN leagues, per RunBudget's contract.
    if (deps.budget.exhausted()) {
      counts.skippedForTime = ids.length - attempted
      break
    }
    // And the half `exhausted()` cannot do: refuse to START a league that cannot finish.
    if (remainingFor(now() + deps.budget.remainingMs(), PER_LEAGUE_CAP_MS) === null) {
      counts.skippedForTime = ids.length - attempted
      break
    }

    /*
     * DUE-NESS IS A READ, NOT A GUESS — the same rule the host cron applies to its feeds. Asking
     * the output table first means a warm league costs one indexed query instead of six Sleeper
     * calls, and producer and consumer share one definition of stale.
     *
     * ⚠ BY `createdAt`, NOT BY WEEK. The week is not known until `computeLeagueRankingsV2` has
     * read the league's settings from Sleeper — which is the call this check exists to avoid. So
     * freshness is "when did we last write anything for this league", which is answerable without
     * spending the thing being decided.
     */
    let freshAt: Date | null = null
    try {
      const latest = await prisma.rankingsSnapshot.findFirst({
        where: { leagueId: platformLeagueId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      })
      freshAt = latest?.createdAt ?? null
    } catch (e: unknown) {
      counts.errors.push(`due_read ${platformLeagueId}: ${e instanceof Error ? e.message : String(e)}`)
      counts.failed += 1
      attempted += 1
      continue
    }
    if (freshAt && now() - freshAt.getTime() < SNAPSHOT_TTL_MS) continue

    counts.due += 1
    attempted += 1

    try {
      /*
       * ⚠ NO `week` — AND PASSING `0` HERE WOULD HAVE BEEN A SILENT BUG. The engine resolves the
       * week as `currentWeek ?? settings.week`, and `??` is nullish: `0` is a value, so a sweep
       * that padded a required field with `0` would pin every snapshot to week 0 and nothing would
       * object. The week is read from the league's own settings by this very call, so omitting it
       * is the only correct spelling. `getV2Rankings` was widened to allow that.
       */
      const v2 = await getV2Rankings({ leagueId: platformLeagueId })
      const teams = Array.isArray(v2?.teams) ? v2.teams : []

      if (teams.length === 0) {
        counts.emptyRoster += 1
        continue
      }

      await saveRankingsSnapshot({
        leagueId: platformLeagueId,
        season: String(v2.season),
        week: Number(v2.week),
        teams: teams.map((t: { [k: string]: unknown }) => ({
          rosterId: t.rosterId as string | number,
          rank: Number(t.rank ?? 0),
          composite: Number(t.composite ?? 0),
          expectedWins: (t.expectedWins ?? null) as number | null,
          luckDelta: (t.luckDelta ?? null) as number | null,
          metricsJson: (t._snapshotMetrics ?? null) as never,
        })),
      })
      counts.written += 1
    } catch (e: unknown) {
      /*
       * Per-league isolation. A league Sleeper will not answer for is one league's problem; the
       * walk continues and says so in `skipped`, which is why that error is named rather than
       * being a null the caller has to guess at.
       */
      if (e instanceof RankingsUnavailableError) {
        counts.skipped += 1
        continue
      }
      counts.failed += 1
      counts.errors.push(`${platformLeagueId}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return counts
}
