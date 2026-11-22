import { prisma } from '@/lib/prisma'

/**
 * Whether a tournament round is finished enough to cut.
 *
 * The cut used to run whenever the commissioner pressed the button: before a single week had been
 * played, and even while a league in the round was still drafting (walked 2026-11-22). It ranks
 * managers on whatever results exist, so an early press decided the round on nothing.
 *
 *  - A draft still running in the round is a hard stop. There is no "anyway": the cut would move
 *    managers out of a league whose rosters are half built.
 *  - Weeks still to play is a warning the commissioner may confirm past, because a commissioner can
 *    have a real reason to end a round early.
 */
export type AdvanceReadiness = {
  ready: boolean
  /** Hard stops. Not overridable. */
  blockers: string[]
  /** The commissioner may confirm past these. */
  warnings: string[]
}

export function summarizeAdvanceReadiness(input: {
  draftsRunning: number
  startWeek: number | null
  endWeek: number | null
  lastScoredWeek: number | null
}): AdvanceReadiness {
  const blockers: string[] = []
  const warnings: string[] = []
  if (input.draftsRunning > 0) {
    blockers.push(
      input.draftsRunning === 1
        ? 'One league in this round is still drafting. Wait for its draft to finish.'
        : `${input.draftsRunning} leagues in this round are still drafting. Wait for their drafts to finish.`,
    )
  }
  const end = Number(input.endWeek)
  if (Number.isInteger(end) && end > 0) {
    const last = input.lastScoredWeek ?? 0
    if (last <= 0) warnings.push(`No week of this round has been scored yet. It runs through week ${end}.`)
    else if (last < end) warnings.push(`This round runs through week ${end}, and results are in through week ${last}.`)
  }
  return { ready: blockers.length === 0 && warnings.length === 0, blockers, warnings }
}

export async function getAdvanceReadiness(tournamentId: string, roundIndex: number): Promise<AdvanceReadiness> {
  const [round, leagues] = await Promise.all([
    prisma.legacyTournamentRound.findUnique({
      where: { tournamentId_roundIndex: { tournamentId, roundIndex } },
      select: { startWeek: true, endWeek: true },
    }),
    prisma.legacyTournamentLeague.findMany({ where: { tournamentId, roundIndex }, select: { leagueId: true } }),
  ])
  const leagueIds = leagues.map((l) => l.leagueId)
  if (leagueIds.length === 0) return summarizeAdvanceReadiness({ draftsRunning: 0, startWeek: null, endWeek: null, lastScoredWeek: null })
  const [draftsRunning, lastWeek] = await Promise.all([
    prisma.draftSession.count({ where: { leagueId: { in: leagueIds }, status: 'in_progress' } }),
    prisma.matchupFact.aggregate({ where: { leagueId: { in: leagueIds } }, _max: { weekOrPeriod: true } }),
  ])
  return summarizeAdvanceReadiness({
    draftsRunning,
    startWeek: round?.startWeek ?? null,
    endWeek: round?.endWeek ?? null,
    lastScoredWeek: lastWeek._max.weekOrPeriod ?? null,
  })
}
