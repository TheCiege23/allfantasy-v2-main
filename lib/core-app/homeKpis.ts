/**
 * The league Home's KPI row (components/core-app/screens/LeagueHome.tsx): record, points for, FAAB left.
 * The trade deadline tile is drawn from the screen's own countdown, which already ticks.
 *
 * Pure and built only from what `getLeagueHomeData` already loaded — no new read. Every tile is
 * optional and absent when its data is: a league we cannot place the viewer in has no record tile, a
 * league that does not run FAAB (or whose import could not compute a budget) has no FAAB tile. Absent,
 * never zero — "$0" tells a manager with a full budget that they are broke (see LeagueStanding).
 */
import type { LeagueHomeData, LeagueStanding } from '@/lib/core-app/leagueHome'

export type HomeKpis = {
  record: { record: string; rank: number | null; teams: number | null } | null
  pointsFor: { points: number; rank: number | null; teams: number; vsAverage: number | null } | null
  faab: { remaining: number } | null
}

export function buildHomeKpis(data: Pick<LeagueHomeData, 'yourTeam' | 'standings' | 'faabEnabled'>): HomeKpis {
  const rows: LeagueStanding[] = data.standings.available ? data.standings.data : []
  const you = rows.find((r) => r.isYou) ?? null
  const scored = rows.some((r) => r.wins + r.losses + r.ties > 0 || r.pointsFor > 0)

  const record = data.yourTeam.available
    ? { record: data.yourTeam.data.record, rank: data.yourTeam.data.rank, teams: rows.length > 0 ? rows.length : null }
    : null

  let pointsFor: HomeKpis['pointsFor'] = null
  if (you && scored) {
    const byPoints = [...rows].sort((a, b) => b.pointsFor - a.pointsFor)
    const rank = byPoints.findIndex((r) => r.teamId === you.teamId) + 1
    const average = rows.reduce((sum, r) => sum + r.pointsFor, 0) / rows.length
    pointsFor = {
      points: you.pointsFor,
      rank: rank > 0 ? rank : null,
      teams: rows.length,
      // One team cannot be compared with an average of itself.
      vsAverage: rows.length > 1 ? Math.round((you.pointsFor - average) * 10) / 10 : null,
    }
  } else if (data.yourTeam.available && data.yourTeam.data.pointsFor > 0) {
    pointsFor = { points: data.yourTeam.data.pointsFor, rank: null, teams: rows.length, vsAverage: null }
  }

  const faab = data.faabEnabled === true && you && you.faabRemaining != null ? { remaining: you.faabRemaining } : null

  return { record, pointsFor, faab }
}
