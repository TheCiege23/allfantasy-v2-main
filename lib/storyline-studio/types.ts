/**
 * Storyline Studio — the shapes the hook engine reads and writes.
 *
 * The engine (./hookEngine.ts) is PURE: it is handed a `StoryData` that a loader
 * (./loadStoryData.ts) read out of Postgres, and it returns ranked hooks. Nothing in here
 * knows where a number came from except through the `source` each fact carries.
 */

export type HookKind =
  | 'rivalry_record'
  | 'playoff_history'
  | 'revenge_game'
  | 'draft_steal'
  | 'one_man_army'
  | 'streak'
  | 'points_leader_vs_cellar'
  | 'title_rematch'
  | 'biggest_blowout'

/** A team's identity for the whole history: a slot key that survives seasons. */
export type TeamKey = string

export type StoryTeam = { key: TeamKey; name: string }

/** One played (or scheduled) head-to-head game. */
export type StoryFixture = {
  season: number
  week: number
  a: TeamKey
  b: TeamKey
  scoreA: number
  scoreB: number
  /** False for a scheduled or live game — never counted as a result. */
  final: boolean
}

/** A playoff game between two teams. */
export type StoryPlayoffGame = {
  season: number
  round: number
  winner: TeamKey
  loser: TeamKey
  /** The championship game. */
  title: boolean
}

/** A player's points for one team in one week. */
export type StoryPlayerWeek = {
  season: number
  week: number
  team: TeamKey
  playerId: string
  points: number
  starter: boolean
}

export type StoryDraftPick = {
  season: number
  round: number
  /** Overall pick number. */
  pick: number
  team: TeamKey
  playerId: string
}

export type StoryStanding = {
  team: TeamKey
  wins: number
  losses: number
  ties: number
  pointsFor: number
}

export type StoryData = {
  leagueId: string
  sport: string
  /** The season "this week" belongs to. */
  season: number
  /** The fantasy week the hooks are for, or null when the league has no schedule this week. */
  week: number | null
  /** Teams by key. Only these names may appear in a hook. */
  teams: ReadonlyMap<TeamKey, StoryTeam>
  /** This week's head-to-head pairs. */
  matchups: ReadonlyArray<{ a: TeamKey; b: TeamKey; matchupId?: string }>
  fixtures: ReadonlyArray<StoryFixture>
  playoffs: ReadonlyArray<StoryPlayoffGame>
  playerWeeks: ReadonlyArray<StoryPlayerWeek>
  draftPicks: ReadonlyArray<StoryDraftPick>
  /** Current-season standings. */
  standings: ReadonlyArray<StoryStanding>
  /** Player display names by id. A player without a name is never written about. */
  playerNames: ReadonlyMap<string, string>
  /** Where each family of data came from — copied into every fact's `source`. */
  sources: {
    fixtures: string
    playoffs: string
    playerWeeks: string
    draftPicks: string
    standings: string
  }
}

/** One fact behind a hook: its value and the table it was read from. */
export type HookFact = {
  key: string
  value: string | number
  source: string
}

export type StoryHook = {
  /** Stable across reads of the same data: kind + teams + the deciding fact. */
  id: string
  kind: HookKind
  /** Higher is more compelling. Used only to rank. */
  score: number
  season: number
  week: number | null
  /** The matchup this hook is about, or null for a league-wide hook. */
  matchup: { a: TeamKey; b: TeamKey; matchupId?: string } | null
  teams: TeamKey[]
  players: string[]
  facts: HookFact[]
  /** The ready-to-post text, rendered from `facts` only. */
  text: string
}

export type HookLanguage = 'en' | 'es'
