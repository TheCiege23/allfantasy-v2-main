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
  recordOverall?: { wins?: number; losses?: number; ties?: number }
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
  /**
   * `FetchLeagueRules`, when it answered. NULL means the call failed and the
   * import continued without scoring rules — an enrichment, never a reason to
   * fail an import that could already read standings and rosters.
   */
  rules?: FleaflickerRulesResponse | null
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

/**
 * `FetchLeagueRules` — the league's scoring rules and roster shape.
 *
 * Shape observed from `contracts/fleaflicker/fixtures/rules.NFL.json` (league
 * 206154), not from the vendor's docs, which name the endpoint without
 * describing its body.
 *
 * 🛑 THE OMISSION CONVENTION AGAIN, AND IT IS NOW A PATTERN ACROSS THIS API.
 * A group with NO rules omits `scoringRules` entirely rather than sending `[]` —
 * in the fixture, `Punting` carries 10 `allCategories` and no `scoringRules` key
 * at all. Likewise 14 of 19 `rosterPositions` omit `min`/`max`/`start`. The
 * scoreboard does the same with `games` and with every false boolean. Every
 * optional marker below is measured, not defensive guessing.
 */
export type FleaflickerScoringCategory = {
  id: number
  abbreviation?: string
  nameSingular?: string
  namePlural?: string
}

export type FleaflickerScoringRule = {
  category: FleaflickerScoringCategory
  /** The headline number: "1" in "1 point for every 25 Passing Yards". */
  points?: { value?: number; formatted?: string }
  /** The divisor: 25 in that example. Absent on flat bonus rules. */
  forEvery?: number
  /**
   * The already-divided rate (0.04). Present only when `forEvery` is not 1 —
   * 13 of the fixture's 48 rules. Prefer this for arithmetic; use
   * `points`/`forEvery` only to render the rule the way Fleaflicker words it.
   */
  pointsPer?: { value?: number; formatted?: string }
  description?: string
  /** Position codes. See `applyToAll` before treating this as a restriction. */
  applyTo?: string[]
  /**
   * ⚠ `true` MEANS "EVERY POSITION", and `applyTo` then lists them all (10 of 10
   * in the fixture). A rule with `applyToAll: true` is NOT position-restricted,
   * so carrying its `applyTo` downstream would invent a restriction that does
   * not exist.
   */
  applyToAll?: boolean
  template?: string
  /** Threshold machinery — a banded rule (QB rating tiers, FG distance bands). */
  isBonus?: boolean
  boundLower?: number
  boundUpper?: number
  rangeType?: string
}

export type FleaflickerScoringGroup = {
  label?: string
  allCategories?: FleaflickerScoringCategory[]
  /** ⚠ ABSENT, not empty, when the group has no rules. */
  scoringRules?: FleaflickerScoringRule[]
}

export type FleaflickerRosterPosition = {
  label?: string
  group?: string
  eligibility?: string[]
  /** ⚠ All three absent on bench/IR/taxi/multi-eligibility slots — 14 of 19 in the fixture. */
  min?: number
  max?: number
  start?: number
}

export type FleaflickerRulesResponse = {
  rosterPositions?: FleaflickerRosterPosition[]
  groups?: FleaflickerScoringGroup[]
  numStarters?: number
  numBench?: number
  maxActive?: number
  maxRosterSize?: number
}
