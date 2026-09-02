import { prisma } from '@/lib/prisma'

/**
 * Which roster size a round is played under.
 *
 * ⚠ EXPORTED SO A COMPLIANCE CHECK CANNOT INVENT A SECOND COPY OF THIS. The
 * order matters — an explicit `rosterSizeOverride` beats the round type, which
 * beats the opening size — and a checker that re-derived it slightly differently
 * would report violations against a limit the tournament is not actually
 * enforcing. One resolver, used by the thing that applies it and the thing that
 * audits it.
 */
export function resolveRoundRosterSize(
  shell: {
    openingRosterSize: number
    tournamentRosterSize: number
    eliteRosterSize: number
  },
  round: { roundNumber: number; roundType: string; rosterSizeOverride: number | null },
): number {
  let size = shell.tournamentRosterSize
  if (round.roundNumber === 1) size = shell.openingRosterSize
  if (round.roundType === 'elite' || round.roundType === 'final') size = shell.eliteRosterSize
  if (round.rosterSizeOverride != null) size = round.rosterSizeOverride
  return size
}

export async function applyRoundRosterRules(tournamentId: string, roundNumber: number): Promise<void> {
  const shell = await prisma.tournamentShell.findUnique({ where: { id: tournamentId } })
  if (!shell) throw new Error('Tournament not found')

  const round = await prisma.tournamentRound.findFirst({ where: { tournamentId, roundNumber } })
  if (!round) throw new Error('Round not found')

  const size = resolveRoundRosterSize(shell, round)

  const leagues = await prisma.tournamentLeague.findMany({
    where: { tournamentId, roundId: round.id },
  })
  for (const tl of leagues) {
    if (!tl.leagueId) continue
    await prisma.league.update({
      where: { id: tl.leagueId },
      data: { rosterSize: size },
    })
  }

  if (shell.faabResetOnRedraft) {
    const tlIds = leagues.map((l) => l.id)
    await prisma.tournamentLeagueParticipant.updateMany({
      where: { tournamentLeagueId: { in: tlIds } },
      data: { faabBalance: 100 },
    })
  }
}
