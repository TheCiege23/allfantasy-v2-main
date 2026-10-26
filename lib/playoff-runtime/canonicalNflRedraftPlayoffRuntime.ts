import { isPointsOnlySeeding } from '@/lib/playoff-defaults/seedingRule'
import { checkByePlan, isNaturalByePlan, parseStoredByePlan } from '@/lib/playoff-brackets/byePlan'
import { detectPlayIn } from '@/lib/playoff-brackets/playIn'
import { allPlayShares, coinFlipDraw, parseTiebreakerOrder } from '@/lib/standings/tiebreakerOrder'
import type {
  CanonicalLeagueRuntimeEvent,
  CanonicalLeagueRuntimeEventType,
} from '@/lib/league-runtime/leagueRuntimeEvents'
import { toCanonicalLeagueRuntimeEvent } from '@/lib/league-runtime/leagueRuntimeEvents'

export type NflRedraftPlayoffRulesInput = {
  general?: {
    season?: number | null
    sport?: string | null
    teamCount?: number | null
  }
  playoffs: {
    teamCount?: number | null
    startWeek?: number | null
    firstRoundByes?: number | null
    bracketType?: string | null
    totalRounds?: number | null
    consolationBracketEnabled?: boolean | null
    /** Losers advance in the lower bracket; its final's loser finishes last. Wins over `consolationBracketEnabled`. */
    toiletBowlEnabled?: boolean | null
    thirdPlaceGameEnabled?: boolean | null
    seedingRules?: string | null
    tiebreakerRules?: string[] | null
    byeRules?: string | null
    reseedBehavior?: string | null
    standingsTiebreakers?: string[] | null
    /**
     * The commissioner's divisions rule (lib/league/divisions/leagueDivisions.ts): division winners take
     * the top seeds, are guaranteed a spot but seeded by record, or get nothing. Absent (every caller
     * before divisions were wired) keeps the legacy reading of `seedingRules`: guaranteed, by record.
     */
    divisionPlayoffRule?: 'top_seeds' | 'guaranteed' | 'none' | null
    /** Rounds each seed sits out (`lib/playoff-brackets/byePlan.ts`). Null = the natural byes. */
    byePlan?: readonly number[] | null
    /**
     * The commissioner's own order (`League.settings.tiebreaker_order`, lib/standings/tiebreakerOrder.ts).
     * When set it is applied EXACTLY as chosen after record — none of the legacy reordering below.
     */
    customTiebreakers?: string[] | null
  }
  schedule: {
    regularSeasonLength?: number | null
    playoffTransitionPoint?: number | null
  }
}

export type NflRedraftPlayoffTeamInput = {
  rosterId: string
  displayName?: string | null
  ownerId?: string | null
  ownerName?: string | null
  divisionId?: string | null
  divisionName?: string | null
  wins?: number | null
  losses?: number | null
  ties?: number | null
  pointsFor?: number | null
  pointsAgainst?: number | null
  divisionWins?: number | null
  divisionLosses?: number | null
  divisionTies?: number | null
  playoffSeed?: number | null
  isEliminated?: boolean | null
}

export type NflRedraftPlayoffMatchupInput = {
  matchupId?: string | null
  roundId?: string | null
  roundNumber: number
  roundName?: string | null
  matchupNumber: number
  bracketType?: NflRedraftPlayoffBracketType | string | null
  homeRosterId?: string | null
  awayRosterId?: string | null
  homeSeed?: number | null
  awaySeed?: number | null
  homeScore?: number | null
  awayScore?: number | null
  winnerRosterId?: string | null
  nextMatchupId?: string | null
  status?: string | null
  metadata?: Record<string, unknown> | null
}

/**
 * A regular-season head-to-head result, used ONLY for the `head_to_head` seeding tiebreaker.
 * Rows that are not final, are median games, are not `regular`, or fall after the regular season
 * are ignored, so passing a whole season's schedule is safe.
 */
export type NflRedraftRegularSeasonMatchupInput = {
  week?: number | null
  type?: string | null
  homeRosterId: string | null
  awayRosterId: string | null
  homeScore?: number | null
  awayScore?: number | null
  status?: string | null
  isMedianMatchup?: boolean | null
}

export type NflRedraftPlayoffBracketStatus = 'not_generated' | 'pending' | 'active' | 'locked' | 'complete'
export type NflRedraftPlayoffBracketType = 'championship' | 'consolation' | 'third_place'
export type NflRedraftPlayoffMatchupStatus = 'scheduled' | 'active' | 'final' | 'bye' | 'cancelled'
export type NflRedraftPlayoffRoundStatus = 'pending' | 'active' | 'completed' | 'cancelled'
export type NflRedraftPlayoffQualifiedBy = 'division' | 'wildcard' | 'standings'
/**
 * The bracket the non-playoff teams play. `consolation`: winners advance and the final's winner is
 * the best of the rest. `toilet_bowl`: losers advance and the final's loser finishes last.
 */
export type NflRedraftLowerBracketMode = 'none' | 'consolation' | 'toilet_bowl'

export type NflRedraftPlayoffSettings = {
  playoffTeamCount: number
  regularSeasonEndWeek: number
  playoffStartWeek: number
  bracketSize: number
  firstRoundByes: number
  roundCount: number
  /**
   * A commissioner-granted bye plan that differs from the natural one (multi-round byes). When set,
   * rounds are sized by the plan and every round re-pairs best vs worst, adding the seeds whose
   * bye ends that round. Null for the natural bracket, which keeps the fixed tree below.
   */
  byePlan: number[] | null
  reseedAfterEachRound: boolean
  /** A winners-advance consolation bracket (`lowerBracket === 'consolation'`). */
  consolationEnabled: boolean
  /** A losers-advance toilet bowl (`lowerBracket === 'toilet_bowl'`). */
  toiletBowlEnabled: boolean
  lowerBracket: NflRedraftLowerBracketMode
  thirdPlaceGameEnabled: boolean
  divisionWinnersEnabled: boolean
  /** Division winners hold seeds 1..k (best winner first) ahead of every wildcard. Else seeded by record. */
  divisionWinnersTopSeeds: boolean
  /** The league chose `points_only` seeding: record is NOT the primary sort. */
  pointsOnlySeeding: boolean
  tiebreakers: string[]
  /** The commissioner's own order when one applied (lib/standings/tiebreakerOrder.ts), else absent. */
  customTiebreakers?: string[] | null
  supported: boolean
  supportWarnings: string[]
}

export type NflRedraftPlayoffTeamState = {
  rosterId: string
  displayName: string
  ownerId: string | null
  ownerName: string | null
  divisionId: string | null
  divisionName: string | null
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  divisionWins: number
  divisionLosses: number
  divisionTies: number
  winPct: number
  divisionWinPct: number
  playoffSeed: number | null
  qualified: boolean
  qualifiedBy: NflRedraftPlayoffQualifiedBy | null
  eliminated: boolean
  tiebreakerValues: Record<string, number | string>
}

export type NflRedraftPlayoffSeedState = {
  seed: number
  rosterId: string
  displayName: string
  qualifiedBy: NflRedraftPlayoffQualifiedBy
  wins: number
  losses: number
  ties: number
  winPct: number
  pointsFor: number
  pointsAgainst: number
  divisionRecord: string | null
  tiebreakerValues: Record<string, number | string>
}

export type NflRedraftPlayoffMatchupState = {
  matchupId: string
  roundId: string
  roundNumber: number
  roundName: string
  matchupNumber: number
  bracketType: NflRedraftPlayoffBracketType
  homeRosterId: string | null
  awayRosterId: string | null
  homeSeed: number | null
  awaySeed: number | null
  homeScore: number | null
  awayScore: number | null
  winnerRosterId: string | null
  loserRosterId: string | null
  nextMatchupId: string | null
  status: NflRedraftPlayoffMatchupStatus
  bye: boolean
  complete: boolean
  metadata: Record<string, unknown>
}

export type NflRedraftPlayoffRoundState = {
  roundId: string
  roundNumber: number
  roundName: string
  bracketType: NflRedraftPlayoffBracketType
  status: NflRedraftPlayoffRoundStatus
  matchups: NflRedraftPlayoffMatchupState[]
}

export type NflRedraftPlayoffFinalStanding = {
  finish: number
  rosterId: string
  displayName: string
  seed: number | null
  playoffWins: number
  playoffLosses: number
  champion: boolean
  runnerUp: boolean
  /** Won the third-place game. */
  thirdPlace: boolean
}

export type NflRedraftPlayoffBracketState = {
  bracketId: string | null
  status: NflRedraftPlayoffBracketStatus
  locked: boolean
  generated: boolean
  rounds: NflRedraftPlayoffRoundState[]
  /**
   * The lower bracket (consolation or toilet bowl), stored at `100 + n`. Its rounds are numbered by
   * the championship round they are played alongside, so its final is played with the championship.
   */
  consolationRounds: NflRedraftPlayoffRoundState[]
  /** What `consolationRounds` is — read from the stored rows, so a later settings change cannot relabel it. */
  lowerBracket: NflRedraftLowerBracketMode
  /**
   * The semifinal losers' game, stored in the championship round's row so it is played and scored
   * in exactly the final's weeks. Null when the league has none or the field has no two semifinals.
   */
  thirdPlaceMatchup: NflRedraftPlayoffMatchupState | null
  championRosterId: string | null
  runnerUpRosterId: string | null
  thirdPlaceRosterId: string | null
  /** The consolation final's winner, or the toilet bowl final's loser (last place). */
  lowerBracketResultRosterId: string | null
  finalStandings: NflRedraftPlayoffFinalStanding[]
}

export type NflRedraftPlayoffRuntimeState = {
  leagueId: string
  seasonId: string
  season: number
  week: number
  generatedAtIso: string
  settings: NflRedraftPlayoffSettings
  teams: NflRedraftPlayoffTeamState[]
  seeds: NflRedraftPlayoffSeedState[]
  bubbleRosterIds: string[]
  eliminatedRosterIds: string[]
  bracket: NflRedraftPlayoffBracketState
  coverage: {
    teamCount: number
    qualifiedTeams: number
    championshipRounds: number
    championshipMatchups: number
    consolationMatchups: number
    thirdPlaceMatchups: number
    completedMatchups: number
  }
}

export type NflRedraftGeneratedPlayoffBracket = {
  bracket: NflRedraftPlayoffBracketState
  events: CanonicalLeagueRuntimeEvent[]
}

export type NflRedraftPlayoffAdvanceResult =
  | {
      ok: true
      state: NflRedraftPlayoffRuntimeState
      events: CanonicalLeagueRuntimeEvent[]
      advancedRosterIds: string[]
      eliminatedRosterIds: string[]
      status: 'round_complete' | 'championship_ready' | 'ok'
    }
  | {
      ok: false
      code: 'NO_ACTIVE_ROUND' | 'NO_BRACKET' | 'MATCHUPS_INCOMPLETE' | 'TIE_UNRESOLVED'
      message: string
      blockedMatchupIds: string[]
      events: CanonicalLeagueRuntimeEvent[]
    }

export type NflRedraftPlayoffFinalizeResult =
  | {
      ok: true
      state: NflRedraftPlayoffRuntimeState
      championRosterId: string
      runnerUpRosterId: string | null
      finalStandings: NflRedraftPlayoffFinalStanding[]
      events: CanonicalLeagueRuntimeEvent[]
    }
  | {
      ok: false
      code: 'NO_BRACKET' | 'FINAL_ROUND_INCOMPLETE' | 'NO_WINNER' | 'LOWER_BRACKET_INCOMPLETE'
      message: string
      events: CanonicalLeagueRuntimeEvent[]
    }

const DEFAULT_TIEBREAKERS = ['win_pct', 'wins', 'division_record', 'points_for', 'points_against']
const COMPLETE_STATUSES = new Set(['final', 'completed', 'complete'])
const CANCELLED_STATUSES = new Set(['cancelled', 'canceled'])

function intOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value)
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function numberOrZero(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(2, value)))
}

function displayName(input: Pick<NflRedraftPlayoffTeamInput, 'displayName' | 'ownerName' | 'rosterId'>): string {
  return input.displayName?.trim() || input.ownerName?.trim() || input.rosterId
}

function normalizedText(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function includesToken(value: unknown, token: string): boolean {
  return normalizedText(value).replace(/[-\s]+/g, '_').includes(token)
}

const RECORD_KEYS = new Set(['win_pct', 'winning_percentage'])

/**
 * Seeding order. Standard fantasy rule: RECORD first (win %, a tie counts half), then the
 * configured tiebreakers in their configured order.
 *
 * The configured list is treated as TIEBREAKERS — what separates teams with equal records — so
 * `win_pct` is always moved to the front. The stored sport defaults used to be
 * `['points_for', 'head_to_head', ...]` with no record key at all, which seeded every league by
 * points scored; those lists are already persisted on existing leagues, so fixing only the
 * defaults would not fix them.
 *
 * A league whose seeding rule is `points_only` is an explicit commissioner choice and is left
 * exactly as it was: points for, then roster id.
 */
/** The commissioner's order, when one is set and the league seeds by record (points-only ignores it). */
function customOrder(input: NflRedraftPlayoffRulesInput): string[] | null {
  if (isPointsOnlySeeding(input.playoffs.seedingRules)) return null
  const custom = parseTiebreakerOrder(input.playoffs.customTiebreakers ?? null)
  return custom.ok ? custom.value : null
}

function normalizeTiebreakers(input: NflRedraftPlayoffRulesInput): string[] {
  if (isPointsOnlySeeding(input.playoffs.seedingRules)) return ['points_for', 'roster_id']
  const custom = customOrder(input)
  if (custom) return ['win_pct', ...custom, 'roster_id']
  const raw = input.playoffs.standingsTiebreakers?.length
    ? input.playoffs.standingsTiebreakers
    : input.playoffs.tiebreakerRules?.length
      ? input.playoffs.tiebreakerRules
      : DEFAULT_TIEBREAKERS
  const normalized = raw
    .map((row) => normalizedText(row).replace(/[-\s]+/g, '_'))
    .filter(Boolean)
    .filter((key) => !RECORD_KEYS.has(key))
    .map((key) => (key === 'h2h' ? 'head_to_head' : key === 'pf' ? 'points_for' : key))
  const ordered = Array.from(new Set(normalized))
  // Owner's rule (2026-10-20): points for precedes head-to-head, the order the standings board
  // has always used, so the table and the seeds agree. It reverses #2557's head-to-head-first rule,
  // and lists persisted in either order exist, so when BOTH are configured points for takes
  // head-to-head's slot. A list that omits either is left without it. A commissioner who wants
  // head-to-head first sets their own order (`customTiebreakers`), which is applied as chosen.
  const h2hIndex = ordered.indexOf('head_to_head')
  const pfIndex = ordered.indexOf('points_for')
  if (pfIndex > h2hIndex && h2hIndex >= 0) {
    ordered.splice(pfIndex, 1)
    ordered.splice(h2hIndex, 0, 'points_for')
  }
  return Array.from(new Set(['win_pct', ...ordered, 'roster_id']))
}

function resolveSettings(input: {
  rules: NflRedraftPlayoffRulesInput
  teamCount: number
}): NflRedraftPlayoffSettings {
  const configuredTeams = intOrNull(input.rules.playoffs.teamCount)
  const playoffTeamCount = Math.max(2, Math.min(configuredTeams ?? Math.min(6, input.teamCount), input.teamCount))
  const regularSeasonEndWeek =
    intOrNull(input.rules.schedule.regularSeasonLength) ??
    (intOrNull(input.rules.playoffs.startWeek) != null ? Math.max(1, intOrNull(input.rules.playoffs.startWeek)! - 1) : null) ??
    14
  const playoffStartWeek =
    intOrNull(input.rules.playoffs.startWeek) ??
    intOrNull(input.rules.schedule.playoffTransitionPoint) ??
    regularSeasonEndWeek + 1
  const bracketSize = nextPowerOfTwo(playoffTeamCount)
  const calculatedByes = bracketSize - playoffTeamCount
  const configuredByes = intOrNull(input.rules.playoffs.firstRoundByes)
  const firstRoundByes = Math.max(0, Math.min(configuredByes ?? calculatedByes, calculatedByes))
  const storedPlan = parseStoredByePlan(input.rules.playoffs.byePlan, playoffTeamCount)
  const byePlan = storedPlan && !isNaturalByePlan(playoffTeamCount, storedPlan) ? storedPlan : null
  const planCheck = byePlan ? checkByePlan(playoffTeamCount, byePlan) : null
  const roundCount = planCheck?.ok ? planCheck.roundCount : Math.max(1, Math.ceil(Math.log2(bracketSize)))
  const tiebreakers = normalizeTiebreakers(input.rules)
  const explicitDivisionRule = input.rules.playoffs.divisionPlayoffRule
  const divisionRule: 'top_seeds' | 'guaranteed' | 'none' =
    explicitDivisionRule === 'top_seeds' || explicitDivisionRule === 'guaranteed' || explicitDivisionRule === 'none'
      ? explicitDivisionRule
      : includesToken(input.rules.playoffs.seedingRules, 'division') ||
          tiebreakers.includes('division_winners') ||
          tiebreakers.includes('division_record')
        ? 'guaranteed'
        : 'none'
  // Toilet bowl first: the settings reader makes the two exclusive, and a ruleset carrying both is read
  // the way the standings screen labels it (`readPlayoffFormat`).
  const lowerBracket: NflRedraftLowerBracketMode = input.rules.playoffs.toiletBowlEnabled
    ? 'toilet_bowl'
    : input.rules.playoffs.consolationBracketEnabled
      ? 'consolation'
      : 'none'
  const supportWarnings: string[] = []
  if (playoffTeamCount > 16) supportWarnings.push('Playoff brackets above 16 teams are not supported by the G40 runtime.')
  if (input.teamCount < 2) supportWarnings.push('At least two teams are required for playoff generation.')
  return {
    playoffTeamCount,
    regularSeasonEndWeek,
    playoffStartWeek,
    bracketSize,
    firstRoundByes: planCheck?.ok ? planCheck.byeSeeds.length : firstRoundByes,
    roundCount,
    byePlan,
    // `seedingRules: 'reseed'` is how the in-app playoff panel saves "Re-seed" (the `playoffSeedingRule`
    // column); it used to be stored and read straight past, because only `reseedBehavior` was checked.
    reseedAfterEachRound:
      byePlan != null ||
      includesToken(input.rules.playoffs.reseedBehavior, 'reseed') ||
      normalizedText(input.rules.playoffs.seedingRules) === 'reseed',
    consolationEnabled: lowerBracket === 'consolation',
    toiletBowlEnabled: lowerBracket === 'toilet_bowl',
    lowerBracket,
    thirdPlaceGameEnabled: Boolean(input.rules.playoffs.thirdPlaceGameEnabled),
    divisionWinnersEnabled: divisionRule !== 'none',
    divisionWinnersTopSeeds: divisionRule === 'top_seeds',
    pointsOnlySeeding: isPointsOnlySeeding(input.rules.playoffs.seedingRules),
    tiebreakers,
    customTiebreakers: customOrder(input.rules),
    supported: supportWarnings.length === 0,
    supportWarnings,
  }
}

function recordString(row: Pick<NflRedraftPlayoffTeamState, 'wins' | 'losses' | 'ties'>): string {
  return row.ties > 0 ? `${row.wins}-${row.losses}-${row.ties}` : `${row.wins}-${row.losses}`
}

function normalizeTeam(input: NflRedraftPlayoffTeamInput): NflRedraftPlayoffTeamState {
  const wins = Math.max(0, intOrNull(input.wins) ?? 0)
  const losses = Math.max(0, intOrNull(input.losses) ?? 0)
  const ties = Math.max(0, intOrNull(input.ties) ?? 0)
  const divisionWins = Math.max(0, intOrNull(input.divisionWins) ?? 0)
  const divisionLosses = Math.max(0, intOrNull(input.divisionLosses) ?? 0)
  const divisionTies = Math.max(0, intOrNull(input.divisionTies) ?? 0)
  const games = wins + losses + ties
  const divisionGames = divisionWins + divisionLosses + divisionTies
  const winPct = games > 0 ? round3((wins + ties * 0.5) / games) : 0
  const divisionWinPct = divisionGames > 0 ? round3((divisionWins + divisionTies * 0.5) / divisionGames) : 0
  return {
    rosterId: input.rosterId,
    displayName: displayName(input),
    ownerId: input.ownerId ?? null,
    ownerName: input.ownerName ?? null,
    divisionId: input.divisionId ?? null,
    divisionName: input.divisionName ?? null,
    wins,
    losses,
    ties,
    pointsFor: round2(numberOrZero(input.pointsFor)),
    pointsAgainst: round2(numberOrZero(input.pointsAgainst)),
    divisionWins,
    divisionLosses,
    divisionTies,
    winPct,
    divisionWinPct,
    playoffSeed: input.playoffSeed ?? null,
    qualified: false,
    qualifiedBy: null,
    eliminated: Boolean(input.isEliminated),
    tiebreakerValues: {},
  }
}

/**
 * Win percentage for RANKING: unrounded. `winPct` is rounded to three places for display, and ranking
 * on it called two different records equal — in an odd-team median league, where teams play different
 * numbers of games, 22-23 (.48889) and 22-23-1 (.48913) both read .489 and the next key (points for)
 * seeded the worse record first, while the standings engine (exact) ranked them the right way round.
 * Equal records still compare equal: the same ratio divides to the same double.
 */
function exactWinPct(team: Pick<NflRedraftPlayoffTeamState, 'wins' | 'losses' | 'ties'>): number {
  const games = team.wins + team.losses + team.ties
  return games > 0 ? (team.wins + team.ties * 0.5) / games : 0
}

/** Values that need more than the team row: the all-play share and the season's coin-flip draw. */
type TiebreakerContext = { allPlay: Map<string, number>; coinSeed: string }

const EMPTY_CONTEXT: TiebreakerContext = { allPlay: new Map(), coinSeed: '' }

function tiebreakerValue(team: NflRedraftPlayoffTeamState, key: string, ctx: TiebreakerContext = EMPTY_CONTEXT): number | string {
  switch (key) {
    case 'all_play':
      return ctx.allPlay.get(team.rosterId) ?? 0
    case 'coin_flip':
      return coinFlipDraw(ctx.coinSeed, team.rosterId)
    case 'win_pct':
    case 'winning_percentage':
      return exactWinPct(team)
    case 'wins':
      return team.wins
    case 'losses':
      return -team.losses
    case 'division_record':
    case 'division_win_pct':
      return team.divisionWinPct
    case 'division_wins':
      return team.divisionWins
    case 'points_for':
    case 'pf':
      return team.pointsFor
    case 'points_against':
    case 'pa':
      return -team.pointsAgainst
    case 'roster_id':
      return team.rosterId
    default:
      // `head_to_head` is group-relative and handled in `rankTeams`; unknown keys are inert.
      return 0
  }
}

const HEAD_TO_HEAD_KEYS = new Set(['head_to_head', 'h2h'])

/** Head-to-head results between pairs of teams: `index.get(a)?.get(b)` is a's record vs b. */
export type HeadToHeadIndex = Map<string, Map<string, { wins: number; losses: number; ties: number }>>

export function buildHeadToHeadIndex(
  matchups: NflRedraftRegularSeasonMatchupInput[] | null | undefined,
  regularSeasonEndWeek: number | null,
): HeadToHeadIndex {
  const index: HeadToHeadIndex = new Map()
  const bump = (a: string, b: string, outcome: 'wins' | 'losses' | 'ties') => {
    let row = index.get(a)
    if (!row) {
      row = new Map()
      index.set(a, row)
    }
    const record = row.get(b) ?? { wins: 0, losses: 0, ties: 0 }
    record[outcome] += 1
    row.set(b, record)
  }
  for (const matchup of matchups ?? []) {
    const home = matchup.homeRosterId
    const away = matchup.awayRosterId
    if (!home || !away || home === away) continue
    if (matchup.isMedianMatchup) continue
    if (matchup.type != null && normalizedText(matchup.type) !== 'regular') continue
    if (!COMPLETE_STATUSES.has(normalizedText(matchup.status))) continue
    const week = intOrNull(matchup.week)
    if (regularSeasonEndWeek != null && week != null && week > regularSeasonEndWeek) continue
    const homeScore = numberOrZero(matchup.homeScore)
    const awayScore = numberOrZero(matchup.awayScore)
    if (homeScore > awayScore) {
      bump(home, away, 'wins')
      bump(away, home, 'losses')
    } else if (awayScore > homeScore) {
      bump(away, home, 'wins')
      bump(home, away, 'losses')
    } else {
      bump(home, away, 'ties')
      bump(away, home, 'ties')
    }
  }
  return index
}

/** Each counted regular-season week's points by roster, for the `all_play` tiebreaker — the same rows head-to-head counts. */
export function regularSeasonWeekScores(
  matchups: NflRedraftRegularSeasonMatchupInput[] | null | undefined,
  regularSeasonEndWeek: number | null,
): Map<number, Map<string, number>> {
  const weeks = new Map<number, Map<string, number>>()
  for (const matchup of matchups ?? []) {
    const home = matchup.homeRosterId
    const away = matchup.awayRosterId
    const week = intOrNull(matchup.week)
    if (!home || !away || home === away || week == null) continue
    if (matchup.isMedianMatchup) continue
    if (matchup.type != null && normalizedText(matchup.type) !== 'regular') continue
    if (!COMPLETE_STATUSES.has(normalizedText(matchup.status))) continue
    if (regularSeasonEndWeek != null && week > regularSeasonEndWeek) continue
    const row = weeks.get(week) ?? new Map<string, number>()
    row.set(home, numberOrZero(matchup.homeScore))
    row.set(away, numberOrZero(matchup.awayScore))
    weeks.set(week, row)
  }
  return weeks
}

/**
 * Head-to-head score of each team WITHIN a group still tied on every earlier key.
 *
 * Rule chosen (the "sweep" rule the NFL uses for 3+ team ties):
 * - a team with a winning head-to-head record (> .500, ties half) against EVERY other team in the
 *   group scores +1 and ranks first;
 * - a team with a losing record against every other team scores -1 and ranks last;
 * - everyone else scores 0. A team that never played some member of the group can neither sweep
 *   it nor be swept by it.
 * For two teams this is simply "better head-to-head record wins"; a split or unplayed series is a
 * tie. Teams left equal fall through to the NEXT configured key — head-to-head is NOT re-applied
 * to the remaining teams after a sweeper is removed.
 */
function headToHeadScores(group: NflRedraftPlayoffTeamState[], index: HeadToHeadIndex): Map<string, number> {
  const scores = new Map<string, number>()
  for (const team of group) {
    let beatAll = true
    let lostToAll = true
    for (const other of group) {
      if (other.rosterId === team.rosterId) continue
      const record = index.get(team.rosterId)?.get(other.rosterId)
      const games = record ? record.wins + record.losses + record.ties : 0
      const pct = record && games > 0 ? (record.wins + record.ties * 0.5) / games : 0.5
      if (!(games > 0 && pct > 0.5)) beatAll = false
      if (!(games > 0 && pct < 0.5)) lostToAll = false
    }
    scores.set(team.rosterId, group.length > 1 && beatAll ? 1 : group.length > 1 && lostToAll ? -1 : 0)
  }
  return scores
}

function finalFallback(a: NflRedraftPlayoffTeamState, b: NflRedraftPlayoffTeamState): number {
  return a.displayName.localeCompare(b.displayName) || a.rosterId.localeCompare(b.rosterId)
}

/**
 * Rank teams by the tiebreaker list one key at a time: sort on the key, then re-rank only the
 * groups still tied on it with the remaining keys. Group-aware ranking is required because
 * head-to-head depends on WHICH teams are tied, which a pairwise comparator cannot know.
 * `h2hOut` receives each team's head-to-head score from the group it was ranked in.
 */
function rankTeams(
  teams: NflRedraftPlayoffTeamState[],
  tiebreakers: string[],
  h2h: HeadToHeadIndex,
  h2hOut?: Map<string, number>,
  ctx: TiebreakerContext = EMPTY_CONTEXT,
): NflRedraftPlayoffTeamState[] {
  const rank = (group: NflRedraftPlayoffTeamState[], keyIndex: number): NflRedraftPlayoffTeamState[] => {
    if (group.length <= 1) return group
    if (keyIndex >= tiebreakers.length) return [...group].sort(finalFallback)
    const key = tiebreakers[keyIndex]
    let valueOf: (team: NflRedraftPlayoffTeamState) => number | string
    if (HEAD_TO_HEAD_KEYS.has(key)) {
      const scores = headToHeadScores(group, h2h)
      for (const [rosterId, score] of scores) h2hOut?.set(rosterId, score)
      valueOf = (team) => scores.get(team.rosterId) ?? 0
    } else {
      valueOf = (team) => tiebreakerValue(team, key, ctx)
    }
    const valued = group.map((team) => ({ team, value: valueOf(team) }))
    valued.sort((a, b) => {
      if (typeof a.value === 'number' && typeof b.value === 'number') return b.value - a.value
      if (typeof a.value === 'string' && typeof b.value === 'string') return a.value.localeCompare(b.value)
      return 0
    })
    const out: NflRedraftPlayoffTeamState[] = []
    let i = 0
    while (i < valued.length) {
      let j = i + 1
      while (j < valued.length && valued[j].value === valued[i].value) j += 1
      out.push(...rank(valued.slice(i, j).map((row) => row.team), keyIndex + 1))
      i = j
    }
    return out
  }
  return rank(teams, 0)
}

function seedTeams(
  teams: NflRedraftPlayoffTeamState[],
  settings: NflRedraftPlayoffSettings,
  h2h: HeadToHeadIndex = new Map(),
  ctx: TiebreakerContext = EMPTY_CONTEXT,
): {
  teams: NflRedraftPlayoffTeamState[]
  seeds: NflRedraftPlayoffSeedState[]
  bubbleRosterIds: string[]
  eliminatedRosterIds: string[]
} {
  const h2hScores = new Map<string, number>()
  const sorted = rankTeams(teams, settings.tiebreakers, h2h, h2hScores, ctx)
  const ranked = (subset: NflRedraftPlayoffTeamState[]) => rankTeams(subset, settings.tiebreakers, h2h, undefined, ctx)
  const selectedRosterIds: string[] = []
  const qualifiedBy = new Map<string, NflRedraftPlayoffQualifiedBy>()

  if (settings.divisionWinnersEnabled) {
    const byDivision = new Map<string, NflRedraftPlayoffTeamState[]>()
    for (const team of sorted) {
      if (!team.divisionId) continue
      byDivision.set(team.divisionId, [...(byDivision.get(team.divisionId) ?? []), team])
    }
    const divisionWinners = ranked([...byDivision.values()].map((members) => ranked(members)[0]))
    for (const team of divisionWinners) {
      if (selectedRosterIds.length >= settings.playoffTeamCount) break
      selectedRosterIds.push(team.rosterId)
      qualifiedBy.set(team.rosterId, 'division')
    }
  }

  for (const team of sorted) {
    if (selectedRosterIds.length >= settings.playoffTeamCount) break
    if (selectedRosterIds.includes(team.rosterId)) continue
    selectedRosterIds.push(team.rosterId)
    qualifiedBy.set(team.rosterId, selectedRosterIds.length <= settings.playoffTeamCount ? 'wildcard' : 'standings')
  }

  const selectedSet = new Set(selectedRosterIds)
  // Top seeds: the division winners first, ranked among themselves, then the wildcards by record.
  // Guaranteed: the winners only had their place held; the whole field is seeded by record.
  const winnersFirst = settings.divisionWinnersTopSeeds
    ? [
        ...ranked(sorted.filter((team) => qualifiedBy.get(team.rosterId) === 'division')),
        ...ranked(sorted.filter((team) => selectedSet.has(team.rosterId) && qualifiedBy.get(team.rosterId) !== 'division')),
      ]
    : null
  const selected = winnersFirst ?? ranked(sorted.filter((team) => selectedSet.has(team.rosterId)))

  const seededTeams = [...selected, ...sorted.filter((team) => !selectedSet.has(team.rosterId))]
  const teamsWithSeeds = seededTeams.map((team, index) => {
    const seed = selectedSet.has(team.rosterId) ? index + 1 : null
    const tiebreakerValues = Object.fromEntries(
      settings.tiebreakers.map((key) => [
        key,
        HEAD_TO_HEAD_KEYS.has(key) ? h2hScores.get(team.rosterId) ?? 0 : tiebreakerValue(team, key, ctx),
      ]),
    )
    return {
      ...team,
      playoffSeed: seed,
      qualified: seed != null,
      qualifiedBy: seed != null ? qualifiedBy.get(team.rosterId) ?? 'standings' : null,
      eliminated: seed == null || team.eliminated,
      tiebreakerValues,
    }
  })

  const seeds = teamsWithSeeds
    .filter((team) => team.playoffSeed != null)
    .sort((a, b) => (a.playoffSeed ?? 999) - (b.playoffSeed ?? 999))
    .map((team) => ({
      seed: team.playoffSeed!,
      rosterId: team.rosterId,
      displayName: team.displayName,
      qualifiedBy: team.qualifiedBy ?? 'standings',
      wins: team.wins,
      losses: team.losses,
      ties: team.ties,
      winPct: team.winPct,
      pointsFor: team.pointsFor,
      pointsAgainst: team.pointsAgainst,
      divisionRecord: team.divisionId ? recordString({ wins: team.divisionWins, losses: team.divisionLosses, ties: team.divisionTies }) : null,
      tiebreakerValues: team.tiebreakerValues,
    }))

  const bubbleStart = Math.max(0, settings.playoffTeamCount - 2)
  const bubbleEnd = Math.min(teamsWithSeeds.length, settings.playoffTeamCount + 2)
  return {
    teams: teamsWithSeeds,
    seeds,
    bubbleRosterIds: teamsWithSeeds.slice(bubbleStart, bubbleEnd).map((team) => team.rosterId),
    eliminatedRosterIds: teamsWithSeeds.filter((team) => !team.qualified).map((team) => team.rosterId),
  }
}

function normalizeStatus(value: unknown): NflRedraftPlayoffMatchupStatus {
  const raw = normalizedText(value)
  if (raw === 'bye') return 'bye'
  if (COMPLETE_STATUSES.has(raw)) return 'final'
  if (CANCELLED_STATUSES.has(raw)) return 'cancelled'
  if (raw === 'active' || raw === 'in_progress' || raw === 'live') return 'active'
  return 'scheduled'
}

/**
 * A game whose result is settled: a bye, or a stored winner. A `final` row with scores but no winner is
 * NOT — the advance writes the winner, and until it has run the round is still being played.
 *
 * 🛑 READING `complete` HERE STRANDED EVERY SHORT LOWER BRACKET. A lower bracket shorter than the title
 * bracket (10 teams: 3 title rounds, 2 lower) starts at championship round 2, so its first round is
 * stored `pending`. The round scorer writes its games `final` with scores and no winner, and on the next
 * read `normalizeMatchup` calls a `final` row complete — so the pending round derived as `completed`
 * with no winners, the advance skipped to the empty lower final, the finalizer refused with
 * LOWER_BRACKET_INCOMPLETE, and the season never ended. Found by the NBA/NHL full-season simulation.
 */
function matchupDecided(matchup: NflRedraftPlayoffMatchupState): boolean {
  return matchup.status === 'bye' || matchup.bye || Boolean(matchup.winnerRosterId)
}

function normalizeRoundStatus(value: unknown, matchups: NflRedraftPlayoffMatchupState[]): NflRedraftPlayoffRoundStatus {
  const raw = normalizedText(value)
  if (raw === 'active') return 'active'
  if (raw === 'completed' || raw === 'complete') return 'completed'
  if (raw === 'cancelled' || raw === 'canceled') return 'cancelled'
  // Derived only from settled games: a stored-`pending` round whose games were scored `final` but never
  // advanced (the lower-bracket generation bug above) must read as still in play, or it is skipped for good.
  if (matchups.length > 0 && matchups.every(matchupDecided)) return 'completed'
  return 'pending'
}

function bracketType(value: unknown): NflRedraftPlayoffBracketType {
  const raw = normalizedText(value)
  if (raw === 'consolation') return 'consolation'
  if (raw === 'third_place' || raw === 'third-place') return 'third_place'
  return 'championship'
}

function rosterSeed(seedByRosterId: Map<string, number>, rosterId: string | null | undefined): number | null {
  return rosterId ? seedByRosterId.get(rosterId) ?? null : null
}

function loserFor(matchup: Pick<NflRedraftPlayoffMatchupState, 'homeRosterId' | 'awayRosterId' | 'winnerRosterId'>): string | null {
  if (!matchup.winnerRosterId) return null
  if (matchup.homeRosterId === matchup.winnerRosterId) return matchup.awayRosterId ?? null
  if (matchup.awayRosterId === matchup.winnerRosterId) return matchup.homeRosterId ?? null
  return null
}

function normalizeMatchup(input: NflRedraftPlayoffMatchupInput, seedByRosterId: Map<string, number>): NflRedraftPlayoffMatchupState {
  const type = bracketType(input.bracketType ?? input.metadata?.bracketType)
  const roundNumber = Math.max(1, intOrNull(input.roundNumber) ?? 1)
  const matchupNumber = Math.max(1, intOrNull(input.matchupNumber) ?? 1)
  const roundName = input.roundName?.trim() || roundNameFor(roundNumber, roundNumber)
  const homeRosterId = input.homeRosterId ?? null
  const awayRosterId = input.awayRosterId ?? null
  const homeSeed = input.homeSeed ?? rosterSeed(seedByRosterId, homeRosterId)
  const awaySeed = input.awaySeed ?? rosterSeed(seedByRosterId, awayRosterId)
  const status = normalizeStatus(input.status)
  const bye = status === 'bye' || Boolean(homeRosterId && !awayRosterId)
  const homeScore = input.homeScore == null ? null : round2(numberOrZero(input.homeScore))
  const awayScore = input.awayScore == null ? null : round2(numberOrZero(input.awayScore))
  const winnerRosterId = input.winnerRosterId ?? (bye ? homeRosterId : null)
  const complete = Boolean(winnerRosterId) || status === 'final' || status === 'bye'
  return {
    matchupId: input.matchupId?.trim() || `${type}:r${roundNumber}:m${matchupNumber}`,
    roundId: input.roundId?.trim() || `${type}:round:${roundNumber}`,
    roundNumber,
    roundName,
    matchupNumber,
    bracketType: type,
    homeRosterId,
    awayRosterId,
    homeSeed,
    awaySeed,
    homeScore,
    awayScore,
    winnerRosterId,
    loserRosterId: loserFor({ homeRosterId, awayRosterId, winnerRosterId }),
    nextMatchupId: input.nextMatchupId ?? null,
    status: bye ? 'bye' : status,
    bye,
    complete,
    metadata: input.metadata ?? {},
  }
}

function groupRounds(matchups: NflRedraftPlayoffMatchupState[], type: NflRedraftPlayoffBracketType): NflRedraftPlayoffRoundState[] {
  const byRound = new Map<number, NflRedraftPlayoffMatchupState[]>()
  for (const matchup of matchups.filter((row) => row.bracketType === type)) {
    const rows = byRound.get(matchup.roundNumber) ?? []
    rows.push(matchup)
    byRound.set(matchup.roundNumber, rows)
  }
  return [...byRound.entries()]
    .sort(([a], [b]) => a - b)
    .map(([roundNumber, rows]) => {
      const sorted = rows.sort((a, b) => a.matchupNumber - b.matchupNumber)
      return {
        roundId: sorted[0]?.roundId ?? `${type}:round:${roundNumber}`,
        roundNumber,
        roundName: sorted[0]?.roundName ?? roundNameFor(roundNumber, byRound.size),
        bracketType: type,
        status: normalizeRoundStatus(sorted[0]?.metadata.roundStatus, sorted),
        matchups: sorted,
      }
    })
}

function bracketStatus(value: unknown, rounds: NflRedraftPlayoffRoundState[]): NflRedraftPlayoffBracketStatus {
  const raw = normalizedText(value)
  if (raw === 'complete' || raw === 'completed') return 'complete'
  if (raw === 'locked') return 'locked'
  if (raw === 'active') return 'active'
  if (raw === 'pending') return 'pending'
  if (rounds.length > 0) return rounds.some((round) => round.status === 'active') ? 'active' : 'pending'
  return 'not_generated'
}

function roundNameFor(roundNumber: number, roundCount: number): string {
  if (roundNumber >= roundCount) return 'Championship'
  if (roundNumber === roundCount - 1) return 'Semifinal'
  if (roundNumber === 1 && roundCount === 3) return 'Quarterfinal'
  return `Round ${roundNumber}`
}

function generatedSeedPairs(bracketSize: number): Array<[number, number]> {
  if (bracketSize <= 2) return [[1, 2]]
  const previous = generatedSeedPairs(bracketSize / 2)
  const pairs: Array<[number, number]> = []
  for (const [a, b] of previous) {
    pairs.push([a, bracketSize + 1 - a])
    pairs.push([b, bracketSize + 1 - b])
  }
  return pairs
}

function buildGeneratedRounds(input: {
  seeds: NflRedraftPlayoffSeedState[]
  settings: NflRedraftPlayoffSettings
  bracketType: NflRedraftPlayoffBracketType
}): NflRedraftPlayoffRoundState[] {
  const seedToRoster = new Map(input.seeds.map((seed) => [seed.seed, seed.rosterId]))
  if (input.settings.byePlan) return buildByePlanRounds({ ...input, seedToRoster, byePlan: input.settings.byePlan })
  const roundCount = input.settings.roundCount
  const pairs = generatedSeedPairs(input.settings.bracketSize)
  const rounds: NflRedraftPlayoffRoundState[] = []
  let previousMatchupIds: string[] = []

  for (let roundNumber = 1; roundNumber <= roundCount; roundNumber += 1) {
    const matchupCount = roundNumber === 1 ? pairs.length : Math.max(1, previousMatchupIds.length / 2)
    const roundName = roundNameFor(roundNumber, roundCount)
    const matchups: NflRedraftPlayoffMatchupState[] = []
    for (let index = 0; index < matchupCount; index += 1) {
      const pair = pairs[index] ?? [null, null]
      const homeSeed = roundNumber === 1 && pair[0] ? pair[0] : null
      const awaySeed = roundNumber === 1 && pair[1] ? pair[1] : null
      const homeRosterId = homeSeed ? seedToRoster.get(homeSeed) ?? null : null
      const awayRosterId = awaySeed ? seedToRoster.get(awaySeed) ?? null : null
      const bye = roundNumber === 1 && Boolean(homeRosterId && !awayRosterId)
      const matchupId = `${input.bracketType}:r${roundNumber}:m${index + 1}`
      matchups.push({
        matchupId,
        roundId: `${input.bracketType}:round:${roundNumber}`,
        roundNumber,
        roundName,
        matchupNumber: index + 1,
        bracketType: input.bracketType,
        homeRosterId,
        awayRosterId,
        homeSeed,
        awaySeed,
        homeScore: null,
        awayScore: null,
        winnerRosterId: bye ? homeRosterId : null,
        loserRosterId: null,
        nextMatchupId: null,
        status: bye ? 'bye' : 'scheduled',
        bye,
        complete: bye,
        metadata: bye ? { autoAdvance: true } : {},
      })
    }

    if (previousMatchupIds.length > 0) {
      previousMatchupIds.forEach((previousId, index) => {
        const target = matchups[Math.floor(index / 2)]
        const previous = rounds[rounds.length - 1]?.matchups.find((matchup) => matchup.matchupId === previousId)
        if (previous && target) previous.nextMatchupId = target.matchupId
      })
    }

    rounds.push({
      roundId: `${input.bracketType}:round:${roundNumber}`,
      roundNumber,
      roundName,
      bracketType: input.bracketType,
      status: roundNumber === 1 ? 'active' : 'pending',
      matchups,
    })
    previousMatchupIds = matchups.map((matchup) => matchup.matchupId)
  }
  return rounds
}

/** Seeds whose bye ends at `roundNumber`, i.e. who play their first game in it. */
function seedsEnteringRound(byePlan: readonly number[], roundNumber: number): number[] {
  return byePlan.flatMap((off, i) => (off === roundNumber - 1 ? [i + 1] : []))
}

/** Best remaining vs worst remaining. */
function pairBestVsWorst<T>(sorted: T[]): Array<[T, T]> {
  const pairs: Array<[T, T]> = []
  for (let i = 0; i < Math.floor(sorted.length / 2); i += 1) pairs.push([sorted[i], sorted[sorted.length - 1 - i]])
  return pairs
}

/**
 * Rounds for a commissioner bye plan. Round 1 is paired now from the seeds that play in it; later
 * rounds are empty slots sized by the plan and filled by `fillNextRound` as winners come in. No
 * `nextMatchupId` links: the plan re-pairs every round, so no game feeds a fixed slot.
 */
function buildByePlanRounds(input: {
  seeds: NflRedraftPlayoffSeedState[]
  settings: NflRedraftPlayoffSettings
  bracketType: NflRedraftPlayoffBracketType
  seedToRoster: Map<number, string>
  byePlan: number[]
}): NflRedraftPlayoffRoundState[] {
  const plan = checkByePlan(input.byePlan.length, input.byePlan)
  if (!plan.ok) return []
  // A play-in (lib/playoff-brackets/playIn.ts): round 1 is the play-in week, and the rounds after it
  // keep the names of the normal bracket it leads into.
  const playIn = detectPlayIn(input.byePlan.length, input.byePlan)
  return plan.rounds.map((planRound) => {
    const roundName = playIn
      ? planRound.round === 1
        ? 'Play-in'
        : roundNameFor(planRound.round - 1, plan.roundCount - 1)
      : roundNameFor(planRound.round, plan.roundCount)
    const firstPairs = planRound.round === 1 ? pairBestVsWorst(planRound.entering) : []
    const matchups: NflRedraftPlayoffMatchupState[] = Array.from({ length: planRound.games }, (_, index) => {
      const [homeSeed, awaySeed] = firstPairs[index] ?? [null, null]
      return {
        matchupId: `${input.bracketType}:r${planRound.round}:m${index + 1}`,
        roundId: `${input.bracketType}:round:${planRound.round}`,
        roundNumber: planRound.round,
        roundName,
        matchupNumber: index + 1,
        bracketType: input.bracketType,
        homeRosterId: homeSeed ? input.seedToRoster.get(homeSeed) ?? null : null,
        awayRosterId: awaySeed ? input.seedToRoster.get(awaySeed) ?? null : null,
        homeSeed,
        awaySeed,
        homeScore: null,
        awayScore: null,
        winnerRosterId: null,
        loserRosterId: null,
        nextMatchupId: null,
        status: 'scheduled',
        bye: false,
        complete: false,
        metadata: { byePlan: true, enteringSeeds: planRound.entering },
      }
    })
    return {
      roundId: `${input.bracketType}:round:${planRound.round}`,
      roundNumber: planRound.round,
      roundName,
      bracketType: input.bracketType,
      status: planRound.round === 1 ? 'active' : 'pending',
      matchups,
    }
  })
}

/** The standings place of every team, 1 = best: `state.teams` is already in seeding order. */
function standingRanks(teams: NflRedraftPlayoffTeamState[]): Map<string, number> {
  return new Map(teams.map((team, index) => [team.rosterId, index + 1]))
}

function lowerBracketRoundName(mode: NflRedraftLowerBracketMode, round: number, roundCount: number): string {
  const label = mode === 'toilet_bowl' ? 'Toilet Bowl' : 'Consolation'
  if (round >= roundCount) return `${label} Final`
  if (round === roundCount - 1) return `${label} Semifinal`
  return `${label} Round ${round}`
}

/**
 * The lower bracket for the teams that missed the playoffs, played to a final.
 *
 * - **Field.** At most `2^championshipRounds` teams, so it fits in the weeks the playoffs already
 *   use: a consolation bracket takes the BEST non-playoff teams, a toilet bowl the WORST. Anyone
 *   left over plays no lower-bracket game.
 * - **Rounds line up with the END of the championship bracket.** A lower bracket of `k` rounds plays
 *   its round `j` alongside championship round `R - k + j`, so its final shares the championship's
 *   weeks (and its `championship_length`). The round number stored is that championship round, so
 *   "which weeks" stays the one rule in `playoffRoundWeeks`.
 * - **Seeds and byes.** The field is paired with the same fixed tree as the title bracket. In a
 *   consolation bracket the best team is lower seed 1, so byes go to the best teams. In a toilet bowl
 *   lower seed 1 is the WORST team, so its byes go to the worst — a bye there is a step toward last.
 * - **The seed columns carry the standings place**, which settles a tied score the way the title
 *   bracket does (better place wins). In a toilet bowl the team that "loses" the tie advances, so the
 *   worse team moves on, which is the same rule read the other way.
 */
function buildLowerBracketRounds(input: {
  teams: NflRedraftPlayoffTeamState[]
  settings: NflRedraftPlayoffSettings
  championshipRoundCount: number
}): NflRedraftPlayoffRoundState[] {
  const mode = input.settings.lowerBracket
  if (mode === 'none' || input.championshipRoundCount < 1) return []
  const ranks = standingRanks(input.teams)
  const nonPlayoff = input.teams.filter((team) => !team.qualified)
  const cap = 2 ** input.championshipRoundCount
  const field = mode === 'toilet_bowl' ? nonPlayoff.slice(-cap).reverse() : nonPlayoff.slice(0, cap)
  if (field.length < 2) return []
  const size = nextPowerOfTwo(field.length)
  const roundCount = Math.round(Math.log2(size))
  const offset = input.championshipRoundCount - roundCount
  const pairs = generatedSeedPairs(size)
  const rounds: NflRedraftPlayoffRoundState[] = []
  for (let lowerRound = 1; lowerRound <= roundCount; lowerRound += 1) {
    const roundNumber = offset + lowerRound
    const roundId = `consolation:round:${roundNumber}`
    const roundName = lowerBracketRoundName(mode, lowerRound, roundCount)
    const count = size / 2 ** lowerRound
    const matchups: NflRedraftPlayoffMatchupState[] = Array.from({ length: count }, (_, index) => {
      const [homeLower, awayLower] = lowerRound === 1 ? pairs[index] : [0, 0]
      const home = homeLower ? field[homeLower - 1] ?? null : null
      const away = awayLower ? field[awayLower - 1] ?? null : null
      const bye = lowerRound === 1 && Boolean(home && !away)
      return {
        matchupId: `consolation:r${roundNumber}:m${index + 1}`,
        roundId,
        roundNumber,
        roundName,
        matchupNumber: index + 1,
        bracketType: 'consolation',
        homeRosterId: home?.rosterId ?? null,
        awayRosterId: away?.rosterId ?? null,
        homeSeed: home ? ranks.get(home.rosterId) ?? null : null,
        awaySeed: away ? ranks.get(away.rosterId) ?? null : null,
        homeScore: null,
        awayScore: null,
        winnerRosterId: bye ? home?.rosterId ?? null : null,
        loserRosterId: null,
        nextMatchupId: null,
        status: bye ? 'bye' : 'scheduled',
        bye,
        complete: bye,
        metadata: { lowerBracket: mode, lowerRound, lowerRoundCount: roundCount, ...(bye ? { autoAdvance: true } : {}) },
      }
    })
    const previous = rounds[rounds.length - 1]
    previous?.matchups.forEach((matchup, index) => {
      matchup.nextMatchupId = matchups[Math.floor(index / 2)]?.matchupId ?? null
    })
    rounds.push({
      roundId,
      roundNumber,
      roundName,
      bracketType: 'consolation',
      status: roundNumber === 1 ? 'active' : 'pending',
      matchups,
    })
  }
  return rounds
}

/** Games in a round that two teams play — what produces a loser. */
function contestedCount(round: NflRedraftPlayoffRoundState | undefined): number {
  return round ? round.matchups.filter((matchup) => !matchup.bye).length : 0
}

/**
 * The third-place game: the two semifinal losers, in the championship round, so it is played and
 * scored over exactly the final's weeks (and `championship_length`).
 *
 * It exists only when the semifinal round has TWO games. A 3-team field (one semifinal and a bye)
 * or a bye plan that seats a team in the final has one semifinal loser; that team simply finishes
 * third, and there is no game to play. A 2-team field has no semifinal at all.
 */
function buildThirdPlaceMatchup(input: {
  rounds: NflRedraftPlayoffRoundState[]
  settings: NflRedraftPlayoffSettings
}): NflRedraftPlayoffMatchupState | null {
  if (!input.settings.thirdPlaceGameEnabled || input.rounds.length < 2) return null
  const finalRound = input.rounds[input.rounds.length - 1]
  const semifinal = input.rounds[input.rounds.length - 2]
  if (contestedCount(semifinal) !== 2) return null
  return {
    matchupId: `third_place:r${finalRound.roundNumber}:m1`,
    roundId: finalRound.roundId,
    roundNumber: finalRound.roundNumber,
    roundName: 'Third Place',
    matchupNumber: finalRound.matchups.length + 1,
    bracketType: 'third_place',
    homeRosterId: null,
    awayRosterId: null,
    homeSeed: null,
    awaySeed: null,
    homeScore: null,
    awayScore: null,
    winnerRosterId: null,
    loserRosterId: null,
    nextMatchupId: null,
    status: 'scheduled',
    bye: false,
    complete: false,
    metadata: {},
  }
}

function activeChampionshipRound(rounds: NflRedraftPlayoffRoundState[]): NflRedraftPlayoffRoundState | null {
  return rounds.find((round) => round.status === 'active') ?? rounds.find((round) => round.matchups.some((matchup) => !matchupDecided(matchup))) ?? null
}

function resolveWinner(matchup: NflRedraftPlayoffMatchupState): {
  winnerRosterId: string | null
  loserRosterId: string | null
  blockedReason: string | null
} {
  if (matchup.winnerRosterId) {
    return { winnerRosterId: matchup.winnerRosterId, loserRosterId: loserFor(matchup), blockedReason: null }
  }
  if (matchup.bye) {
    return { winnerRosterId: matchup.homeRosterId, loserRosterId: null, blockedReason: null }
  }
  if (!matchup.homeRosterId || !matchup.awayRosterId) {
    return { winnerRosterId: null, loserRosterId: null, blockedReason: 'Matchup is missing one or more teams.' }
  }
  if (matchup.homeScore == null || matchup.awayScore == null) {
    return { winnerRosterId: null, loserRosterId: null, blockedReason: 'Matchup scores are not complete.' }
  }
  if (matchup.homeScore > matchup.awayScore) return { winnerRosterId: matchup.homeRosterId, loserRosterId: matchup.awayRosterId, blockedReason: null }
  if (matchup.awayScore > matchup.homeScore) return { winnerRosterId: matchup.awayRosterId, loserRosterId: matchup.homeRosterId, blockedReason: null }
  if (matchup.homeSeed != null && matchup.awaySeed != null && matchup.homeSeed !== matchup.awaySeed) {
    const homeWinsTie = matchup.homeSeed < matchup.awaySeed
    return {
      winnerRosterId: homeWinsTie ? matchup.homeRosterId : matchup.awayRosterId,
      loserRosterId: homeWinsTie ? matchup.awayRosterId : matchup.homeRosterId,
      blockedReason: null,
    }
  }
  return { winnerRosterId: null, loserRosterId: null, blockedReason: 'Tied playoff score needs commissioner resolution.' }
}

function cloneRound(round: NflRedraftPlayoffRoundState): NflRedraftPlayoffRoundState {
  return { ...round, matchups: round.matchups.map((matchup) => ({ ...matchup, metadata: { ...matchup.metadata } })) }
}

/**
 * The seed each team was given when the bracket was generated, read off the bracket's own rows.
 *
 * 🛑 SEEDS LOCK AT THE PLAYOFF START; RESEEDING ONLY RE-PAIRS. `state.seeds` is recomputed from the
 * standings on every read, so a division reassignment or a tiebreaker edit mid-playoffs would quietly
 * reorder it — and a reseed sorted on it would pair by seeds nobody was given. Every qualifier sits in
 * round 1 (a bye too) with its seed stored at generation, so round order, first sighting wins. A team
 * that first plays later (a commissioner bye plan) falls back to `state.seeds`.
 */
function lockedSeedMap(state: NflRedraftPlayoffRuntimeState, rounds: NflRedraftPlayoffRoundState[]): Map<string, number> {
  const locked = new Map<string, number>()
  for (const round of [...rounds].sort((a, b) => a.roundNumber - b.roundNumber)) {
    for (const matchup of round.matchups) {
      if (matchup.homeRosterId && matchup.homeSeed != null && !locked.has(matchup.homeRosterId)) locked.set(matchup.homeRosterId, matchup.homeSeed)
      if (matchup.awayRosterId && matchup.awaySeed != null && !locked.has(matchup.awayRosterId)) locked.set(matchup.awayRosterId, matchup.awaySeed)
    }
  }
  for (const seed of state.seeds) if (!locked.has(seed.rosterId)) locked.set(seed.rosterId, seed.seed)
  return locked
}

/**
 * The lower bracket's teams, best finish first, from what has been played. A consolation bracket
 * ranks its final's winner first, then each team by the LAST round it played (going out later is
 * better); a toilet bowl is the mirror — a team that escapes earlier finishes higher, and the final's
 * loser is last. Ties within a round go to the better standings place.
 */
function lowerBracketOrder(
  rounds: NflRedraftPlayoffRoundState[],
  mode: NflRedraftLowerBracketMode,
  ranks: Map<string, number>,
): { order: string[]; resultRosterId: string | null } {
  const lastRound = new Map<string, number>()
  for (const round of rounds) {
    for (const matchup of round.matchups) {
      for (const rosterId of [matchup.homeRosterId, matchup.awayRosterId]) {
        if (rosterId) lastRound.set(rosterId, Math.max(lastRound.get(rosterId) ?? 0, round.roundNumber))
      }
    }
  }
  const finalRound = rounds[rounds.length - 1]
  const finalMatchup = finalRound?.matchups.length === 1 ? finalRound.matchups[0] : null
  const finalWinner = finalMatchup?.winnerRosterId ?? null
  const finalLoser = finalMatchup && finalWinner ? loserFor(finalMatchup) : null
  const rank = (id: string) => ranks.get(id) ?? Number.MAX_SAFE_INTEGER
  const order = [...lastRound.keys()].sort((a, b) => {
    if (mode === 'toilet_bowl') {
      return (lastRound.get(a)! - lastRound.get(b)!) || Number(a === finalLoser) - Number(b === finalLoser) || rank(a) - rank(b)
    }
    return Number(b === finalWinner) - Number(a === finalWinner) || (lastRound.get(b)! - lastRound.get(a)!) || rank(a) - rank(b)
  })
  return { order, resultRosterId: mode === 'toilet_bowl' ? finalLoser : finalWinner }
}

/**
 * Every team's finish. 1 and 2 from the final; 3 and 4 from the third-place game when one was
 * played; the other playoff teams by the round they went out in (later is better), then seed. The
 * teams that missed the playoffs follow, ordered by their lower bracket when one was played
 * (`lowerBracketOrder`) and by the standings otherwise.
 */
function finalStandingRows(state: NflRedraftPlayoffRuntimeState, championRosterId: string, runnerUpRosterId: string | null): NflRedraftPlayoffFinalStanding[] {
  const winLoss = new Map<string, { wins: number; losses: number }>()
  const wentOutIn = new Map<string, number>()
  const thirdPlace = state.bracket.thirdPlaceMatchup
  const titleGames = [
    ...state.bracket.rounds.flatMap((round) => round.matchups),
    ...(thirdPlace ? [thirdPlace] : []),
  ]
  for (const matchup of titleGames) {
    const loser = matchup.loserRosterId ?? loserFor(matchup)
    if (matchup.winnerRosterId) {
      const row = winLoss.get(matchup.winnerRosterId) ?? { wins: 0, losses: 0 }
      row.wins += matchup.awayRosterId ? 1 : 0
      winLoss.set(matchup.winnerRosterId, row)
    }
    if (loser) {
      const row = winLoss.get(loser) ?? { wins: 0, losses: 0 }
      row.losses += 1
      winLoss.set(loser, row)
      if (matchup.bracketType === 'championship') wentOutIn.set(loser, matchup.roundNumber)
    }
  }
  const thirdPlaceRosterId = thirdPlace?.winnerRosterId ?? null
  const fourthPlaceRosterId = thirdPlace && thirdPlaceRosterId ? loserFor(thirdPlace) : null
  const placed = [championRosterId, runnerUpRosterId, thirdPlaceRosterId, fourthPlaceRosterId].filter((id): id is string => Boolean(id))
  const playoffTeams = state.teams.filter((team) => team.qualified)
  const byId = new Map(state.teams.map((team) => [team.rosterId, team]))
  const placedTeams = placed.map((id) => byId.get(id)).filter((team): team is NflRedraftPlayoffTeamState => Boolean(team?.qualified))
  const otherPlayoffTeams = playoffTeams
    .filter((team) => !placed.includes(team.rosterId))
    .sort((a, b) => (wentOutIn.get(b.rosterId) ?? 0) - (wentOutIn.get(a.rosterId) ?? 0) || (a.playoffSeed ?? 999) - (b.playoffSeed ?? 999))
  // `state.teams` is already in seeding order (record, head-to-head, ...) from `seedTeams`;
  // re-sorting here would lose head-to-head, which needs the regular-season results.
  const nonPlayoff = state.teams.filter((team) => !team.qualified)
  let nonPlayoffOrdered = nonPlayoff
  if (state.bracket.consolationRounds.length && state.bracket.lowerBracket !== 'none') {
    const { order } = lowerBracketOrder(state.bracket.consolationRounds, state.bracket.lowerBracket, standingRanks(state.teams))
    const inField = new Set(order)
    const field = order.map((id) => byId.get(id)).filter((team): team is NflRedraftPlayoffTeamState => Boolean(team && !team.qualified))
    const rest = nonPlayoff.filter((team) => !inField.has(team.rosterId))
    // A consolation bracket is the best of the rest, so those left out finish below it; a toilet bowl
    // is the worst, so those left out finish above it.
    nonPlayoffOrdered = state.bracket.lowerBracket === 'toilet_bowl' ? [...rest, ...field] : [...field, ...rest]
  }
  const ordered = [...placedTeams, ...otherPlayoffTeams, ...nonPlayoffOrdered]
  return ordered.map((team, index) => {
    const row = winLoss.get(team.rosterId) ?? { wins: 0, losses: team.qualified ? 1 : 0 }
    return {
      finish: index + 1,
      rosterId: team.rosterId,
      displayName: team.displayName,
      seed: team.playoffSeed,
      playoffWins: row.wins,
      playoffLosses: row.losses,
      champion: team.rosterId === championRosterId,
      runnerUp: team.rosterId === runnerUpRosterId,
      thirdPlace: team.rosterId === thirdPlaceRosterId,
    }
  })
}

export function buildPlayoffRuntimeEvent(input: {
  leagueId: string
  type: CanonicalLeagueRuntimeEventType | string
  actorUserId?: string | null
  occurredAt?: Date | string | null
  payload?: Record<string, unknown>
}): CanonicalLeagueRuntimeEvent {
  return toCanonicalLeagueRuntimeEvent({
    leagueId: input.leagueId,
    eventType: input.type,
    actorUserId: input.actorUserId ?? null,
    createdAt: input.occurredAt,
    payload: input.payload ?? {},
  })
}

export function buildNflRedraftPlayoffRuntimeState(input: {
  leagueId: string
  seasonId: string
  season: number
  week: number
  rules: NflRedraftPlayoffRulesInput
  teams: NflRedraftPlayoffTeamInput[]
  matchups?: NflRedraftPlayoffMatchupInput[]
  /** Regular-season results for the `head_to_head` tiebreaker. Omitted → head-to-head never separates teams. */
  regularSeasonMatchups?: NflRedraftRegularSeasonMatchupInput[] | null
  bracketStatus?: string | null
  bracketId?: string | null
  now?: Date
}): NflRedraftPlayoffRuntimeState {
  const now = input.now ?? new Date()
  const settings = resolveSettings({ rules: input.rules, teamCount: input.teams.length })
  const h2h = buildHeadToHeadIndex(input.regularSeasonMatchups, settings.regularSeasonEndWeek)
  const seeded = seedTeams(input.teams.map(normalizeTeam), settings, h2h, {
    allPlay: allPlayShares(regularSeasonWeekScores(input.regularSeasonMatchups, settings.regularSeasonEndWeek)),
    // The standings board seeds the same draw from league + season, so the two never disagree.
    coinSeed: `${input.leagueId}:${input.season}`,
  })
  const seedByRosterId = new Map(seeded.seeds.map((seed) => [seed.rosterId, seed.seed]))
  const normalizedMatchups = (input.matchups ?? []).map((matchup) => normalizeMatchup(matchup, seedByRosterId))
  const championshipRounds = groupRounds(normalizedMatchups, 'championship')
  const consolationRounds = groupRounds(normalizedMatchups, 'consolation')
  const thirdPlaceMatchup = normalizedMatchups.find((matchup) => matchup.bracketType === 'third_place') ?? null
  const storedLowerMode = consolationRounds[0]?.matchups[0]?.metadata.lowerBracket
  // A bracket stored before the mode was recorded was a winners-advance consolation round.
  const lowerBracket: NflRedraftLowerBracketMode = consolationRounds.length
    ? storedLowerMode === 'toilet_bowl' ? 'toilet_bowl' : 'consolation'
    : 'none'
  const status = bracketStatus(input.bracketStatus, championshipRounds)
  const finalRound = championshipRounds[championshipRounds.length - 1]
  const finalMatchup = finalRound?.matchups.find((matchup) => !matchup.nextMatchupId) ?? finalRound?.matchups[0]
  const championRosterId = status === 'complete' ? finalMatchup?.winnerRosterId ?? null : null
  const runnerUpRosterId = championRosterId && finalMatchup ? loserFor({ ...finalMatchup, winnerRosterId: championRosterId }) : null
  const provisionalState = {
    leagueId: input.leagueId,
    seasonId: input.seasonId,
    season: input.season,
    week: input.week,
    generatedAtIso: now.toISOString(),
    settings,
    teams: seeded.teams,
    seeds: seeded.seeds,
    bubbleRosterIds: seeded.bubbleRosterIds,
    eliminatedRosterIds: seeded.eliminatedRosterIds,
    bracket: {
      bracketId: input.bracketId ?? null,
      status,
      locked: status === 'locked' || status === 'complete',
      generated: championshipRounds.length > 0,
      rounds: championshipRounds,
      consolationRounds,
      lowerBracket,
      thirdPlaceMatchup,
      championRosterId,
      runnerUpRosterId,
      thirdPlaceRosterId: championRosterId ? thirdPlaceMatchup?.winnerRosterId ?? null : null,
      lowerBracketResultRosterId: championRosterId
        ? lowerBracketOrder(consolationRounds, lowerBracket, standingRanks(seeded.teams)).resultRosterId
        : null,
      finalStandings: [] as NflRedraftPlayoffFinalStanding[],
    },
    coverage: {
      teamCount: seeded.teams.length,
      qualifiedTeams: seeded.seeds.length,
      championshipRounds: championshipRounds.length,
      championshipMatchups: championshipRounds.reduce((sum, round) => sum + round.matchups.length, 0),
      consolationMatchups: consolationRounds.reduce((sum, round) => sum + round.matchups.length, 0),
      thirdPlaceMatchups: thirdPlaceMatchup ? 1 : 0,
      completedMatchups: normalizedMatchups.filter((matchup) => matchup.complete || matchup.status === 'bye').length,
    },
  } satisfies NflRedraftPlayoffRuntimeState
  if (championRosterId) {
    provisionalState.bracket.finalStandings = finalStandingRows(provisionalState, championRosterId, runnerUpRosterId)
  }
  return provisionalState
}

export function generateNflRedraftPlayoffBracket(input: {
  state: NflRedraftPlayoffRuntimeState
  actorUserId?: string | null
  lockBracket?: boolean
}): NflRedraftGeneratedPlayoffBracket {
  const rounds = buildGeneratedRounds({ seeds: input.state.seeds, settings: input.state.settings, bracketType: 'championship' })
  const consolationRounds = buildLowerBracketRounds({
    teams: input.state.teams,
    settings: input.state.settings,
    championshipRoundCount: rounds.length,
  })
  const thirdPlaceMatchup = buildThirdPlaceMatchup({ rounds, settings: input.state.settings })
  const bracket: NflRedraftPlayoffBracketState = {
    bracketId: input.state.bracket.bracketId,
    status: input.lockBracket ? 'locked' : 'active',
    locked: input.lockBracket === true,
    generated: true,
    rounds,
    consolationRounds,
    lowerBracket: consolationRounds.length ? input.state.settings.lowerBracket : 'none',
    thirdPlaceMatchup,
    championRosterId: null,
    runnerUpRosterId: null,
    thirdPlaceRosterId: null,
    lowerBracketResultRosterId: null,
    finalStandings: [],
  }
  const events = [
    buildPlayoffRuntimeEvent({
      leagueId: input.state.leagueId,
      type: 'playoffs.qualification.calculated',
      actorUserId: input.actorUserId,
      payload: { seasonId: input.state.seasonId, playoffTeamCount: input.state.settings.playoffTeamCount },
    }),
    buildPlayoffRuntimeEvent({
      leagueId: input.state.leagueId,
      type: 'playoffs.seeds.updated',
      actorUserId: input.actorUserId,
      payload: { seasonId: input.state.seasonId, seeds: input.state.seeds.map((seed) => ({ seed: seed.seed, rosterId: seed.rosterId, qualifiedBy: seed.qualifiedBy })) },
    }),
    buildPlayoffRuntimeEvent({
      leagueId: input.state.leagueId,
      type: 'playoffs.bracket.generated',
      actorUserId: input.actorUserId,
      payload: {
        seasonId: input.state.seasonId,
        playoffTeamCount: input.state.settings.playoffTeamCount,
        bracketSize: input.state.settings.bracketSize,
        byes: input.state.settings.firstRoundByes,
        rounds: input.state.settings.roundCount,
      },
    }),
    ...rounds.flatMap((round) =>
      round.matchups.map((matchup) =>
        buildPlayoffRuntimeEvent({
          leagueId: input.state.leagueId,
          type: 'playoffs.matchup.created',
          actorUserId: input.actorUserId,
          payload: {
            seasonId: input.state.seasonId,
            roundNumber: round.roundNumber,
            matchupNumber: matchup.matchupNumber,
            homeRosterId: matchup.homeRosterId,
            awayRosterId: matchup.awayRosterId,
            bye: matchup.bye,
          },
        }),
      ),
    ),
  ]
  const firstRound = rounds[0]
  if (firstRound) {
    events.push(
      buildPlayoffRuntimeEvent({
        leagueId: input.state.leagueId,
        type: 'playoffs.round.opened',
        actorUserId: input.actorUserId,
        payload: { seasonId: input.state.seasonId, roundNumber: firstRound.roundNumber },
      }),
    )
  }
  if (input.lockBracket) {
    events.push(
      buildPlayoffRuntimeEvent({
        leagueId: input.state.leagueId,
        type: 'playoffs.bracket.locked',
        actorUserId: input.actorUserId,
        payload: { seasonId: input.state.seasonId },
      }),
    )
  }
  if (consolationRounds.length) {
    events.push(
      buildPlayoffRuntimeEvent({
        leagueId: input.state.leagueId,
        type: 'playoffs.consolation.generated',
        actorUserId: input.actorUserId,
        payload: {
          seasonId: input.state.seasonId,
          lowerBracket: bracket.lowerBracket,
          rounds: consolationRounds.length,
          matchupCount: consolationRounds.reduce((sum, round) => sum + round.matchups.length, 0),
        },
      }),
    )
  }
  const finalRound = rounds[rounds.length - 1]
  if (finalRound) {
    events.push(
      buildPlayoffRuntimeEvent({
        leagueId: input.state.leagueId,
        type: 'playoffs.championship.matchup.created',
        actorUserId: input.actorUserId,
        payload: { seasonId: input.state.seasonId, roundNumber: finalRound.roundNumber, thirdPlaceGame: thirdPlaceMatchup != null },
      }),
    )
  }
  return { bracket, events }
}

function fillNextRound(input: {
  state: NflRedraftPlayoffRuntimeState
  rounds: NflRedraftPlayoffRoundState[]
  activeRound: NflRedraftPlayoffRoundState
  winners: string[]
}) {
  const nextRound = input.rounds.find((round) => round.roundNumber === input.activeRound.roundNumber + 1)
  if (!nextRound) return null
  const seedByRosterId = lockedSeedMap(input.state, input.rounds)
  const lockedSeed = (rosterId: string | null) => (rosterId ? seedByRosterId.get(rosterId) ?? null : null)
  // A bye plan adds the seeds whose bye ends this round to the winners before pairing.
  const byePlan = input.state.settings.byePlan
  const entering = byePlan
    ? seedsEnteringRound(byePlan, nextRound.roundNumber)
        .map((seed) => input.state.seeds.find((row) => row.seed === seed)?.rosterId ?? null)
        .filter((rosterId): rosterId is string => rosterId != null && !input.winners.includes(rosterId))
    : []
  const sortedWinners = input.state.settings.reseedAfterEachRound
    ? [...input.winners, ...entering].sort((a, b) => (seedByRosterId.get(a) ?? 999) - (seedByRosterId.get(b) ?? 999))
    : input.winners

  if (input.state.settings.reseedAfterEachRound) {
    const pairs: Array<[string | null, string | null]> = []
    let left = 0
    let right = sortedWinners.length - 1
    while (left <= right) {
      const home = sortedWinners[left++] ?? null
      const away = left - 1 === right ? null : sortedWinners[right--] ?? null
      pairs.push([home, away])
    }
    nextRound.matchups.forEach((matchup, index) => {
      const [home, away] = pairs[index] ?? [null, null]
      matchup.homeRosterId = home
      matchup.awayRosterId = away
      matchup.homeSeed = lockedSeed(home)
      matchup.awaySeed = lockedSeed(away)
      matchup.status = home && !away ? 'bye' : 'scheduled'
      matchup.bye = Boolean(home && !away)
      matchup.winnerRosterId = matchup.bye ? home : null
      matchup.complete = matchup.bye
      matchup.metadata = { ...matchup.metadata, reseeded: true }
    })
  } else {
    for (const matchup of input.activeRound.matchups) {
      const winnerRosterId = matchup.winnerRosterId
      if (!winnerRosterId || !matchup.nextMatchupId) continue
      const target = nextRound.matchups.find((row) => row.matchupId === matchup.nextMatchupId)
      if (!target) continue
      if (target.homeRosterId === winnerRosterId || target.awayRosterId === winnerRosterId) continue
      if (!target.homeRosterId) {
        target.homeRosterId = winnerRosterId
        target.homeSeed = lockedSeed(winnerRosterId)
      } else if (!target.awayRosterId) {
        target.awayRosterId = winnerRosterId
        target.awaySeed = lockedSeed(winnerRosterId)
      }
    }
  }
  nextRound.status = 'active'
  return nextRound
}

type GameResolution = { matchup: NflRedraftPlayoffMatchupState; winnerRosterId: string; loserRosterId: string | null }

/** Decide every game in a group, or report why not. Nothing is written until the whole group is decided. */
function resolveGames(matchups: NflRedraftPlayoffMatchupState[]): {
  blocked: Array<{ matchupId: string; reason: string }>
  resolutions: GameResolution[]
} {
  const blocked: Array<{ matchupId: string; reason: string }> = []
  const resolutions: GameResolution[] = []
  for (const matchup of matchups) {
    const resolved = resolveWinner(matchup)
    if (!resolved.winnerRosterId) {
      blocked.push({ matchupId: matchup.matchupId, reason: resolved.blockedReason ?? 'Matchup is not ready.' })
      continue
    }
    resolutions.push({ matchup, winnerRosterId: resolved.winnerRosterId, loserRosterId: resolved.loserRosterId })
  }
  return { blocked, resolutions }
}

function applyResolutions(resolutions: GameResolution[]) {
  for (const { matchup, winnerRosterId, loserRosterId } of resolutions) {
    matchup.winnerRosterId = winnerRosterId
    matchup.loserRosterId = loserRosterId
    matchup.status = matchup.bye ? 'bye' : 'final'
    matchup.complete = true
  }
}

/** The semifinal losers into the third-place game, the better seed at home. */
function fillThirdPlace(
  thirdPlace: NflRedraftPlayoffMatchupState,
  semifinal: NflRedraftPlayoffRoundState,
  state: NflRedraftPlayoffRuntimeState,
  rounds: NflRedraftPlayoffRoundState[],
) {
  const losers = semifinal.matchups
    .filter((matchup) => !matchup.bye)
    .map((matchup) => matchup.loserRosterId ?? loserFor(matchup))
    .filter((rosterId): rosterId is string => Boolean(rosterId))
  if (losers.length !== 2) return
  const seeds = lockedSeedMap(state, rounds)
  const [home, away] = losers.sort((a, b) => (seeds.get(a) ?? 999) - (seeds.get(b) ?? 999))
  thirdPlace.homeRosterId = home
  thirdPlace.awayRosterId = away
  thirdPlace.homeSeed = seeds.get(home) ?? null
  thirdPlace.awaySeed = seeds.get(away) ?? null
  thirdPlace.status = 'scheduled'
}

/**
 * The lower bracket's next round, along its fixed tree. In a consolation bracket the winner moves
 * on; in a toilet bowl the LOSER does. A first-round bye moves its team on either way.
 */
function fillNextLowerRound(input: {
  rounds: NflRedraftPlayoffRoundState[]
  activeRound: NflRedraftPlayoffRoundState
  mode: NflRedraftLowerBracketMode
  ranks: Map<string, number>
}): NflRedraftPlayoffRoundState | null {
  const nextRound = input.rounds[input.rounds.indexOf(input.activeRound) + 1]
  if (!nextRound) return null
  for (const matchup of input.activeRound.matchups) {
    const advancer = matchup.bye
      ? matchup.homeRosterId
      : input.mode === 'toilet_bowl'
        ? matchup.loserRosterId
        : matchup.winnerRosterId
    const target = nextRound.matchups.find((row) => row.matchupId === matchup.nextMatchupId)
    if (!advancer || !target) continue
    if (target.homeRosterId === advancer || target.awayRosterId === advancer) continue
    if (!target.homeRosterId) {
      target.homeRosterId = advancer
      target.homeSeed = input.ranks.get(advancer) ?? null
    } else if (!target.awayRosterId) {
      target.awayRosterId = advancer
      target.awaySeed = input.ranks.get(advancer) ?? null
    }
  }
  nextRound.status = 'active'
  return nextRound
}

/**
 * Advance whatever is ready: the championship round being played (with the third-place game when
 * that round is the final) and, independently, the lower bracket's round.
 *
 * ⚠ THE TWO BRACKETS DO NOT WAIT FOR EACH OTHER. A consolation team's abandoned lineup can hold its
 * week's seal (coverage), and that must never delay the title bracket — nor the reverse. Each group
 * is all-or-nothing: no winner is written into a round until every game in it is decided. Only when
 * NEITHER group can move is the refusal returned, and `NO_ACTIVE_ROUND` means every bracket — title,
 * third place and lower — is finished, which is what lets the roller finalize.
 */
export function advanceNflRedraftPlayoffRound(input: {
  state: NflRedraftPlayoffRuntimeState
  actorUserId?: string | null
}): NflRedraftPlayoffAdvanceResult {
  if (!input.state.bracket.generated || input.state.bracket.rounds.length === 0) {
    return { ok: false, code: 'NO_BRACKET', message: 'No playoff bracket has been generated.', blockedMatchupIds: [], events: [] }
  }
  const rounds = input.state.bracket.rounds.map(cloneRound)
  const lowerRounds = input.state.bracket.consolationRounds.map(cloneRound)
  const sourceThirdPlace = input.state.bracket.thirdPlaceMatchup
  const thirdPlace = sourceThirdPlace ? { ...sourceThirdPlace, metadata: { ...sourceThirdPlace.metadata } } : null
  const activeRound = activeChampionshipRound(rounds)
  const activeLower = activeChampionshipRound(lowerRounds)
  if (!activeRound && !activeLower) {
    return { ok: false, code: 'NO_ACTIVE_ROUND', message: 'No active playoff round is available.', blockedMatchupIds: [], events: [] }
  }

  const finalRound = rounds[rounds.length - 1]
  const mainGames = activeRound
    ? [...activeRound.matchups, ...(activeRound === finalRound && thirdPlace ? [thirdPlace] : [])]
    : []
  const main = activeRound ? resolveGames(mainGames) : null
  const lower = activeLower ? resolveGames(activeLower.matchups) : null
  const mainReady = Boolean(main && main.blocked.length === 0)
  const lowerReady = Boolean(lower && lower.blocked.length === 0)

  if (!mainReady && !lowerReady) {
    const blocked = [...(main?.blocked ?? []), ...(lower?.blocked ?? [])]
    const tieBlocked = blocked.some((row) => row.reason.toLowerCase().includes('tied'))
    return {
      ok: false,
      code: tieBlocked ? 'TIE_UNRESOLVED' : 'MATCHUPS_INCOMPLETE',
      message: blocked.map((row) => row.reason).join(' '),
      blockedMatchupIds: blocked.map((row) => row.matchupId),
      events: [],
    }
  }

  const advancedRosterIds: string[] = []
  const eliminatedRosterIds: string[] = []
  let nextRound: NflRedraftPlayoffRoundState | null = null
  if (mainReady && activeRound && main) {
    applyResolutions(main.resolutions)
    for (const row of main.resolutions) {
      // The third-place game eliminates nobody new: both teams went out in the semifinals.
      if (row.matchup.bracketType !== 'championship') continue
      advancedRosterIds.push(row.winnerRosterId)
      if (row.loserRosterId) eliminatedRosterIds.push(row.loserRosterId)
    }
    activeRound.status = 'completed'
    nextRound = fillNextRound({ state: input.state, rounds, activeRound, winners: advancedRosterIds })
    if (thirdPlace && nextRound === finalRound) fillThirdPlace(thirdPlace, activeRound, input.state, rounds)
  }
  let nextLowerRound: NflRedraftPlayoffRoundState | null = null
  if (lowerReady && activeLower && lower) {
    applyResolutions(lower.resolutions)
    activeLower.status = 'completed'
    nextLowerRound = fillNextLowerRound({
      rounds: lowerRounds,
      activeRound: activeLower,
      mode: input.state.bracket.lowerBracket,
      ranks: standingRanks(input.state.teams),
    })
  }

  const finalRoundComplete = finalRound.status === 'completed'
  const bracketStatus: NflRedraftPlayoffBracketStatus = finalRoundComplete ? 'locked' : 'active'
  const state = {
    ...input.state,
    bracket: {
      ...input.state.bracket,
      status: bracketStatus,
      locked: bracketStatus === 'locked',
      rounds,
      consolationRounds: lowerRounds,
      thirdPlaceMatchup: thirdPlace,
    },
  } satisfies NflRedraftPlayoffRuntimeState

  const events: CanonicalLeagueRuntimeEvent[] = []
  if (mainReady && activeRound) {
    events.push(
      buildPlayoffRuntimeEvent({
        leagueId: input.state.leagueId,
        type: 'playoffs.advancement',
        actorUserId: input.actorUserId,
        payload: { seasonId: input.state.seasonId, roundNumber: activeRound.roundNumber, advancedRosterIds, eliminatedRosterIds },
      }),
      ...advancedRosterIds.map((rosterId) =>
        buildPlayoffRuntimeEvent({
          leagueId: input.state.leagueId,
          type: 'playoffs.team.advanced',
          actorUserId: input.actorUserId,
          payload: { seasonId: input.state.seasonId, roundNumber: activeRound.roundNumber, rosterId },
        }),
      ),
      ...eliminatedRosterIds.map((rosterId) =>
        buildPlayoffRuntimeEvent({
          leagueId: input.state.leagueId,
          type: 'playoffs.team.eliminated',
          actorUserId: input.actorUserId,
          payload: { seasonId: input.state.seasonId, roundNumber: activeRound.roundNumber, rosterId },
        }),
      ),
    )
    if (input.state.settings.reseedAfterEachRound && nextRound) {
      events.push(
        buildPlayoffRuntimeEvent({
          leagueId: input.state.leagueId,
          type: 'playoffs.reseeded',
          actorUserId: input.actorUserId,
          payload: { seasonId: input.state.seasonId, roundNumber: nextRound.roundNumber },
        }),
      )
    }
    if (nextRound) {
      events.push(
        buildPlayoffRuntimeEvent({
          leagueId: input.state.leagueId,
          type: 'playoffs.round.opened',
          actorUserId: input.actorUserId,
          payload: { seasonId: input.state.seasonId, roundNumber: nextRound.roundNumber },
        }),
      )
    }
  }
  if (lowerReady && activeLower && lower) {
    events.push(
      buildPlayoffRuntimeEvent({
        leagueId: input.state.leagueId,
        type: 'playoffs.advancement',
        actorUserId: input.actorUserId,
        payload: {
          seasonId: input.state.seasonId,
          bracketType: 'consolation',
          lowerBracket: input.state.bracket.lowerBracket,
          roundNumber: activeLower.roundNumber,
          nextRoundNumber: nextLowerRound?.roundNumber ?? null,
          results: lower.resolutions.map((row) => ({ matchupId: row.matchup.matchupId, winnerRosterId: row.winnerRosterId, loserRosterId: row.loserRosterId })),
        },
      }),
    )
  }
  return {
    ok: true,
    state,
    events,
    advancedRosterIds: Array.from(new Set(advancedRosterIds)),
    eliminatedRosterIds: Array.from(new Set(eliminatedRosterIds)),
    status: mainReady && finalRoundComplete ? 'championship_ready' : 'round_complete',
  }
}

export function finalizeNflRedraftPlayoffChampion(input: {
  state: NflRedraftPlayoffRuntimeState
  actorUserId?: string | null
}): NflRedraftPlayoffFinalizeResult {
  if (!input.state.bracket.generated) {
    return { ok: false, code: 'NO_BRACKET', message: 'No playoff bracket has been generated.', events: [] }
  }
  const finalRound = input.state.bracket.rounds[input.state.bracket.rounds.length - 1]
  const thirdPlace = input.state.bracket.thirdPlaceMatchup
  if (!finalRound || finalRound.status !== 'completed' || (thirdPlace && !thirdPlace.winnerRosterId)) {
    return { ok: false, code: 'FINAL_ROUND_INCOMPLETE', message: 'The championship round is not complete.', events: [] }
  }
  // The lower bracket's result is part of the final standings; once the season completes, nothing scores it.
  const lowerIncomplete = input.state.bracket.consolationRounds.some(
    (round) => round.status !== 'completed' && round.matchups.some((matchup) => !matchup.complete),
  )
  if (lowerIncomplete) {
    return {
      ok: false,
      code: 'LOWER_BRACKET_INCOMPLETE',
      message: input.state.bracket.lowerBracket === 'toilet_bowl' ? 'The toilet bowl is not complete.' : 'The consolation bracket is not complete.',
      events: [],
    }
  }
  const championshipMatchup = finalRound.matchups.find((matchup) => !matchup.nextMatchupId) ?? finalRound.matchups[0]
  if (!championshipMatchup?.winnerRosterId) {
    return { ok: false, code: 'NO_WINNER', message: 'The championship matchup has no winner.', events: [] }
  }
  const championRosterId = championshipMatchup.winnerRosterId
  const runnerUpRosterId = loserFor(championshipMatchup)
  const thirdPlaceRosterId = thirdPlace?.winnerRosterId ?? null
  const lowerBracketResultRosterId = lowerBracketOrder(
    input.state.bracket.consolationRounds,
    input.state.bracket.lowerBracket,
    standingRanks(input.state.teams),
  ).resultRosterId
  const finalStandings = finalStandingRows(input.state, championRosterId, runnerUpRosterId)
  const state = {
    ...input.state,
    bracket: {
      ...input.state.bracket,
      status: 'complete',
      locked: true,
      championRosterId,
      runnerUpRosterId,
      thirdPlaceRosterId,
      lowerBracketResultRosterId,
      finalStandings,
    },
  } satisfies NflRedraftPlayoffRuntimeState
  const events = [
    buildPlayoffRuntimeEvent({
      leagueId: input.state.leagueId,
      type: 'playoffs.champion.crowned',
      actorUserId: input.actorUserId,
      payload: { seasonId: input.state.seasonId, championRosterId, runnerUpRosterId, thirdPlaceRosterId },
    }),
    buildPlayoffRuntimeEvent({
      leagueId: input.state.leagueId,
      type: 'playoffs.final_standings.recorded',
      actorUserId: input.actorUserId,
      payload: {
        seasonId: input.state.seasonId,
        finalStandings,
        lowerBracket: input.state.bracket.lowerBracket,
        lowerBracketResultRosterId,
      },
    }),
    buildPlayoffRuntimeEvent({
      leagueId: input.state.leagueId,
      type: 'season.completed',
      actorUserId: input.actorUserId,
      payload: { seasonId: input.state.seasonId, championRosterId },
    }),
  ]
  return { ok: true, state, championRosterId, runnerUpRosterId, finalStandings, events }
}
