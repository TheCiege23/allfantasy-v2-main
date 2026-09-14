export type LiveMatchupRow = {
  roster_id: number
  matchup_id: number | null
  points: number
  custom_points?: number | null
}

export function parseLiveMatchups(value: unknown): LiveMatchupRow[] | null {
  if (!Array.isArray(value) || !value.length) return null
  const ids = new Set<number>()
  for (const row of value) {
    if (!row || !Number.isInteger(row.roster_id) || row.roster_id < 1 || ids.has(row.roster_id) ||
      (row.matchup_id != null && !Number.isInteger(row.matchup_id)) ||
      typeof row.points !== 'number' || !Number.isFinite(row.points) ||
      (row.custom_points != null && (typeof row.custom_points !== 'number' || !Number.isFinite(row.custom_points)))) return null
    ids.add(row.roster_id)
  }
  return value
}

export function livePoints(row: LiveMatchupRow): number {
  return row.custom_points ?? row.points
}

export function summarizeLiveScores(rows: LiveMatchupRow[], rosterId: string) {
  const mine = rows.find(row => String(row.roster_id) === rosterId)
  if (!mine) return null
  const opponents = mine.matchup_id == null ? [] : rows.filter(row => row.roster_id !== mine.roster_id && row.matchup_id === mine.matchup_id)
  const opponent = opponents.length === 1 ? opponents[0] : null
  const score = livePoints(mine)
  const lowest = Math.min(...rows.map(livePoints))
  // Competition ranks preserve ties, including zero and negative score corrections.
  const fieldStanding = rows.length < 2 ? null : {
    rank: 1 + rows.filter(row => livePoints(row) > score).length,
    outOf: rows.length,
    placesAboveCut: rows.filter(row => livePoints(row) < score).length,
    cutLine: lowest,
    overCut: score === lowest ? null : Math.round((score - lowest) * 100) / 100,
    tied: rows.filter(row => livePoints(row) === score).length > 1,
    basis: 'points' as const,
    elimination: false,
  }
  return { yourScore: score, opponentScore: opponent ? livePoints(opponent) : 0,
    opponentRosterId: opponent ? String(opponent.roster_id) : null, unpaired: !opponent,
    standing: opponent ? null : fieldStanding, fieldStanding, scored: true as const }
}
