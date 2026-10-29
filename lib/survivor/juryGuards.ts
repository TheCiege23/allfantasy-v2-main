/**
 * Jurors are out of the game: they cannot play idols and cannot receive (or cast) council votes.
 * They can still chat. Pure helpers, used by idolEngine.playIdol and SurvivorCouncilEligibility.
 */

const PLAYING_STATES = new Set(['active', 'immune'])

export function survivorIdolPlayBlockReason(player: { playerState?: string | null; isJuryMember?: boolean | null } | null | undefined): string | null {
  if (!player) return 'You are not in this Survivor season.'
  if (player.isJuryMember || player.playerState === 'jury') return 'Jurors cannot play idols.'
  if (!PLAYING_STATES.has(player.playerState ?? '')) return 'Only managers still in the game can play idols.'
  return null
}

export function excludeJuryRosterIds(rosterIds: ReadonlyArray<string>, juryRosterIds: ReadonlyArray<string>): string[] {
  const jury = new Set(juryRosterIds)
  return rosterIds.filter((id) => !jury.has(id))
}
