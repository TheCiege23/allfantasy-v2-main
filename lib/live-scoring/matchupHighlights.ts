/**
 * Pure functions for deriving live matchup highlight signals.
 * Used by league home scoreboard, dashboard summary, and any future surface
 * (mobile, notifications) that needs the same signals from the same data.
 */

export type MatchupForHighlights = {
  teamName: string
  totalPoints: number
  homeScore?: number | null
  awayScore?: number | null
  homeTeamName?: string | null
  awayTeamName?: string | null
  homeRosterWins?: number | null
  awayRosterWins?: number | null
}

export type DerivedHighlights = {
  topScorerName: string | null
  topScorerPts: number | null
  closestMatchup: { homeTeam: string; awayTeam: string; diff: number } | null
  upsetAlert: { leaderTeam: string; leaderPts: number; trailingTeam: string; trailingPts: number } | null
}

export function deriveMatchupHighlights(matchups: MatchupForHighlights[]): DerivedHighlights {
  if (matchups.length === 0) {
    return { topScorerName: null, topScorerPts: null, closestMatchup: null, upsetAlert: null }
  }

  // Top scorer across all teams in all matchups
  let topScorerName: string | null = null
  let topScorerPts = -Infinity
  for (const m of matchups) {
    if (m.totalPoints > topScorerPts) {
      topScorerPts = m.totalPoints
      topScorerName = m.teamName
    }
  }

  // Closest matchup — among paired matchups with enriched score data
  const seen = new Set<string>()
  let closestMatchup: DerivedHighlights['closestMatchup'] = null
  let minDiff = Infinity
  for (const m of matchups) {
    if (m.homeTeamName && m.awayTeamName && m.homeScore != null && m.awayScore != null) {
      const key = [m.homeTeamName, m.awayTeamName].sort().join('__')
      if (seen.has(key)) continue
      seen.add(key)
      const diff = Math.abs(m.homeScore - m.awayScore)
      if (diff < minDiff) {
        minDiff = diff
        closestMatchup = { homeTeam: m.homeTeamName, awayTeam: m.awayTeamName, diff }
      }
    }
  }

  // Upset alert — lower-record team currently leading by more than 2 pts
  const seenUpset = new Set<string>()
  let upsetAlert: DerivedHighlights['upsetAlert'] = null
  for (const m of matchups) {
    if (
      m.homeTeamName &&
      m.awayTeamName &&
      m.homeScore != null &&
      m.awayScore != null &&
      m.homeRosterWins != null &&
      m.awayRosterWins != null
    ) {
      const key = [m.homeTeamName, m.awayTeamName].sort().join('__')
      if (seenUpset.has(key)) continue
      seenUpset.add(key)
      const homeWins = m.homeRosterWins ?? 0
      const awayWins = m.awayRosterWins ?? 0
      if (m.homeScore > m.awayScore && homeWins < awayWins && m.homeScore - m.awayScore > 2) {
        upsetAlert = { leaderTeam: m.homeTeamName, leaderPts: m.homeScore, trailingTeam: m.awayTeamName, trailingPts: m.awayScore }
      } else if (m.awayScore > m.homeScore && awayWins < homeWins && m.awayScore - m.homeScore > 2) {
        upsetAlert = { leaderTeam: m.awayTeamName, leaderPts: m.awayScore, trailingTeam: m.homeTeamName, trailingPts: m.homeScore }
      }
    }
  }

  return {
    topScorerName,
    topScorerPts: topScorerPts === -Infinity ? null : topScorerPts,
    closestMatchup,
    upsetAlert,
  }
}
