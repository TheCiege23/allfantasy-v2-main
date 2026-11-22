/** Client-side fetch helpers for tournament standings API (existing routes). */

export type StandingsLeagueRow = {
  id: string
  tournamentLeagueId: string
  participantId: string
  userId: string
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  streak: string | null
  leagueRank: number | null
  conferenceRank: number | null
  advancementStatus: string
  draftSlot: number | null
  /** Present when `week` was passed to the standings API; redraft matchup points for that week. */
  weekPoints?: number
  participant: { displayName: string; userId: string }
}

export type StandingsLeague = {
  id: string
  name: string
  conferenceId: string | null
  roundId: string
  leagueId: string | null
  status: string
  teamSlots: number
  advancersCount: number
  participants: StandingsLeagueRow[]
}

type StandingsRound = {
  id: string
  roundNumber: number
  roundType: string
  roundLabel: string
  weekStart: number
  weekEnd: number
  status: string
}

export async function fetchTournamentStandingsJson(
  tournamentId: string,
  roundNumber?: number,
  week?: number | null,
): Promise<{ round: StandingsRound; leagues: StandingsLeague[]; weeklyWeek?: number }> {
  const q = new URLSearchParams({ tournamentId })
  if (roundNumber != null && Number.isFinite(roundNumber)) q.set('roundNumber', String(roundNumber))
  if (week != null && Number.isFinite(week)) q.set('week', String(week))
  const r = await fetch(`/api/tournament/standings?${q}`, { credentials: 'include' })
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error ?? 'Failed to load standings')
  }
  return r.json()
}
