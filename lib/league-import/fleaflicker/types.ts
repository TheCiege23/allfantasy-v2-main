/**
 * Minimal shapes for Fleaflicker public API (`FetchLeagueStandings`, `FetchLeagueRosters`).
 * Full API surface: https://www.fleaflicker.com/api-docs/index.html
 */

export type FleaflickerSport = 'NFL' | 'MLB' | 'NBA' | 'NHL'

export type FleaflickerProPlayer = {
  id: number
  nameFull?: string
  position?: string
  nameShort?: string
}

export type FleaflickerRosterPlayer = {
  proPlayer: FleaflickerProPlayer
}

export type FleaflickerTeamStub = {
  id: number
  name: string
  logoUrl?: string | null
  waiverAcquisitionBudget?: { value?: number } | null
  recordOverall?: {
    wins?: number
    losses?: number
    ties?: number
    /**
     * ⚠ FLEAFLICKER PUBLISHES A REAL RANK AND THIS ADAPTER IGNORED IT. It sits on
     * `recordOverall`, not on the team, which is why it was missed — the mapper read
     * `recordOverall.wins`/`.losses` and stopped there. Confirmed in
     * `contracts/fleaflicker/fixtures/scoreboard.NFL.2021.week16.json`:
     * `recordOverall.rank = 2` alongside `recordDivision.rank` and
     * `recordPostseason.rank`.
     */
    rank?: number
  }
  pointsFor?: { value?: number }
  pointsAgainst?: { value?: number }
  owners?: Array<{ id: number; displayName?: string }>
  initials?: string
}

export type FleaflickerLeagueCore = {
  id: number
  name: string
  logoUrl?: string | null
  description?: string | null
  size?: number
  capacity?: number
  maxKeepers?: number | null
  waiverType?: string | null
  defaultWaiverBudget?: number | null
  rosterRequirements?: {
    rosterSize?: number
    positions?: Array<{ label?: string; group?: string; start?: number }>
  }
}

export type FleaflickerStandingsResponse = {
  season: number
  league: FleaflickerLeagueCore
  divisions: Array<{
    id: number
    name: string
    teams: FleaflickerTeamStub[]
  }>
}

export type FleaflickerRostersResponse = {
  rosters: Array<{
    team: FleaflickerTeamStub
    players: FleaflickerRosterPlayer[]
  }>
}

export type FleaflickerImportPayload = {
  sport: FleaflickerSport
  season: number
  standings: FleaflickerStandingsResponse
  rosters: FleaflickerRostersResponse
}

/**
 * `FetchLeagueScoreboard` — the weekly matchup feed.
 *
 * Shape observed from committed fixtures, NOT from the vendor's docs:
 * `contracts/fleaflicker/fixtures/scoreboard.NFL.2021.week1.json` (a played
 * regular-season week), `...2021.week16.json` (the championship week, which
 * carries a DIFFERENT flag set) and `scoreboard.NFL.json` (a league with no
 * schedule generated yet, which has no `games` key at all).
 *
 * 🛑 EVERY `is*` FLAG IS OPTIONAL BECAUSE A FALSE BOOLEAN IS OMITTED, NOT SENT
 * AS `false`. Proven per-row inside one payload: in season 2021 period 14 the
 * first two games carry `isPlayoffs: true` with no `isConsolation` key, and the
 * remaining four carry `isConsolation: true` with no `isPlayoffs` key.
 *
 * The consequence that decides code: `game.isFinalScore === false` IS NEVER
 * TRUE. An unplayed game omits the key. Test `=== true`; treat absence as
 * not-final. `true` is the literal type on purpose — it makes `=== false` a
 * compile error rather than a silent dead branch.
 */
export type FleaflickerScoreboardTeam = {
  id: number
  name?: string
}

export type FleaflickerScoreboardGame = {
  id: number
  home: FleaflickerScoreboardTeam
  away: FleaflickerScoreboardTeam
  /** Absent for a game with no score — see G-05(b); the shape is unobserved, so this is optional both levels down. */
  homeScore?: { score?: { value?: number; formatted?: string } } | null
  awayScore?: { score?: { value?: number; formatted?: string } } | null
  /** Observed values only. A TIE WAS NOT OBSERVED — do not add a third from memory. */
  homeResult?: string
  awayResult?: string
  isFinalScore?: true
  isDivisional?: true
  isPlayoffs?: true
  isConsolation?: true
  isChampionshipGame?: true
  isThirdPlaceGame?: true
}

export type FleaflickerSchedulePeriod = {
  ordinal?: number
  value?: number
  low?: {
    ordinal?: number
    /**
     * 🛑 THE ONLY AUTHORITY FOR WHICH SEASON THE BODY ACTUALLY DESCRIBES.
     * A `season` past the league's last is silently clamped to the last one and
     * returns that season's complete, played data under HTTP 200 — league 206154
     * (last season 2021) returns byte-identical games for 2021, 2024, 2025, 2026
     * and 2099. And standings' top-level `season` echoes the REQUEST back, so
     * reading that to learn what you got is circular.
     */
    season?: number
    startEpochMilli?: string
  } | null
}

export type FleaflickerScoreboardResponse = {
  schedulePeriod?: FleaflickerSchedulePeriod | null
  eligibleSchedulePeriods?: FleaflickerSchedulePeriod[]
  /** ⚠ ABSENT, NOT EMPTY, before a draft. "No games key" means nothing to write yet, never a fetch failure. */
  games?: FleaflickerScoreboardGame[]
}
