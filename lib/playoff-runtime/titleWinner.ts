/**
 * The team that won the title game, as soon as that game has a winner — or null while it has none.
 *
 * `bracket.championRosterId` is only set once the SEASON is finalized, which also archives it and opens
 * the offseason. A title game is decided before that: when its round is advanced, or when the
 * commissioner names its winner. This reads the game itself, so the champion can be recorded and shown
 * then, without calling the season complete.
 */
export function decidedTitleWinnerRosterId(bracket: {
  rounds: ReadonlyArray<{ matchups: ReadonlyArray<{ winnerRosterId: string | null; nextMatchupId?: string | null; status?: string | null }> }>
}): string | null {
  const finalRound = bracket.rounds[bracket.rounds.length - 1]
  if (!finalRound) return null
  // The title game leads nowhere. A final round holding more than one such game is not one we can name.
  const finals = finalRound.matchups.filter((m) => !m.nextMatchupId && m.status !== 'bye')
  if (finals.length !== 1) return null
  return finals[0].winnerRosterId || null
}
