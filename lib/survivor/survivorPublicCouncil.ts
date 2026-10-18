/** Council output is an allowlist: closed/tallied never means publicly revealed. */
export function survivorPublicCouncil<T extends object>(council: T | null, _canSeePrivate: boolean): T | null {
  if (!council) return council
  const row = council as Record<string, unknown>
  const publicRow: Record<string, unknown> = {}
  for (const key of ['id', 'leagueId', 'week', 'phase', 'attendingTribeId', 'voteDeadlineAt', 'votingDeadline', 'votingOpensAt', 'closedAt', 'isRevealed']) {
    if (key in row) publicRow[key] = row[key]
  }
  const revealed = row.isRevealed === true
  publicRow.status = !revealed && row.status === 'tie_pending' ? 'closed' : row.status
  publicRow.votes = []
  publicRow.revealSequence = revealed ? row.revealSequence ?? null : null
  publicRow.revealStartsAt = revealed ? row.revealStartsAt ?? null : null
  publicRow.eliminatedRosterId = revealed ? row.eliminatedRosterId ?? null : null
  publicRow.eliminatedUserId = revealed ? row.eliminatedUserId ?? null : null
  publicRow.eliminatedName = revealed ? row.eliminatedName ?? null : null
  publicRow.isTie = revealed ? row.isTie === true : false
  return publicRow as T
}
