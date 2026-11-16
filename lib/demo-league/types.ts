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

type DemoMatchupSide = { slot: number; points: number }

export type DemoMatchup = {
  home: DemoMatchupSide
  away: DemoMatchupSide | null
  status: 'final' | 'live' | 'upcoming'
}

/**
 * `matchupId` is the provider's per-week game number (1…n), which pairs two seats into one game —
 * the same public schedule fact a scoreboard shows. The real standings board needs it to tell wins
 * from losses. Optional: a source with no pairing (a points-only league) leaves it out.
 */
export type DemoWeekScores = { week: number; scores: Array<{ slot: number; points: number; matchupId?: number | null }> }

/** A week's games nobody has scored in yet, as seat pairs — the published schedule, nothing more. Used by `DemoLeagueView.upcoming`. */
export type DemoUpcomingWeek = { week: number; pairs: Array<[number, number]> }

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

type DemoHealth = {
  score: number
  status: string
  summary: string
  strengths: string[]
  problems: string[]
}

export type DemoAlert = { kind: 'health' | 'commissioner' | 'roster'; text: string }

type DemoLeagueSettings = {
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
  /**
   * Every COMPLETED week's score per team, oldest first. Numbers and public slots only — the same
   * kind of data as `standings`. Demo Chimmy reads it for recent form and schedule luck (all-play
   * record), so "who is the best team and why" can be answered on the first try.
   */
  weeklyScores: DemoWeekScores[]
  /**
   * The rest of the regular-season schedule (unplayed games, by seat), so the standings board can say
   * who has clinched — without it every team "clinches" or is "eliminated" with weeks still to play.
   * Optional so a hand-built view (tests, sample formats with no future rows) can leave it out.
   */
  upcoming?: DemoUpcomingWeek[]
  rosters: DemoRoster[]
  trades: DemoTrade[]
  health: DemoHealth | null
  alerts: DemoAlert[]
}

export type DemoUnavailable = { demo: true; available: false; reason: 'not_configured' | 'source_missing' | 'error' }
