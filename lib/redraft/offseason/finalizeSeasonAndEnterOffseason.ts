import { finalizeRotoSeason, type RotoFinalizeResult } from './finalizeRotoSeason'
import { triggerCommissionerRatingPrompt } from '@/lib/commissioner/CommissionerRatingTrigger'
/**
 * Crown the champion, archive the season, enter the offseason, open the keeper
 * window — as one call, because it is one thing.
 *
 * 🛑 THIS CHAIN LIVED INSIDE A ROUTE HANDLER, AND THAT IS WHY IT IS BEING MOVED.
 * `POST /api/redraft/seasons/finalize` is the only thing that has ever run it,
 * and it runs it only when a commissioner clicks. The moment anything else needs
 * to finish a season — the scheduled postseason roller does — the choice is to
 * copy four steps or to extract them. Copying is how `enterRedraftOffseason`
 * ends up called on one path and not the other, which is the class of bug this
 * whole area is made of: two callers, one of them silently missing a step.
 *
 * The order is load-bearing and is preserved exactly as the route had it:
 *
 *   1. finalize the bracket        — crowns the champion; idempotent
 *   2. enter the offseason         — writes LeagueSeason + FranchiseSeason,
 *                                    transitions lifecycleState to `offseason`
 *   3. open the keeper offseason   — keeper/dynasty leagues only. AWAITED: for a dynasty
 *                                    league this is what creates next season and carries every
 *                                    roster into it, and a fire-and-forget promise is dropped
 *                                    whenever the serverless process ends first.
 *
 * Archive retries run even after champion persistence; the archive is idempotent.
 * Keeper setup retains its first-finalize gate and dynasty repair path.
 *
 * ⚠ AND A FAILURE IN 2 OR 3 MUST NOT FAIL THE CALL. The champion is already
 * crowned and persisted by then; throwing would leave a league with a champion,
 * no archive, and a caller that believes nothing happened. Both are caught,
 * logged, and reported in the result so the caller can surface a partial.
 */

import { prisma } from '@/lib/prisma'
import { finalizeNflRedraftPlayoffRuntimeSeason } from '@/lib/playoff-runtime'
import { supportsKeeperDeclarations } from '@/lib/league/keeper-policy'
import { triggerKeeperOffseason } from '@/lib/keeper/offseasonEngine'
import { enterRedraftOffseason } from './RedraftOffseasonService'
import { isDynastyFamilyLeague } from './carryDynastyRosters'
import { ensureDynastyNextSeason } from './startDynastyNewSeason'

export type FinalizeSeasonResult =
  | {
      ok: true
      alreadyFinalized: boolean
      championRosterId: string | null
      runnerUpRosterId: string | null
      offseasonEntered: boolean
      offseasonSnapshotId: string | null
      keeperOffseasonTriggered: boolean
      /** The keeper offseason ran to the end — for a dynasty league, next season exists with its rosters. */
      keeperOffseasonCompleted: boolean
      /** The runtime state and events, for callers that render them. */
      result: Awaited<ReturnType<typeof finalizeNflRedraftPlayoffRuntimeSeason>> | RotoFinalizeResult
    }
  | {
      ok: false
      code: string
      message: string
      result: Awaited<ReturnType<typeof finalizeNflRedraftPlayoffRuntimeSeason>> | RotoFinalizeResult
    }

export async function finalizeSeasonAndEnterOffseason(input: {
  seasonId: string
  leagueId: string
  actorUserId: string
  tiebreakerRosterId?: string
}): Promise<FinalizeSeasonResult> {
  const leagueScoring=await prisma.league.findUnique({where:{id:input.leagueId},select:{settings:true,leagueType:true,isDynasty:true,sport:true}})
  const isRoto=(leagueScoring?.settings as Record<string,unknown> | null)?.scoring_mode === 'roto'
  const result = isRoto ? await finalizeRotoSeason(input.seasonId,input.actorUserId,input.tiebreakerRosterId) : await finalizeNflRedraftPlayoffRuntimeSeason({
    seasonId: input.seasonId,
    actorUserId: input.actorUserId,
  })

  if (!result.ok) {
    return { ok: false, code: result.code, message: isRoto ? result.message : describe(result.code), result }
  }

  const alreadyFinalized = 'alreadyFinalized' in result && result.alreadyFinalized === true

  let offseasonEntered = false
  let offseasonSnapshotId: string | null = null
  let archivedSeason: number | null = null
  let keeperOffseasonTriggered = false
  let keeperOffseasonCompleted = false

  // Every format retries a failed archive; the archive service is idempotent.
  { // A completed champion may still need its archive repaired on a retry.
    try {
      const offseason = 'format' in result && result.format === 'roto'
        ? await enterRedraftOffseason(input.seasonId, input.actorUserId, {finishOrder:result.finalStandings.map(r=>r.rosterId)})
        : await enterRedraftOffseason(input.seasonId, input.actorUserId)
      if (offseason.ok) {
        offseasonEntered = true
        offseasonSnapshotId = offseason.snapshotId
        archivedSeason = typeof offseason.season === 'number' ? offseason.season : null
      } else {
        console.error('[finalize-season] enterRedraftOffseason declined', {
          leagueId: input.leagueId,
          seasonId: input.seasonId,
          code: offseason.code,
        })
      }
    } catch (error) {
      console.error('[finalize-season] enterRedraftOffseason failed', {
        leagueId: input.leagueId,
        seasonId: input.seasonId,
        error,
      })
    }

    /*
     * Passed constitution amendments that take effect "next season" apply here, once, when the
     * season closes (lib/constitution/constitutionService.ts). Commissioner plan only; the call
     * never throws and a refused change is recorded on its amendment, so it cannot fail the close.
     */
    if (!alreadyFinalized) {
      const { applyAmendmentsAtSeasonRollover } = await import('@/lib/constitution/constitutionService')
      const amendments = await applyAmendmentsAtSeasonRollover(input.leagueId)
      if (amendments.applied > 0 || amendments.failed > 0) {
        console.info('[finalize-season] constitution amendments', { leagueId: input.leagueId, ...amendments })
      }
    }

    if (offseasonEntered && archivedSeason != null) {
      await runSeasonHistoryEngines(input.leagueId, archivedSeason, leagueScoring?.sport ?? null)
    }

    if (offseasonEntered && !alreadyFinalized) {
      // Commish reputation: ask the league to rate its commissioner. Keeper and dynasty leagues were
      // already asked from the keeper offseason; plain redraft leagues never were. Idempotent per
      // season, and not awaited — a chat post must not hold the finalize open.
      promptCommissionerRating(input.leagueId).catch((error) => {
        console.error('[finalize-season] commissioner rating prompt failed', { leagueId: input.leagueId, error })
      })
    }

    const leagueMeta = leagueScoring
    const keeperEligible =
      !!leagueMeta && (supportsKeeperDeclarations(leagueMeta.leagueType) || leagueMeta.isDynasty === true)

    if (keeperEligible && !alreadyFinalized) {
      keeperOffseasonTriggered = true
      /*
       * 🛑 THIS WAS NOT AWAITED, "SO IT WOULD NOT HOLD THE CALLER OPEN". It is the call that creates
       * next season's shell, its schedule and — for a dynasty league — every carried roster, and an
       * unawaited promise on a serverless request or a cron tick is simply dropped when the process
       * is done with the response. Nothing retried it: a re-finalize skips this block by design.
       * Awaited, with a failure still caught so the crowned champion is reported either way.
       */
      try {
        await triggerKeeperOffseason(input.leagueId, input.seasonId)
        keeperOffseasonCompleted = true
      } catch (error) {
        console.error('[finalize-season] triggerKeeperOffseason failed', {
          leagueId: input.leagueId,
          seasonId: input.seasonId,
          error,
        })
      }
    }
  }

  /*
   * A RE-FINALIZE REPAIRS A DYNASTY TRANSITION THAT DID NOT FINISH. The keeper offseason runs once,
   * on the first finalize; if it failed part-way, the next season or its rosters are missing and
   * nothing else would notice until a commissioner clicked something. The shell and carryover are
   * both idempotent, so re-running them here is safe however many times the cron retries.
   */
  if (alreadyFinalized && leagueScoring && isDynastyFamilyLeague(leagueScoring)) {
    try {
      await ensureDynastyNextSeason(input.leagueId, input.seasonId)
    } catch (error) {
      console.error('[finalize-season] dynasty next-season repair failed', {
        leagueId: input.leagueId,
        seasonId: input.seasonId,
        error,
      })
    }
  }

  return {
    ok: true,
    alreadyFinalized,
    championRosterId: result.championRosterId ?? null,
    runnerUpRosterId: result.runnerUpRosterId ?? null,
    offseasonEntered,
    offseasonSnapshotId,
    keeperOffseasonTriggered,
    keeperOffseasonCompleted,
    result,
  }
}

/** The route's own wording, kept so its HTTP responses do not change. */
function describe(code: string): string {
  if (code === 'NO_BRACKET') return 'No playoff bracket exists for this season'
  if (code === 'NO_WINNER') return 'Final matchup has no winner - run advance first'
  if (code === 'NO_FINAL_ROUND') return 'No playoff rounds found'
  if (code === 'LOWER_BRACKET_INCOMPLETE') return 'The consolation bracket or toilet bowl is not yet complete'
  return 'Final playoff round is not yet complete'
}

/**
 * Fills the record book and runs season awards from the `SeasonResult` rows the archive just wrote.
 *
 * BEST-EFFORT, and each engine on its own: both only read Postgres and rewrite their own rows
 * idempotently (record book upserts; awards replace the season's set), so a re-finalize repairs
 * a run that failed. A failure here must never fail the finalize — the champion and archive are
 * already committed — so it is logged and swallowed. Awaited rather than fired off, because an
 * unawaited promise on a cron tick or serverless request is dropped when the response is sent.
 */
async function runSeasonHistoryEngines(leagueId: string, seasonYear: number, sport: string | null): Promise<void> {
  const season = String(seasonYear)
  try {
    const { runRecordBookEngine } = await import('@/lib/record-book-engine/RecordBookEngine')
    await runRecordBookEngine(leagueId, [season], { sport })
  } catch (error) {
    console.warn('[finalize-season] record book engine failed', { leagueId, season, error })
  }
  try {
    const { runAwardsEngine } = await import('@/lib/awards-engine/AwardsEngine')
    await runAwardsEngine(leagueId, season, { sport })
  } catch (error) {
    console.warn('[finalize-season] awards engine failed', { leagueId, season, error })
  }
}

async function promptCommissionerRating(leagueId: string): Promise<void> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { season: true } })
  if (league?.season != null) await triggerCommissionerRatingPrompt(leagueId, league.season)
}
