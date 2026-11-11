/**
 * The ONLY shapes that leave the server for a demo request.
 *
 * Every field here is either (a) a fake alias, (b) real but non-identifying league data
 * the product brief says to keep — player names, scores, standings, schedule, settings —
 * or (c) a public slot number. There is deliberately no field that can carry a real
 * team id, roster id, user id, platform id, avatar URL, email, username, league name,
 * chat message or trade note. Adding one is a reviewable change to this file.
 *
 * This file is safe to import from client components; it holds types only.
 */

export type DemoTeam = {
  /** Public, stable seat number (alias index + 1). Never a real id. */
  slot: number
  teamName: string
  managerName: string
  initials: string
  color: string
}

export type DemoStandingRow = {
  slot: number
  rank: number
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
}

export type DemoMatchupSide = { slot: number; points: number }

export type DemoMatchup = {
  home: DemoMatchupSide
  away: DemoMatchupSide | null
  status: 'final' | 'live' | 'upcoming'
}

export type DemoPlayer = {
  name: string
  position: string | null
  team: string | null
  headshotUrl: string | null
}

export type DemoRoster = {
  slot: number
  starters: DemoPlayer[]
  bench: DemoPlayer[]
}

export type DemoTradeAsset = { kind: 'player' | 'pick'; name: string; position: string | null; team: string | null }

export type DemoTrade = {
  /** Public sequence key for React lists; not derived from any real id. */
  key: string
  /** Day only (YYYY-MM-DD) — a full timestamp is more precise than the demo needs. */
  date: string
  sides: Array<{ slot: number; received: DemoTradeAsset[] }>
}

export type DemoHealth = {
  score: number
  status: string
  summary: string
  strengths: string[]
  problems: string[]
}

export type DemoAlert = { kind: 'health' | 'commissioner' | 'roster'; text: string }

export type DemoLeagueSettings = {
  sport: string
  season: number
  scoringLabel: string | null
  leagueType: string | null
  isDynasty: boolean
  teamCount: number
  rosterPositions: string[]
  playoffTeams: number | null
  playoffStartWeek: number | null
  tradeDeadlineWeek: number | null
  waiverType: string | null
}

export type DemoLeagueView = {
  demo: true
  label: 'Demo league — live sample data'
  leagueName: string
  settings: DemoLeagueSettings
  currentWeek: number | null
  /** When the source last synced, so the page can say how live "live" is. */
  lastSyncedAt: string | null
  teams: DemoTeam[]
  standings: DemoStandingRow[]
  matchups: DemoMatchup[]
  rosters: DemoRoster[]
  trades: DemoTrade[]
  health: DemoHealth | null
  alerts: DemoAlert[]
}

export type DemoUnavailable = { demo: true; available: false; reason: 'not_configured' | 'source_missing' | 'error' }
