/**
 * Pure half of `railRecords.ts`: a team's record and place from its league's `LeagueTeam` rows.
 *
 * ⚠ THE PLATFORM'S OWN RANK WINS WHEN IT PUBLISHED ONE. Platforms break ties their own way
 * (head-to-head, divisions, points), and "2nd" here must match "2nd" on Sleeper. Only when no rank
 * was synced is a place computed: winning percentage, then points for — the standard order.
 *
 * ⚠ NO GAMES, NO LINE. A 0-0 record says nothing, and a computed "1st" before kickoff is the
 * alphabet, not a standing.
 */

export type RailRecordTeam = {
  leagueId: string
  externalId: string
  wins: number
  losses: number
  ties: number
  pointsFor: number
  currentRank: number | null
}

export type RailRecord = {
  wins: number
  losses: number
  ties: number
  /** Your place, 1 = top. Null when it cannot be stated. */
  rank: number | null
  /** Teams in the league. */
  teams: number
}

const played = (t: RailRecordTeam) => t.wins + t.losses + t.ties
const winPct = (t: RailRecordTeam) => (played(t) === 0 ? 0 : (t.wins + t.ties / 2) / played(t))

export function railRecordsFrom(
  mine: ReadonlyArray<{ leagueId: string; externalId: string }>,
  teams: ReadonlyArray<RailRecordTeam>,
): Record<string, RailRecord> {
  const byLeague = new Map<string, RailRecordTeam[]>()
  for (const t of teams) byLeague.set(t.leagueId, [...(byLeague.get(t.leagueId) ?? []), t])
  const out: Record<string, RailRecord> = {}
  for (const claim of mine) {
    if (out[claim.leagueId]) continue
    const league = byLeague.get(claim.leagueId) ?? []
    const me = league.find((t) => t.externalId === claim.externalId)
    if (!me || played(me) === 0) continue
    let rank: number | null = me.currentRank != null && me.currentRank > 0 ? me.currentRank : null
    if (rank == null) {
      /* Strictly better teams, plus one — a tie on both keys shares the place. */
      rank = 1 + league.filter((t) => winPct(t) > winPct(me) || (winPct(t) === winPct(me) && t.pointsFor > me.pointsFor)).length
    }
    if (rank > league.length) rank = null
    out[claim.leagueId] = { wins: me.wins, losses: me.losses, ties: me.ties, rank, teams: league.length }
  }
  return out
}
