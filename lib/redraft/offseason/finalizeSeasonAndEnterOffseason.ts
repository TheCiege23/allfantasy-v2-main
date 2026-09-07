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
 *   3. open the keeper offseason   — keeper/dynasty leagues only
 *
 * ⚠ STEPS 2 AND 3 RUN ONLY ON A FIRST FINALIZE. Re-finalizing is safe and
 * common (the cron may retry), but re-archiving is not — and `enterRedraftOffseason`
 * short-circuits an already-offseason league before its transaction, so a second
 * pass would silently write nothing while reporting success.
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

export type FinalizeSeasonResult =
  | {
      ok: true
      alreadyFinalized: boolean
      championRosterId: string | null
      runnerUpRosterId: string | null
      offseasonEntered: boolean
      offseasonSnapshotId: string | null
      keeperOffseasonTriggered: boolean
      /** The runtime state and events, for callers that render them. */
      result: Awaited<ReturnType<typeof finalizeNflRedraftPlayoffRuntimeSeason>>
    }
  | {
      ok: false
      code: string
      message: string
      result: Awaited<ReturnType<typeof finalizeNflRedraftPlayoffRuntimeSeason>>
    }

export async function finalizeSeasonAndEnterOffseason(input: {
  seasonId: string
  leagueId: string
  actorUserId: string
}): Promise<FinalizeSeasonResult> {
  const result = await finalizeNflRedraftPlayoffRuntimeSeason({
    seasonId: input.seasonId,
    actorUserId: input.actorUserId,
  })

  if (!result.ok) {
    return { ok: false, code: result.code, message: describe(result.code), result }
  }

  const alreadyFinalized = 'alreadyFinalized' in result && result.alreadyFinalized === true

  let offseasonEntered = false
  let offseasonSnapshotId: string | null = null
  let keeperOffseasonTriggered = false

  if (!alreadyFinalized) {
    try {
      const offseason = await enterRedraftOffseason(input.seasonId, input.actorUserId)
      if (offseason.ok) {
        offseasonEntered = true
        offseasonSnapshotId = offseason.snapshotId
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

    const leagueMeta = await prisma.league.findUnique({
      where: { id: input.leagueId },
      select: { leagueType: true, isDynasty: true },
    })
    const keeperEligible =
      !!leagueMeta && (supportsKeeperDeclarations(leagueMeta.leagueType) || leagueMeta.isDynasty === true)

    if (keeperEligible) {
      keeperOffseasonTriggered = true
      // ⚠ NOT AWAITED, MATCHING THE ROUTE. This opens a keeper window and can
      // create next season's shell plus a full generated schedule — real work
      // that must not hold the caller open. Its own failures are logged inside.
      triggerKeeperOffseason(input.leagueId, input.seasonId).catch((error) => {
        console.error('[finalize-season] triggerKeeperOffseason failed', {
          leagueId: input.leagueId,
          seasonId: input.seasonId,
          error,
        })
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
    result,
  }
}

/** The route's own wording, kept so its HTTP responses do not change. */
function describe(code: string): string {
  if (code === 'NO_BRACKET') return 'No playoff bracket exists for this season'
  if (code === 'NO_WINNER') return 'Final matchup has no winner - run advance first'
  if (code === 'NO_FINAL_ROUND') return 'No playoff rounds found'
  return 'Final playoff round is not yet complete'
}
