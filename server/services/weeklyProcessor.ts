/**
 * Weekly scoring processor: stats → player points → team totals → H2H → standings.
 */
import { prisma } from '@/lib/prisma'
import { resolveScoringRulesForLeague } from '@/lib/multi-sport/MultiSportScoringResolver'
import type { LeagueSport } from '@prisma/client'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { getStarterPlayerIdsForScoring } from '@/lib/scoring-engine/rosterLineup'
import { computePlayerFantasyPointsPipeline } from '@/server/services/scoringEngine'
import { buildRoundRobinPairsForWeek } from '@/server/services/roundRobinSchedule'
import { resolveMatchupOutcomesForWeek } from '@/server/services/matchupEngine'
import { recomputeStandingsForSeason } from '@/server/services/standingsEngine'
import { applyConceptWeeklyPoints } from '@/lib/scoring-engine/conceptAdjustments'
import { isRosterChopped } from '@/lib/guillotine/guillotineGuard'
import { isRosterCurrentlyEliminated } from '@/lib/survivor/SurvivorRosterState'
import { parseSettingsSnapshot } from '@/lib/league-contract/types'
import { publishMatchupLiveTickDebounced } from '@/lib/realtime-events/realtimeEventService'
import type { TeamStatTotals } from '@/lib/category-scoring'
import { optimizeBestBallLeagueLineup } from '@/lib/bestball/leagueOptimizer'
import { NATIVE_PLATFORMS, isImportedPlatform, isNativePlatform } from '@/lib/league/isNativeLeague'

/**
 * Read `scoring_mode` off a league's flat settings snapshot.
 * Defaults to 'points' so every existing league keeps its current behavior.
 */
function resolveScoringMode(settingsJson: unknown): 'points' | 'h2h_category' | 'roto' {
  if (!settingsJson || typeof settingsJson !== 'object') return 'points'
  const raw = (settingsJson as Record<string, unknown>).scoring_mode
  return raw === 'h2h_category' || raw === 'roto' ? raw : 'points'
}

/** Accumulate one player's raw stat map into a running team totals map. */
function mergePlayerStatsIntoTeam(target: TeamStatTotals, rawStats: Record<string, unknown>): void {
  for (const key of Object.keys(rawStats)) {
    const v = rawStats[key]
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    target[key] = (target[key] ?? 0) + v
  }
}

export type ProcessWeekResult = {
  leagueId: string
  season: number
  week: number
  rostersProcessed: number
  weeklyScoreRows: number
  /**
   * False for an IMPORTED league: per-player `WeeklyScore` was written, but no
   * `TeamWeekResult` row, no matchup outcome and no standings recompute — because this
   * pipeline has no access to that league's real schedule. See `processLeagueWeek`.
   */
  matchupsWritten: boolean
}

/**
 * Score one league-week: stats → player points → team totals → H2H → standings.
 *
 * 🛑 THE H2H HALF RUNS FOR NATIVE LEAGUES ONLY. `buildRoundRobinPairsForWeek` invents a
 * circle-method schedule from sorted roster ids — it does not read a real one. A
 * Sleeper/ESPN/Yahoo/MFL league's real schedule lives on the host platform, so writing a
 * `TeamWeekResult` from that pairing gives an imported league invented opponents and invented
 * win/loss, which the standings route, `matchupCenterService`, `standingsEngine` and Chimmy's
 * `MatchupContextProvider` all then read as authoritative. `matchupSources/types.ts` already
 * states the principle for its own seam: "no crash, no invented pairing".
 *
 * So for an imported league this writes per-player `WeeklyScore`, PURGES any `TeamWeekResult`
 * rows for the week, and stops. Skipped: the `TeamWeekResult` write (the fabricated pairing
 * itself), `resolveMatchupOutcomesForWeek` (which only reads rows we did not write), and
 * `recomputeStandingsForSeason`.
 *
 * ⚠ THE STANDINGS SKIP IS NOT MERELY CONSEQUENTIAL — IT IS LOAD-BEARING. That function seeds an
 * aggregate for EVERY roster at 0-0-0 and upserts `FantasyStanding` for all of them whether or
 * not any `TeamWeekResult` exists. Called here with the writes skipped, it would replace one
 * fabrication (invented opponents) with another (an invented 0-0 record).
 *
 * ⚠ The purge is scoped to the (league, season, week) being processed — it is self-healing for
 * weeks that get reprocessed, NOT a backfill. It also does not touch `FantasyStanding`, which is
 * derived from these rows: with `recomputeStandingsForSeason` skipped above, any standings row an
 * import already has is frozen where it stands. Measured 2026-08-31 against production, both
 * tables hold ZERO rows for imported leagues, so neither is a live concern — but a bulk cleanup,
 * if one is ever needed, is a separate deliberate decision and not this function's to make.
 *
 * Classification is `isImportedPlatform`, an allowlist of native platforms: an unrecognised
 * provider reads as imported, which is the safe direction. Never inline a `platform === 'sleeper'`
 * test in its place.
 */
export async function processLeagueWeek(params: {
  leagueId: string
  season: number
  week: number
}): Promise<ProcessWeekResult> {
  const { leagueId, season, week } = params

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    include: { rosters: true },
  })
  if (!league) {
    throw new Error('League not found')
  }

  const rules = await resolveScoringRulesForLeague(leagueId, league.sport as LeagueSport)
  const snap = parseSettingsSnapshot(league.settings)
  const scoringSettings = (snap?.scoringSettings ?? null) as Record<string, unknown> | null
  const scoringMode = resolveScoringMode(league.settings)
  const isCategoryMode = scoringMode === 'h2h_category' || scoringMode === 'roto'
  const isBestBallCumulative = league.bestBallMode === true && league.bbMatchupFormat === 'cumulative'

  // An imported league's schedule is not ours to invent; see this function's doc comment.
  const writesMatchups = !isImportedPlatform(league.platform)

  const rosterIds = league.rosters.map((r) => r.id).sort((a, b) => a.localeCompare(b))
  const pairMap = writesMatchups
    ? buildRoundRobinPairsForWeek(rosterIds, week)
    : new Map<string, string | null>()

  await prisma.$transaction(async (tx) => {
    await tx.weeklyScore.deleteMany({ where: { leagueId, season, week } })
    // Runs for BOTH kinds, and means two different things. Native: the usual
    // delete-then-recreate. Imported: a PURGE — nothing else in the codebase writes
    // `TeamWeekResult`, so any row an import has is a fabrication from a run that predates the
    // guard below, and this is the only thing that clears it.
    await tx.teamWeekResult.deleteMany({ where: { leagueId, season, week } })

    const weeklyRows: Array<{
      leagueId: string
      season: number
      week: number
      rosterId: string
      playerId: string
      points: number
      isStarter: boolean
      statLine?: object
    }> = []

    const teamTotals = new Map<string, number>()
    /**
     * Category-mode only: raw team stat totals summed across starters. Empty
     * for points-mode leagues (no overhead since we skip the accumulation).
     */
    const teamStatTotals = new Map<string, TeamStatTotals>()

    for (const roster of league.rosters) {
      const chopped = await isRosterChopped(leagueId, roster.id)
      const survivorOut = await isRosterCurrentlyEliminated(leagueId, roster.id).catch(() => false)
      const starterIds = new Set(getStarterPlayerIdsForScoring(roster.playerData))
      const allIds = getRosterPlayerIds(roster.playerData)
      const scoredPlayers: Array<{
        playerId: string
        points: number
        statLine: Record<string, unknown>
        rawStats: Record<string, unknown>
        playerName: string
        position: string
        team: string | null
      }> = []
      const duplicateRows: typeof weeklyRows = []

      let teamSum = 0

      if (chopped || survivorOut) {
        for (const playerId of allIds) {
          const isStarter = starterIds.size === 0 ? true : starterIds.has(playerId)
          weeklyRows.push({
            leagueId,
            season,
            week,
            rosterId: roster.id,
            playerId,
            points: 0,
            isStarter,
            statLine: { suppressed: chopped ? 'guillotine_chopped' : 'survivor_eliminated' },
          })
        }
        teamTotals.set(roster.id, 0)
        continue
      }

      const seenPlayer = new Set<string>()
      for (const playerId of allIds) {
        const isStarter = starterIds.size === 0 ? true : starterIds.has(playerId)

        if (seenPlayer.has(playerId)) {
          duplicateRows.push({
            leagueId,
            season,
            week,
            rosterId: roster.id,
            playerId,
            points: 0,
            isStarter,
            statLine: { duplicate: true, reason: 'duplicate_player_slot' },
          })
          continue
        }
        seenPlayer.add(playerId)

        const pws = await tx.playerWeeklyScore.findUnique({
          where: {
            playerId_week_season_sport: {
              playerId,
              week,
              season,
              sport: String(league.sport),
            },
          },
        })

        const rawStats = (pws?.stats && typeof pws.stats === 'object' && !Array.isArray(pws.stats)
          ? (pws.stats as Record<string, unknown>)
          : {}) as Record<string, unknown>

        const posRow = await tx.sportsPlayer
          .findUnique({
            where: { id: playerId },
            select: { name: true, position: true, team: true },
          })
          .catch(() => null)

        const { points, statLine } = computePlayerFantasyPointsPipeline({
          stats: rawStats,
          rules,
          position: posRow?.position ?? null,
          scoringSettings,
        })

        scoredPlayers.push({
          playerId,
          points,
          statLine,
          rawStats,
          playerName: posRow?.name ?? `Player ${playerId}`,
          position: posRow?.position ?? 'UTIL',
          team: posRow?.team ?? null,
        })
      }

      if (league.bestBallMode) {
        const optimized = optimizeBestBallLeagueLineup(
          league.sport as LeagueSport,
          scoredPlayers.map((player) => ({
            playerId: player.playerId,
            playerName: player.playerName,
            position: player.position,
            team: player.team,
            points: player.points,
          })),
        )
        const optimizedStarterIds = new Set(optimized.starterIds)

        for (const player of scoredPlayers) {
          const isStarter = optimizedStarterIds.has(player.playerId)
          weeklyRows.push({
            leagueId,
            season,
            week,
            rosterId: roster.id,
            playerId: player.playerId,
            points: player.points,
            isStarter,
            statLine: {
              ...player.statLine,
              bestBallSlot: optimized.starters.find((starter) => starter.playerId === player.playerId)?.slot ?? null,
            },
          })
          if (isStarter && isCategoryMode) {
            const bucket = teamStatTotals.get(roster.id) ?? {}
            mergePlayerStatsIntoTeam(bucket, player.rawStats)
            teamStatTotals.set(roster.id, bucket)
          }
        }
        weeklyRows.push(...duplicateRows)
        teamSum = optimized.totalPoints
      } else {
        for (const player of scoredPlayers) {
          const isStarter = starterIds.size === 0 ? true : starterIds.has(player.playerId)
          weeklyRows.push({
            leagueId,
            season,
            week,
            rosterId: roster.id,
            playerId: player.playerId,
            points: player.points,
            isStarter,
            statLine: player.statLine,
          })
          if (isStarter) {
            teamSum += player.points
            if (isCategoryMode) {
              const bucket = teamStatTotals.get(roster.id) ?? {}
              mergePlayerStatsIntoTeam(bucket, player.rawStats)
              teamStatTotals.set(roster.id, bucket)
            }
          }
        }
        weeklyRows.push(...duplicateRows)
      }

      teamSum = applyConceptWeeklyPoints({
        leagueId,
        leagueVariant: league.leagueVariant ?? null,
        week,
        season,
        rosterId: roster.id,
        basePoints: teamSum,
        settingsJson: league.settings,
      })

      teamTotals.set(roster.id, teamSum)
    }

    if (weeklyRows.length > 0) {
      await tx.weeklyScore.createMany({
        data: weeklyRows.map((w) => ({
          leagueId: w.leagueId,
          season: w.season,
          week: w.week,
          rosterId: w.rosterId,
          playerId: w.playerId,
          points: w.points,
          isStarter: w.isStarter,
          statLine: w.statLine ?? undefined,
        })),
      })
    }

    // Imported league: per-player WeeklyScore above is the whole job. Writing a TeamWeekResult
    // here is exactly the fabrication this guard exists to prevent.
    if (!writesMatchups) return

    for (const roster of league.rosters) {
      const total = teamTotals.get(roster.id) ?? 0
      const opp = isBestBallCumulative ? null : (pairMap.get(roster.id) ?? null)
      // Category mode: seed the categoryBreakdown column with this team's raw
      // stat totals. matchupEngine.resolveMatchupOutcomesForWeek reads this
      // column from both sides, resolves per-category winners, and rewrites
      // the row with the full breakdown. Points mode writes null.
      const initialBreakdown = isCategoryMode
        ? { teamStats: teamStatTotals.get(roster.id) ?? {} }
        : null
      await tx.teamWeekResult.create({
        data: {
          leagueId,
          season,
          week,
          rosterId: roster.id,
          totalPoints: total,
          opponentRosterId: opp,
          status: 'final',
          categoryBreakdown: initialBreakdown ?? undefined,
        },
      })
    }
  })

  if (writesMatchups) {
    await resolveMatchupOutcomesForWeek(leagueId, season, week)
    // ⚠ Skipped for imports on purpose, not merely because there is nothing to aggregate:
    // recomputeStandingsForSeason seeds every roster at 0-0-0 and upserts FantasyStanding
    // regardless of whether any TeamWeekResult exists, so running it here would write an
    // invented 0-0 record over the league's real one.
    await recomputeStandingsForSeason(leagueId, season)
  }

  void publishMatchupLiveTickDebounced(
    leagueId,
    week,
    { source: 'weekly_processor', season },
    2000,
  )

  try {
    const { resolveSpecialtyConceptKey, isSpecialtyConcept } = await import('@/lib/specialty-automation/types')
    const { dispatchSpecialtyAutomationTrigger } = await import('@/lib/specialty-automation/triggerDispatcher')
    if (isSpecialtyConcept(resolveSpecialtyConceptKey(league))) {
      await dispatchSpecialtyAutomationTrigger({
        trigger: 'onWeekFinalized',
        leagueId,
        season,
        week,
        source: 'weekly_processor',
      })
    }
  } catch (e) {
    console.warn('[weeklyProcessor] specialty automation', leagueId, e)
  }

  const count = await prisma.weeklyScore.count({
    where: { leagueId, season, week },
  })

  return {
    leagueId,
    season,
    week,
    rostersProcessed: league.rosters.length,
    weeklyScoreRows: count,
    matchupsWritten: writesMatchups,
  }
}

/**
 * Every native platform string, shaped as a case-insensitive Prisma filter. Built from
 * `NATIVE_PLATFORMS` rather than a second hand-written list so the SQL narrowing cannot drift
 * away from the predicate — `isNativeLeague.ts` records what happened the last time a guard
 * constant was copied per call site.
 */
const NATIVE_PLATFORM_FILTERS = [...NATIVE_PLATFORMS].map((platform) => ({
  platform: { equals: platform, mode: 'insensitive' as const },
}))

/**
 * Batch driver for cron / worker (best-effort per league).
 *
 * 🛑 NATIVE (AllFantasy-hosted) LEAGUES ONLY. Imported leagues — Sleeper, ESPN, Yahoo, MFL —
 * are excluded on purpose, and the exclusion is load-bearing rather than tidiness:
 *
 * - `processLeagueWeek` derives head-to-head pairings from `buildRoundRobinPairsForWeek`, a
 *   SYNTHETIC circle-method schedule computed from sorted roster ids. It never reads a real
 *   schedule. An imported league's real schedule lives on the host platform, so running this
 *   over one writes `TeamWeekResult` rows with invented opponents and invented win/loss.
 * - `TeamWeekResult` is then read as authoritative by `/api/leagues/[leagueId]/scoring/standings`,
 *   `matchupCenterService`, `standingsEngine` and Chimmy's `MatchupContextProvider`, so the
 *   fabrication surfaces to managers as their real season.
 * - It also re-scores players under AllFantasy's resolved rules instead of the platform's own
 *   published weekly points, so `WeeklyScore` need not match what those managers actually saw.
 *
 * Classification goes through `isNativePlatform`, which is an ALLOWLIST — an unrecognised
 * provider is treated as imported, the read-only answer. Do not swap it for a `platform !==
 * 'sleeper'` test here or in any caller.
 *
 * ⚠ This filter is a SECOND line, not the only one. `processLeagueWeek` is also reachable per
 * league from `/api/leagues/[leagueId]/scoring/process-week`,
 * `queueLeagueScoringRecalcAfterRulesChange` and `reprocessWeekAfterStatCorrection` — none of
 * which consults `platform` — so it self-guards too and skips the matchup/standings writes for an
 * import. Keeping the filter here as well means the batch driver never even opens those leagues,
 * so it cannot rewrite their `WeeklyScore` under AllFantasy's rules either.
 */
export async function processAllActiveLeaguesForWeek(season: number, week: number): Promise<ProcessWeekResult[]> {
  const leagues = await prisma.league.findMany({
    where: {
      AND: [
        { OR: [{ status: null }, { status: { notIn: ['archived', 'deleted'] } }] },
        { OR: NATIVE_PLATFORM_FILTERS },
      ],
    },
    select: { id: true, platform: true },
    take: 200,
  })
  const out: ProcessWeekResult[] = []
  for (const l of leagues) {
    // The SQL filter above only narrows; the predicate is the authority. If the two ever
    // disagree the predicate wins and the league is skipped, so a widened `NATIVE_PLATFORMS`
    // can never let an import through on the strength of the query alone.
    if (!isNativePlatform(l.platform)) continue
    try {
      out.push(await processLeagueWeek({ leagueId: l.id, season, week }))
    } catch (e) {
      console.error('[weeklyProcessor] league failed', l.id, e)
    }
  }
  return out
}
