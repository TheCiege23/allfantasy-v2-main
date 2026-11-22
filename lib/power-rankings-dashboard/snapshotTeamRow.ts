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

