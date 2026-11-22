/**
 * Commissioner schedule editing: swap two teams in one week (2026-11-15).
 *
 * The one edit a commissioner needs most — "put Team A against Team C this week instead" — is two teams trading places
 * in a week's matchups: each takes the other's opponent (or bye). Every other team's week is unchanged, the week still
 * has each team exactly once, and an odd league's bye just moves with the team that had it.
 *
 * Pure (no I/O).
 */
export type WeekMatchupRow = { id: string; homeRosterId: string; awayRosterId: string | null }

export type SwapPlan =
  | { ok: true; updates: Array<{ id: string; homeRosterId: string; awayRosterId: string | null }> }
  | { ok: false; code: 'SAME_TEAM' | 'TEAM_NOT_IN_WEEK' | 'ALREADY_OPPONENTS'; message: string }

export function planTeamSwap(rows: readonly WeekMatchupRow[], rosterA: string, rosterB: string): SwapPlan {
  if (!rosterA || rosterA === rosterB) return { ok: false, code: 'SAME_TEAM', message: 'Pick two different teams.' }
  const holds = (row: WeekMatchupRow, id: string) => row.homeRosterId === id || row.awayRosterId === id
  const rowA = rows.find((r) => holds(r, rosterA))
  const rowB = rows.find((r) => holds(r, rosterB))
  if (!rowA || !rowB) return { ok: false, code: 'TEAM_NOT_IN_WEEK', message: 'Both teams must be on this week’s schedule.' }
  if (rowA.id === rowB.id) return { ok: false, code: 'ALREADY_OPPONENTS', message: 'Those two teams already play each other this week.' }
  const swap = (id: string | null) => (id === rosterA ? rosterB : id === rosterB ? rosterA : id)
  return {
    ok: true,
    updates: [rowA, rowB].map((row) => ({ id: row.id, homeRosterId: swap(row.homeRosterId)!, awayRosterId: swap(row.awayRosterId) })),
  }
}
