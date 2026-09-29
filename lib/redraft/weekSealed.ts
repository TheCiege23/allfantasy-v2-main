/**
 * Whether a redraft week is SEALED: it has at least one matchup, and every real (non-bye) matchup in
 * it is `final`.
 *
 * One definition for both readers, so they cannot drift:
 *   - `finalizeRedraftWeek` short-circuits a sealed week instead of sealing it again;
 *   - score-sync does not run its routine reconcile against a sealed week.
 *
 * ⚠ A BYE NEVER GOES FINAL. It has no opponent, so `updateMatchupScores` returns before writing it and
 * its status stays 'scheduled' for good. Only an explicit null `awayRosterId` is a bye: anything else
 * counts as a real matchup, because misreading a real matchup as a bye would skip a week that is not
 * done, while misreading a bye only costs a redundant pass.
 */
export type SealableMatchup = { status: string | null; awayRosterId?: string | null }

export function isSealedWeek(matchups: readonly SealableMatchup[]): boolean {
  if (matchups.length === 0) return false
  return matchups.filter((m) => m.awayRosterId !== null).every((m) => m.status === 'final')
}

type MatchupReader = {
  redraftMatchup: {
    findMany: (args: {
      where: { seasonId: string; week: number }
      select: { status: true; awayRosterId: true }
    }) => Promise<SealableMatchup[]>
  }
}

export async function isRedraftWeekSealed(prisma: MatchupReader, seasonId: string, week: number): Promise<boolean> {
  const matchups = await prisma.redraftMatchup.findMany({
    where: { seasonId, week },
    select: { status: true, awayRosterId: true },
  })
  return isSealedWeek(matchups)
}
