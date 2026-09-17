/**
 * `/core/portfolio` insights — the shapes the loader stores and the screen reads.
 *
 * ⚠ CLIENT-SAFE ON PURPOSE: NO IMPORTS. The screen is a client island (its filters recompute
 * exposure, risk and value in memory without a round trip), so everything it receives must be
 * plain data and every type it names must be importable from a `'use client'` module.
 *
 * ⚠ FACTS, NOT SENTENCES. Nothing here holds a now-relative string ("12m ago", "this week").
 * The payload is cached for minutes and its history for months; a sentence baked at build time
 * goes stale while the number beside it stays true. The screen phrases.
 *
 * ⚠ COMPACT BY INDEX. A sixty-league portfolio holds ~1,200 player-league pairs. Each player
 * carries league INDEXES into `leagues` rather than repeating ids, which keeps the payload a
 * size a phone can take while still letting the client recount everything under a filter.
 */

export type PortfolioStage = 'drafting' | 'pre_draft' | 'in_season' | 'complete' | 'unknown'

/** Where a league sits on the win-now / build-later line. */
export type CompetitiveStatus = 'contender' | 'middle' | 'rebuild' | 'unknown'

/**
 * Why a status was assigned — shown next to it, because "contender" from what you told Chimmy
 * and "contender" from a 1-0 record are claims of very different strength.
 */
export type StatusSource = 'you' | 'standings' | 'roster_value' | 'standings_and_value'

/** The format families the filters offer. Everything else is `other`, never guessed. */
export type FormatFamily = 'dynasty' | 'keeper' | 'redraft' | 'other'

export type ScoringKind = 'ppr' | 'half_ppr' | 'standard'

export type PortfolioLeagueFacts = {
  id: string
  name: string
  platform: string
  sport: string
  season: string | null
  /** The concept id from `readFormatRules` — `dynasty`, `devy`, `guillotine`, … */
  concept: string
  family: FormatFamily
  bestBall: boolean
  idp: boolean
  superflex: boolean
  /** Null when the league's rulebook is not stored, which is common off Sleeper. */
  scoring: ScoringKind | null
  tePremium: boolean
  stage: PortfolioStage
  commissioner: boolean
  teamCount: number | null
  record: { wins: number; losses: number; ties: number } | null
  /** Standing — only meaningful once games are played, and withheld before. */
  rank: number | null
  status: CompetitiveStatus
  statusSource: StatusSource | null
  /** Your roster's value in this league's own book; null when nothing on it is priced. */
  rosterValue: number | null
  /** 1 = the most valuable roster among `valuedTeams`. */
  rosterValueRank: number | null
  valuedTeams: number | null
  /** "dynasty · superflex" — the book `rosterValue` is quoted in. */
  valueBook: string | null
  /** False when no roster could be matched to your team — every roster fact is then absent. */
  hasRoster: boolean
  /** True when the rulebook names its starting slots, so fragile-position checks can run. */
  slotsKnown: boolean
}

/** S starter · B bench · I injured reserve · T taxi. */
export type SlotCode = 'S' | 'B' | 'I' | 'T'

export type InjuryKind = 'out' | 'risk'

export type PortfolioPlayer = {
  /** `${sport}:${id}` — Sleeper ids are only unique within a sport. */
  key: string
  id: string
  sport: string
  name: string
  position: string | null
  team: string | null
  /** Cross-league book value (see `PortfolioInsights.playerValueBook`); null when unpriced. */
  value: number | null
  /** Change over the value window, same units; null when either end is unpriced. */
  valueDelta: number | null
  injury: { status: string; kind: InjuryKind } | null
  /** Regular-season bye week, NFL only. */
  byeWeek: number | null
  /** [leagueIndex, slot] pairs, one per roster of yours holding him. */
  held: Array<[number, SlotCode]>
}

/** One league's roster value per `valueDates` entry, in the league's own book. */
export type LeagueValueSeries = {
  leagueIndex: number
  /** Reconstructed: today's roster priced on each date. Null where nothing was priced. */
  values: Array<number | null>
  /** Players priced on each date, of `rosterSize`. */
  priced: Array<number | null>
  rosterSize: number
}

export type PlayerValueMover = {
  key: string
  /** Aligned to `valueDates`. */
  values: Array<number | null>
}

export type RiskFactor = 'injury' | 'bye' | 'fragile' | 'stack'

export type LeagueRisk = {
  leagueIndex: number
  /** Starters ruled out / at risk. Player keys. */
  out: string[]
  atRisk: string[]
  /** Upcoming week -> starters (player keys) whose club is off that week. */
  byes: Record<string, string[]>
  /** Dedicated slots with no healthy backup: position -> players holding it. Null when slots are unknown. */
  fragile: Array<{ position: string; starters: number; healthy: number; players: string[] }> | null
  /** The NFL club supplying the most of your starters here. */
  stack: { team: string; players: string[] } | null
}

export type PortfolioInsights = {
  version: 1
  builtAt: string
  leagues: PortfolioLeagueFacts[]
  players: PortfolioPlayer[]
  risk: LeagueRisk[]
  /** The NFL week the risk grid looks forward from; null when no schedule is stored. */
  nflWeek: { season: number; week: number; preseason: boolean } | null
  /** Upcoming weeks the bye columns cover, in order. Empty when byes cannot be judged. */
  byeWeeks: number[]
  /** Sports whose injury feed could not answer — rendered as "we cannot know", never "healthy". */
  injuryGaps: Array<{ sport: string; reason: string }>
  injuryFeedStale: boolean
  /** YYYY-MM-DD capture days, oldest first. */
  valueDates: string[]
  valueSeries: LeagueValueSeries[]
  movers: PlayerValueMover[]
  /** "dynasty · superflex" — the one book every per-player value on the page is quoted in. */
  playerValueBook: string
  /** Why sections are empty, when they are. */
  notes: {
    noClaimedTeams?: boolean
    rostersMissing?: number
    unmatchedPlayers?: number
  }
}

/** One day's recorded roster values, kept long after the full insights expire. */
export type PortfolioDailyTotals = {
  date: string
  builtAt: string
  /** leagueId -> roster value in that league's book. */
  values: Record<string, number>
}

/** A stored day that the value chart can use in place of a reconstruction. */
export type RecordedValueDay = { date: string; values: Record<string, number> }
