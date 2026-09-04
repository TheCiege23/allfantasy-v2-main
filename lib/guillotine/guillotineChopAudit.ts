import 'server-only'

import { prisma } from '@/lib/prisma'
import { transitionToFinalStage } from './endgameEngine'

/**
 * The audit half of a guillotine chop: the elimination record, the survival log, and the season
 * counters.
 *
 * ── 🛑 WHY THIS IS A MODULE AND NOT A SECOND ENGINE ────────────────────────────────────────
 * There were two guillotine elimination engines and neither was a superset of the other.
 * `GuillotineEliminationEngine` (the one specialty automation calls) had the week evaluator, the
 * stat-correction cutoff, the tiebreak resolver with commissioner override, roster release, chat and
 * the event log. `eliminationEngine` (reachable only from a manual POST) had the idempotency guard,
 * a transaction, the `GuillotineElimination` audit, the survival log, the season counters and the
 * endgame transition. Seven capabilities each, almost perfectly complementary — so deleting either
 * destroyed real behaviour, and that is why they had both survived.
 *
 * Unifying them meant lifting the second engine's capabilities into something the first can call.
 * This is that. The automation engine stays the single entry point; this supplies the half it lacked.
 *
 * ── ⚠ OPTIONAL WHEN THERE IS NO SEASON ROW, WHICH IS THE COMMON CASE ───────────────────────
 * Every function here keys off a `GuillotineSeason`, and production holds ZERO of them: only a
 * manual `POST /api/guillotine/season` creates one, and nobody has called it for the 12 live
 * guillotine leagues. So this reports `recorded: false, reason: 'no_guillotine_season'` and the chop
 * proceeds without it.
 *
 * It does NOT create the row as a side effect of a chop. Guap's decision, and the right one: a chop
 * that silently materialises season state is hard to reason about afterwards, and "the audit did not
 * run because there is no season" is a fact worth surfacing rather than papering over.
 *
 * ── THE ID SPACE IS REDRAFT, NOT `Roster` ──────────────────────────────────────────────────
 * `GuillotineSurvivalLog.rosterId` is a foreign key to `RedraftRoster`, and the manual engine wrote
 * `GuillotineElimination.eliminatedRosterId` from the same space. The automation engine works in
 * `Roster`. Callers must translate through `Roster.redraftRosterId` BEFORE calling here — this
 * module takes redraft ids only, and says so in every field name, because a silent mix of the two
 * spaces is the defect this whole line of work exists to end.
 */

export interface ChoppedTeam {
  /** A `RedraftRoster.id`. Never a `Roster.id`. */
  redraftRosterId: string
  teamName: string
  ownerId: string
  score: number
  rankAmongActive: number
  marginBelowSafe: number
}

export interface StandingRow {
  /** A `RedraftRoster.id`. Never a `Roster.id`. */
  redraftRosterId: string
  score: number
  rankAmongActive: number
  eliminated: boolean
  marginAboveChopLine: number
  wasInDangerZone: boolean
}

export interface ChopAuditInput {
  leagueId: string
  season?: number | null
  scoringPeriod: number
  chopped: ChoppedTeam[]
  standings: StandingRow[]
  teamsActiveThisPeriod: number
  /** Whether the tiebreak resolver actually broke a tie to pick these teams. */
  wasTiebreaker: boolean
}

export type ChopAuditResult =
  | { recorded: true; seasonId: string; eliminations: number; survivalRows: number; finalStageReached: boolean }
  | { recorded: false; reason: 'no_guillotine_season' | 'already_recorded' }

/**
 * The league's `GuillotineSeason`, or null.
 *
 * ⚠ Season-scoped when a season is supplied, because a league accumulates one row per year and
 * auditing a 2026 chop against the 2025 row would be worse than not auditing it.
 */
export async function findGuillotineSeasonId(
  leagueId: string,
  season?: number | null,
): Promise<string | null> {
  const row = await prisma.guillotineSeason.findFirst({
    where: { leagueId, ...(season != null ? { season } : {}) },
    orderBy: { season: 'desc' },
    select: { id: true },
  })
  return row?.id ?? null
}

/**
 * Has this period already been audited?
 *
 * 🛑 THIS IS THE CAPABILITY THE AUTOMATION ENGINE NEVER HAD. It would happily chop the same week
 * twice if re-triggered — `guillotineRosterState` is an upsert so the state looked unchanged, but a
 * second `GuillotineElimination` row would have been written for the same period with nothing
 * preventing it. `GuillotineElimination` carries indexes but NO unique constraint, so the database
 * will not catch a duplicate; this check is the only thing that does.
 */
export async function isPeriodAlreadyRecorded(
  seasonId: string,
  scoringPeriod: number,
): Promise<boolean> {
  const existing = await prisma.guillotineElimination.findFirst({
    where: { seasonId, scoringPeriod },
    select: { id: true },
  })
  return existing != null
}

/**
 * Write the audit for one period. Transactional: the elimination rows, the survival log and the
 * season counters land together or not at all.
 *
 * Returns `recorded: false` rather than throwing when there is no season row or the period was
 * already audited — both are ordinary states, and a chop must not fail because its bookkeeping
 * cannot run.
 */
export async function recordChopAudit(input: ChopAuditInput): Promise<ChopAuditResult> {
  const seasonId = await findGuillotineSeasonId(input.leagueId, input.season)
  if (!seasonId) return { recorded: false, reason: 'no_guillotine_season' }

  if (await isPeriodAlreadyRecorded(seasonId, input.scoringPeriod)) {
    return { recorded: false, reason: 'already_recorded' }
  }

  await prisma.$transaction(async (tx) => {
    for (const c of input.chopped) {
      await tx.guillotineElimination.create({
        data: {
          seasonId,
          leagueId: input.leagueId,
          eliminatedRosterId: c.redraftRosterId,
          eliminatedTeamName: c.teamName,
          eliminatedOwnerId: c.ownerId,
          scoringPeriod: input.scoringPeriod,
          finalScore: c.score,
          rankAmongActive: c.rankAmongActive,
          marginBelowSafe: c.marginBelowSafe,
          /*
           * ⚠ REAL, WHERE THE OLD ENGINE HARDCODED `false`. `eliminationEngine` always wrote false
           * because its own tiebreak was inline and it never reported which step decided. The
           * automation engine runs `resolveTiebreak`, which does — so the audit can finally record
           * whether a tie was broken, which is exactly the thing a manager disputes.
           */
          wasTiebreaker: input.wasTiebreaker,
        },
      })
    }

    for (const s of input.standings) {
      await tx.guillotineSurvivalLog.upsert({
        where: {
          seasonId_rosterId_scoringPeriod: {
            seasonId,
            rosterId: s.redraftRosterId,
            scoringPeriod: input.scoringPeriod,
          },
        },
        create: {
          seasonId,
          leagueId: input.leagueId,
          rosterId: s.redraftRosterId,
          scoringPeriod: input.scoringPeriod,
          totalScore: s.score,
          rankAmongActive: s.rankAmongActive,
          teamsActiveThisPeriod: input.teamsActiveThisPeriod,
          survivalStatus: s.eliminated ? 'eliminated' : 'survived',
          marginAboveChopLine: s.marginAboveChopLine,
          wasInDangerZone: s.wasInDangerZone,
        },
        update: {
          totalScore: s.score,
          rankAmongActive: s.rankAmongActive,
          teamsActiveThisPeriod: input.teamsActiveThisPeriod,
          survivalStatus: s.eliminated ? 'eliminated' : 'survived',
          marginAboveChopLine: s.marginAboveChopLine,
          wasInDangerZone: s.wasInDangerZone,
        },
      })
    }

    /*
     * `currentTeamsActive` is DECREMENTED rather than assigned from the caller's count.
     *
     * The caller knows how many teams it scored this period, which is not the same number: a team
     * with no score row is absent from the standings but is still active. Decrementing by the chop
     * count keeps the counter tied to the only event that actually changes it, and cannot drift
     * because a scoring source was incomplete for one week.
     */
    await tx.guillotineSeason.update({
      where: { id: seasonId },
      data: {
        currentScoringPeriod: input.scoringPeriod,
        ...(input.chopped.length
          ? { currentTeamsActive: { decrement: input.chopped.length } }
          : {}),
      },
    })
  })

  /*
   * ── THE FINAL-STAGE TRANSITION, PORTED FROM THE ENGINE BEING DELETED ───────────────────────
   *
   * `eliminationEngine.ts` ended by re-reading the season and, when the surviving field had fallen
   * to the league's endgame threshold, calling `transitionToFinalStage`. That call was its ONLY
   * caller — deleting the engine without porting this would have left `transitionToFinalStage` with
   * zero callers and no guillotine league would ever have entered its final stage again. Nothing
   * would have failed; the season would simply never end.
   *
   * It belongs here because this module already owns `currentTeamsActive` — the number the
   * threshold is compared against — so the check reads the value it just wrote rather than racing a
   * separate reader.
   *
   * ⚠ AFTER the transaction, deliberately. The transition is a separate state change with its own
   * meaning, and folding it in would make a threshold read inside the same transaction that wrote
   * the counter it depends on.
   */
  const league = await prisma.league
    .findUnique({ where: { id: input.leagueId }, select: { guillotineEndgameThreshold: true } })
    .catch(() => null)
  const after = await prisma.guillotineSeason
    .findUnique({ where: { id: seasonId }, select: { currentTeamsActive: true, isInFinalStage: true } })
    .catch(() => null)

  let finalStageReached = false
  if (after && !after.isInFinalStage && after.currentTeamsActive <= (league?.guillotineEndgameThreshold ?? 1)) {
    await transitionToFinalStage(seasonId, input.scoringPeriod)
    finalStageReached = true
  }

  return {
    recorded: true,
    seasonId,
    eliminations: input.chopped.length,
    survivalRows: input.standings.length,
    finalStageReached,
  }
}
