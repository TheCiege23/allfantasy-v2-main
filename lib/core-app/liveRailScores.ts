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

/** "Most teams have played": strictly more than half of the field has points on the board. */
export function mostHavePlayed(played: number, fieldSize: number): boolean {
  return played * 2 > fieldSize
}

export type LiveFieldOptions = {
  /** Rosters already chopped in an elimination league (`choppedBefore`). They leave the field; your own roster never does. */
  out?: ReadonlySet<string>
  /** A roster's display name, for the team currently at the cut line. */
  nameOf?: (rosterId: string) => string | null
  /** Weeks left in an elimination league's season, this one included. */
  weeksLeft?: number | null
  elimination?: boolean
}

export function summarizeLiveScores(rows: LiveMatchupRow[], rosterId: string, options: LiveFieldOptions = {}) {
  const mine = rows.find(row => String(row.roster_id) === rosterId)
  if (!mine) return null
  const opponents = mine.matchup_id == null ? [] : rows.filter(row => row.roster_id !== mine.roster_id && row.matchup_id === mine.matchup_id)
  const opponent = opponents.length === 1 ? opponents[0] : null
  const score = livePoints(mine)
  /*
   * ⚠ THE LIVE FIELD, NOT EVERY ROSTER. The provider still lists a chopped team, at 0, every week; ranked
   * with them, a guillotine survivor who has not kicked off read "T-7th of 18, tied lowest" in week 8 of
   * a league with 11 left (owner's report, 2026-10-30). The server-rendered row already ranked the live
   * field (railMatchups.ts `choppedBefore`); this refresh then overwrote it.
   */
  const field = options.out?.size ? rows.filter(row => row === mine || !options.out!.has(String(row.roster_id))) : rows
  const lowest = Math.min(...field.map(livePoints))
  // The lowest team other than you: who the cut falls on if you stay above them, or who you must pass.
  const others = field.filter(row => row !== mine).sort((a, b) => livePoints(a) - livePoints(b))
  const cutRow = others[0] ?? null
  // Competition ranks preserve ties, including zero and negative score corrections.
  const fieldStanding = field.length < 2 ? null : {
    rank: 1 + field.filter(row => livePoints(row) > score).length,
    outOf: field.length,
    placesAboveCut: field.filter(row => livePoints(row) < score).length,
    cutLine: lowest,
    overCut: score === lowest ? null : Math.round((score - lowest) * 100) / 100,
    tied: field.filter(row => livePoints(row) === score).length > 1,
    basis: 'points' as const,
    elimination: options.elimination === true,
    played: field.filter(row => livePoints(row) !== 0).length,
    cutTeam: cutRow ? (options.nameOf?.(String(cutRow.roster_id)) ?? null) : null,
    cutTeamValue: cutRow ? Math.round(livePoints(cutRow) * 100) / 100 : null,
    weeksLeft: options.weeksLeft ?? null,
  }
  return { yourScore: score, opponentScore: opponent ? livePoints(opponent) : 0,
    opponentRosterId: opponent ? String(opponent.roster_id) : null, unpaired: !opponent,
    standing: opponent ? null : fieldStanding, fieldStanding, scored: true as const }
}
