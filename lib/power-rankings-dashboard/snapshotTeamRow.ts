/** Shape stored in `LeaguePowerRankingSnapshot.teams` JSON */
export type SnapshotTeamRow = {
  rank: number
  teamName: string
  externalId: string | null
  powerScore: number
  rankDelta: number | null
  prevRank: number | null
  momentumLabel?: string
  /** @deprecated prefer tierLabel */
  tier?: string
  tierLabel?: string
  rankThird?: string
  pointsFor?: number
  pointsAgainst?: number
  record?: { wins: number; losses: number; ties: number }
  isCurrentUser?: boolean
}

export function parseMyRankFromSnapshotTeams(teams: unknown): number | null {
  if (!Array.isArray(teams)) return null
  for (const row of teams) {
    if (!row || typeof row !== 'object') continue
    const r = row as SnapshotTeamRow
    if (r.isCurrentUser === true && typeof r.rank === 'number') return r.rank
  }
  return null
}

export function parseRankForTeamExternalId(teams: unknown, externalId: string | null): number | null {
  if (!externalId || !String(externalId).trim()) return null
  const want = String(externalId).trim()
  if (!Array.isArray(teams)) return null
  for (const row of teams) {
    if (!row || typeof row !== 'object') continue
    const r = row as SnapshotTeamRow
    if (r.externalId != null && String(r.externalId).trim() === want && typeof r.rank === 'number') {
      return r.rank
    }
  }
  return null
}

