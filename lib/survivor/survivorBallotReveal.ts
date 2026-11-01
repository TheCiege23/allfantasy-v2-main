/**
 * End-of-season ballot reveal (original league, gap report §4 #45: "You will not know how people
 * vote… until after the game ends"). Opt-in (`endOfSeasonBallotReveal`, default off). Pure.
 *
 * The one rule that matters: NOTHING here is released before the season is complete — a champion
 * crowned by the jury. Until then `buildBallotReveal` returns null whatever the setting says, so a
 * caller cannot leak a live ballot by passing the wrong flag. Cancelled councils are left out.
 */

export interface BallotRevealCouncilInput {
  id: string
  week: number
  councilNumber: number
  phase: string
  status: string
  isRevealed: boolean
  eliminatedUserId: string | null
}

export interface BallotRevealVoteInput {
  councilId: string
  voterUserId: string | null
  voterName: string | null
  targetUserId: string | null
  targetName: string | null
  doesNotCount: boolean
  isLateVote: boolean
}

export interface BallotRevealCouncil {
  councilId: string
  week: number
  councilNumber: number
  phase: string
  eliminatedName: string | null
  ballots: Array<{ voterName: string; targetName: string; counted: boolean; late: boolean }>
}

export function ballotRevealAvailable(input: { enabled: boolean; seasonComplete: boolean }): boolean {
  return input.enabled && input.seasonComplete
}

export function buildBallotReveal(
  input: { enabled: boolean; seasonComplete: boolean },
  councils: ReadonlyArray<BallotRevealCouncilInput>,
  votes: ReadonlyArray<BallotRevealVoteInput>,
  nameByUser: ReadonlyMap<string, string>,
): BallotRevealCouncil[] | null {
  if (!ballotRevealAvailable(input)) return null
  const name = (userId: string | null, fallback: string | null) => (userId && nameByUser.get(userId)) || fallback || 'Manager'
  return [...councils]
    .filter((c) => c.isRevealed && c.status !== 'cancelled')
    .sort((a, b) => a.week - b.week || a.councilNumber - b.councilNumber)
    .map((c) => ({
      councilId: c.id,
      week: c.week,
      councilNumber: c.councilNumber,
      phase: c.phase,
      eliminatedName: c.eliminatedUserId ? name(c.eliminatedUserId, null) : null,
      ballots: votes
        .filter((v) => v.councilId === c.id)
        .map((v) => ({ voterName: name(v.voterUserId, v.voterName), targetName: name(v.targetUserId, v.targetName), counted: !v.doesNotCount, late: v.isLateVote }))
        .sort((a, b) => a.voterName.localeCompare(b.voterName)),
    }))
}
