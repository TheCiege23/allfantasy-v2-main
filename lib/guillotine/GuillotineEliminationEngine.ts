/**
 * Run elimination: determine lowest N, apply tiebreaker, mark chopped, trigger release and events.
 */

import { prisma } from '@/lib/prisma'
import { getGuillotineConfig } from './GuillotineLeagueConfig'
import { resolveTiebreak } from './GuillotineTiebreakResolver'
import { evaluateWeek, getDraftSlotByRoster } from './GuillotineWeekEvaluator'
import { releaseChoppedRosters } from './GuillotineRosterReleaseEngine'
import { appendEvent } from './GuillotineEventLog'
import { postChopToLeagueChat } from './guillotineChat'
import { resolveRedraftRosterId } from '@/lib/league-runtime/reconcileRosterRedraftLinks'
import type { GuillotineChopResult, PeriodScoreRow } from './types'

export interface RunEliminationInput {
  leagueId: string
  weekOrPeriod: number
  season?: number | null
  periodEndedAt?: Date
  /** Pre-computed period scores (optional). If not provided, evaluator reads from DB. */
  periodScores?: PeriodScoreRow[]
  /** Commissioner override: exact roster IDs to chop (audit logged). */
  commissionerChoppedRosterIds?: string[]
  /** Do not run roster release (e.g. run release in a separate job). */
  skipRosterRelease?: boolean
  /** Do not post to league chat. */
  skipChat?: boolean
  /** System user ID for league chat (required if !skipChat). */
  systemUserId?: string
}

/**
 * Run elimination for the given period: evaluate, tiebreak, mark chopped, release rosters, log and notify.
 */
/**
 * Set `RedraftRoster.isEliminated` for chopped rosters, resolving across the two roster id spaces.
 *
 * Returns what actually happened. `unresolved` is not an error state to swallow — it is the honest
 * report that a chopped team could not be matched to the roster row consumers read, so standings
 * will still show them alive. A caller that ignores it reproduces the bug this replaced.
 *
 * ⚠ PER-ROSTER, NOT ALL-OR-NOTHING, ON PURPOSE. A chop is usually one team, so refusing the whole
 * batch when one id fails to resolve would throw away a correct update to protect against a
 * "half-marked league" that a single-roster batch cannot produce anyway.
 */
export async function markRedraftRostersEliminated(
  leagueId: string,
  rosterIds: string[],
): Promise<{ marked: string[]; unresolved: string[] }> {
  const marked: string[] = []
  const unresolved: string[] = []
  if (rosterIds.length === 0) return { marked, unresolved }

  for (const rosterId of rosterIds) {
    /*
     * Resolved through `Roster.redraftRosterId`, the real column, rather than by re-deriving the
     * platform-user-id join here.
     *
     * That join was what this function shipped with, and it worked — but it re-computed a
     * correspondence the schema can now state, and every consumer that re-derives a rule owns a
     * copy of it. `resolveRedraftRosterId` also reconciles LAZILY when the column is null, so a
     * league whose link was never warmed still resolves the first time a chop needs it. Without
     * that, the one-time backfill decays: measured 2026-09-04, the newest 45 rosters in production
     * linked at 36% against 84% for the established population.
     */
    const redraftId = await resolveRedraftRosterId(leagueId, rosterId).catch(() => null)
    if (!redraftId) {
      unresolved.push(rosterId)
      continue
    }
    /*
     * No cast and no swallow. `isEliminated` is a real field on this model, so TypeScript checks
     * it — which is the property the old call gave up in order to compile. A genuine write failure
     * should surface rather than be hidden a second time.
     */
    await prisma.redraftRoster.update({ where: { id: redraftId }, data: { isEliminated: true } })
    marked.push(redraftId)
  }

  if (unresolved.length) {
    console.warn(
      '[guillotine] chopped rosters with no matching RedraftRoster — standings will still show them active',
      JSON.stringify({ leagueId, unresolved }),
    )
  }
  return { marked, unresolved }
}

export async function runElimination(input: RunEliminationInput): Promise<GuillotineChopResult | null> {
  const config = await getGuillotineConfig(input.leagueId)
  if (!config) return null

  const { eliminationStartWeek, eliminationEndWeek, teamsPerChop } = config
  if (input.weekOrPeriod < eliminationStartWeek) {
    return { leagueId: input.leagueId, weekOrPeriod: input.weekOrPeriod, choppedRosterIds: [], tiebreakStepUsed: null, reason: 'before elimination start' }
  }
  if (eliminationEndWeek != null && input.weekOrPeriod > eliminationEndWeek) {
    return { leagueId: input.leagueId, weekOrPeriod: input.weekOrPeriod, choppedRosterIds: [], tiebreakStepUsed: null, reason: 'past elimination end' }
  }

  const evalResult = await evaluateWeek({
    leagueId: input.leagueId,
    weekOrPeriod: input.weekOrPeriod,
    season: input.season,
    periodScores: input.periodScores,
    periodEndedAt: input.periodEndedAt,
  })
  if (!evalResult) return null
  if (!evalResult.pastCutoff) {
    return {
      leagueId: input.leagueId,
      weekOrPeriod: input.weekOrPeriod,
      choppedRosterIds: [],
      tiebreakStepUsed: null,
      reason: 'before stat correction cutoff',
    }
  }
  if (evalResult.scores.length === 0) {
    return { leagueId: input.leagueId, weekOrPeriod: input.weekOrPeriod, choppedRosterIds: [], tiebreakStepUsed: null, reason: 'no active scores' }
  }

  const minPoints = Math.min(...evalResult.scores.map((s) => s.periodPoints))
  const tiedCandidates = evalResult.scores.filter((s) => s.periodPoints === minPoints)
  const draftSlotByRoster = await getDraftSlotByRoster(input.leagueId)

  const { choppedRosterIds, stepUsed, reason } = resolveTiebreak({
    candidates: tiedCandidates,
    tiebreakerOrder: config.tiebreakerOrder,
    teamsPerChop,
    weekOrPeriod: input.weekOrPeriod,
    draftSlotByRoster,
    commissionerChoppedRosterIds: input.commissionerChoppedRosterIds?.length
      ? input.commissionerChoppedRosterIds
      : undefined,
  })

  if (choppedRosterIds.length === 0) {
    return {
      leagueId: input.leagueId,
      weekOrPeriod: input.weekOrPeriod,
      choppedRosterIds: [],
      tiebreakStepUsed: stepUsed,
      reason,
    }
  }

  const now = new Date()
  for (const rosterId of choppedRosterIds) {
    await prisma.guillotineRosterState.upsert({
      where: { rosterId },
      create: {
        leagueId: input.leagueId,
        rosterId,
        choppedAt: now,
        choppedInPeriod: input.weekOrPeriod,
        choppedReason: reason,
      },
      update: {
        choppedAt: now,
        choppedInPeriod: input.weekOrPeriod,
        choppedReason: reason,
      },
    })
  }

  /*
   * ── 🛑 MARKING THE TEAM ELIMINATED, WHICH THIS ENGINE HAS NEVER ACTUALLY DONE ───────────────
   *
   * The line that used to sit here was:
   *
   *     await (prisma.roster.update as (args: {...}) => Promise<unknown>)({
   *       where: { id: rosterId }, data: { isEliminated: true },
   *     }).catch(() => {})
   *
   * `Roster` HAS NO `isEliminated` FIELD — verified against the generated client, not inferred.
   * The `as` cast is what let it compile: it replaced Prisma's typed argument with
   * `Record<string, unknown>`, so TypeScript could no longer object. At runtime Prisma rejects the
   * unknown argument, and `.catch(() => {})` swallowed that. The comment above it said the write
   * existed "so standings, scheduling, and endgame engine filters pick it up". It never once did.
   *
   * The field lives on `RedraftRoster`, which is also what consumers read — `leagueStandingsGrounding`
   * selects `isEliminated` from there and renders "ELIMINATED" into Chimmy's context.
   *
   * ⚠ AND THE TWO MODELS DO NOT SHARE AN ID SPACE, WHICH IS WHY THIS IS A RESOLUTION AND NOT A
   * RENAME. This engine works in `Roster` (uuid ids, `platformUserId`); the flag lives on
   * `RedraftRoster` (cuid ids, `ownerId`). Measured across the 12 production guillotine leagues on
   * 2026-09-04, the only semantic link is the platform user id, and it is not total:
   *
   *     rosters.platformUserId   202 sleeper-numeric · 23 app uuid · 6 neither   (231 rows)
   *     resolves to a redraft roster                 ~83-87%
   *
   * So a chop can be unresolvable, and that case is REPORTED rather than swallowed. A silent skip
   * here is what produced a standings table that quietly disagreed with the chop log.
   */
  const flagged = await markRedraftRostersEliminated(input.leagueId, choppedRosterIds)

  for (const rosterId of choppedRosterIds) {
    /*
     * Unclaim the visual/team ownership row so eliminated users no longer appear as active owners.
     *
     * ⚠ THIS MATCHED NOTHING EITHER, AND STILL MIGHT. `LeagueTeam.externalId` holds the platform's
     * SLOT NUMBER — the real values in these leagues are "1", "10", "11" — while `rosterId` is a
     * uuid, so the filter compared a uuid against a slot label and updated 0 rows across all 12
     * leagues. `updateMany` does not throw on no-match, so the old `.catch(() => {})` was not even
     * the thing hiding it; nothing was ever going to be raised.
     *
     * The key is NOT corrected here because nothing in this engine holds a trustworthy slot for a
     * roster — `getDraftSlotByRoster` returns a DRAFT slot, which is a different number and would
     * be a guess. The count is captured instead, so a no-match is visible in the result and in the
     * log rather than being indistinguishable from success.
     */
    const unclaimed = await prisma.leagueTeam
      .updateMany({
        where: { leagueId: input.leagueId, externalId: rosterId },
        data: { claimedByUserId: null, platformUserId: null, isOrphan: true },
      })
      .catch(() => ({ count: 0 }))
    if (unclaimed.count === 0) {
      console.warn(
        '[guillotine] leagueTeam unclaim matched no row',
        JSON.stringify({ leagueId: input.leagueId, rosterId, reason: 'externalId is a slot number, not a roster id' }),
      )
    }
  }

  await appendEvent(input.leagueId, 'chop', {
    weekOrPeriod: input.weekOrPeriod,
    choppedRosterIds,
    tiebreakStepUsed: stepUsed,
    reason,
    commissionerOverride: Boolean(input.commissionerChoppedRosterIds?.length),
  })

  if (!input.skipRosterRelease) {
    await releaseChoppedRosters({
      leagueId: input.leagueId,
      rosterIds: choppedRosterIds,
      releaseTiming: config.rosterReleaseTiming,
    })
  }

  if (!input.skipChat && input.systemUserId) {
    await postChopToLeagueChat({
      leagueId: input.leagueId,
      weekOrPeriod: input.weekOrPeriod,
      choppedRosterIds,
      displayNames: await getDisplayNamesForRosters(input.leagueId, choppedRosterIds),
      userId: input.systemUserId,
    })
  }

  await appendEvent(input.leagueId, 'chop_animation_trigger', {
    weekOrPeriod: input.weekOrPeriod,
    choppedRosterIds,
  })

  return {
    leagueId: input.leagueId,
    weekOrPeriod: input.weekOrPeriod,
    choppedRosterIds,
    tiebreakStepUsed: stepUsed,
    reason,
    eliminationFlagged: flagged,
  }
}

async function getDisplayNamesForRosters(leagueId: string, rosterIds: string[]): Promise<Record<string, string>> {
  const rosters = await prisma.roster.findMany({
    where: { leagueId, id: { in: rosterIds } },
    select: { id: true, platformUserId: true },
  })
  const userIds = [...new Set(rosters.map((r) => r.platformUserId).filter(Boolean))]
  const users = await prisma.appUser.findMany({
    where: { id: { in: userIds } },
    select: { id: true, displayName: true, email: true },
  })
  const byUserId = Object.fromEntries(users.map((u) => [u.id, u.displayName || u.email || u.id]))
  const result: Record<string, string> = {}
  for (const r of rosters) {
    result[r.id] = byUserId[r.platformUserId] ?? r.platformUserId ?? r.id
  }
  return result
}
