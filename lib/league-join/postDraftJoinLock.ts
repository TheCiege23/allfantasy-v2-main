import { isBestBallLeague } from '@/lib/autocoach/bestBallShared'

/**
 * Which leagues stop taking NEW teams once their draft has started. Pure and client-safe.
 *
 * In these formats a team only exists because the draft made it:
 *
 *   - Survivor (and Survivor Guillotine): tribes and the cast are fixed at the draft.
 *   - Best Ball, Classic or tournament: there are no waivers or lineups to build a team from
 *     later, and a tournament's contest entries are written when the draft runs. A manager let in
 *     afterwards gets an empty roster and no entry.
 *   - Guillotine ("Guilly"): the seat count is sized to the season's chop schedule before the
 *     draft (lib/guillotine/lateStartSeats.ts), and a team added afterwards is an empty roster
 *     the first chop removes.
 *
 * ⚠ THIS LOCKS A NEW TEAM, NOT A NEW MANAGER. Taking over a team that already exists (an orphan,
 * or an imported placeholder) is how an abandoned team gets a manager back, and it stays open —
 * the join route checks the lock only on the branch that would create a fresh roster.
 */

export type JoinLockLeague = {
  leagueVariant?: string | null
  leagueType?: string | null
  bestBallMode?: boolean | null
  guillotineMode?: boolean | null
}

export type PostDraftJoinLockKind = 'survivor' | 'best_ball' | 'guillotine'

/** Has this league's current draft session left `pre_draft`? No session means it has not. */
export function draftHasStarted(status: string | null | undefined): boolean {
  return Boolean(status) && status !== 'pre_draft'
}

function norm(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase()
}

/** The format whose teams are fixed at the draft, or null when late joins are fine. */
export function postDraftJoinLockKind(league: JoinLockLeague): PostDraftJoinLockKind | null {
  const variant = norm(league.leagueVariant)
  const type = norm(league.leagueType)
  if (variant === 'survivor' || variant === 'survivor_guillotine') return 'survivor'
  if (
    league.guillotineMode === true ||
    variant === 'guillotine' ||
    type === 'guillotine'
  ) {
    return 'guillotine'
  }
  if (isBestBallLeague(league.leagueVariant ?? null, league.bestBallMode ?? null) || type === 'best_ball' || type === 'bestball') {
    return 'best_ball'
  }
  return null
}

export const POST_DRAFT_JOIN_LOCK_MESSAGE: Record<PostDraftJoinLockKind, string> = {
  survivor: 'Survivor leagues lock new joins after the draft starts.',
  best_ball:
    'This Best Ball league has already drafted, so there is no team left to join. Teams are set at the draft — look for a league that has not drafted yet.',
  guillotine:
    'This Guillotine league has already drafted, so there is no team left to join. Seats are set at the draft — look for a league that has not drafted yet.',
}
