/**
 * The wire shape of a Chimmy scenario comparison — client-safe, no server imports.
 *
 * Kept apart from the resolvers (which are `server-only`) because the /core drawer renders
 * `meta.scenario` and must be able to name its type without pulling a resolver into a client
 * bundle.
 *
 * Three kinds (Chimmy brief item 8): a trade, a waiver add/drop, and a start/sit. `kind` is optional
 * on the trade shape only because trade scenarios shipped before the other two; a scenario without
 * a kind IS a trade.
 */

export type ScenarioPlayer = { playerId: string; name: string; position: string | null }

export type TradeScenarioUnresolvedReason =
  | 'no_league_world'
  | 'no_viewer_roster'
  | 'includes_picks'
  | 'players_not_rostered'
  | 'ambiguous_player'
  | 'sides_unclear'
  | 'multiple_partners'
  | 'evaluation_failed'

export type TradeScenarioLineup = {
  before: number
  after: number
  delta: number
  unit: string
}

/** A literal `false`, so a renderer cannot mistake an absent number for a computed one. */
export type PlayoffOddsNotComputed = { available: false; reason: string }

/**
 * The unit of every waiver and start/sit number: this week's projection, re-scored under the
 * league's OWN rules. Not the trade card's AllFantasy per-game figure, which is full PPR in every
 * league — see `lineupScenarioGrounding.ts` for why the two kinds use different bases.
 */
export const LEAGUE_WEEK_UNIT = 'league_points_week'

/** Why the waiver and start/sit kinds refuse before touching any player. */
type LeagueWeekRefusal = 'sport_not_supported' | 'no_scoring_rules' | 'no_projection_week' | 'no_league_projections'

/** Which week's projection feed a waiver or start/sit number came from. */
export type ScenarioWeek = { season: string; week: number }

export type ReadyTradeScenario = {
  kind?: 'trade'
  status: 'ready'
  give: ScenarioPlayer[]
  get: ScenarioPlayer[]
  partnerTeamName: string
  value: {
    given: number | null
    received: number | null
    delta: number | null
    grade: string | null
    coveragePct: number
    coverageStatus: 'complete' | 'partial' | 'blocked'
  }
  lineup: TradeScenarioLineup | null
  /** Why `lineup` is null — the evaluator's own blocked reason, verbatim when it gave one. */
  lineupUnavailable: string | null
  playoffOdds: PlayoffOddsNotComputed
}

export type TradeScenario =
  | ReadyTradeScenario
  | { status: 'unresolved'; reason: TradeScenarioUnresolvedReason; detail: string }

/* ── Waiver add / drop ─────────────────────────────────────────────────────────────────────── */

export type WaiverScenarioUnresolvedReason =
  | 'no_league_world'
  | 'no_viewer_roster'
  | 'add_not_found'
  | 'add_rostered'
  | 'drop_not_on_roster'
  | 'ambiguous_player'
  | LeagueWeekRefusal

export type ReadyWaiverScenario = {
  kind: 'waiver'
  status: 'ready'
  /** `points` is this week, under the league's rules (`LEAGUE_WEEK_UNIT`); null when unpriced. */
  add: ScenarioPlayer & { points: number | null }
  drop: (ScenarioPlayer & { points: number | null }) | null
  week: ScenarioWeek
  /** Whether the reader named the move, or it is the waiver engine's top claim for them. */
  source: 'named' | 'engine_top_claim'
  lineup: TradeScenarioLineup | null
  lineupUnavailable: string | null
  /** Present only when the engine proposed the move — its own score and bid, not ours. */
  engine: { compositeScore: number | null; faabBid: number | null } | null
  /** No drop was named, so whether the roster has room was NOT checked. */
  rosterRoomUnchecked: boolean
  /** Starting slots nobody priced can fill — both totals leave them out. */
  unfilledSlots: string[]
  playoffOdds: PlayoffOddsNotComputed
}

export type WaiverScenario =
  | ReadyWaiverScenario
  | { kind: 'waiver'; status: 'unresolved'; reason: WaiverScenarioUnresolvedReason; detail: string }

/* ── Start / sit ───────────────────────────────────────────────────────────────────────────── */

export type StartSitScenarioUnresolvedReason =
  | 'no_league_world'
  | 'no_viewer_roster'
  | 'players_not_on_roster'
  | 'ambiguous_player'
  | 'unpriced_player'
  | 'unknown_slots'
  | 'no_starting_slot'
  | LeagueWeekRefusal

export type StartSitOption = ScenarioPlayer & {
  /** This week, under the league's rules (`LEAGUE_WEEK_UNIT`). */
  points: number
  /** In the best lineup this roster can field with both players available. */
  inBestLineup: boolean
  /**
   * Best starting total with THIS player in a starting slot and the other option benched. Not "the
   * best lineup without the other one", which can start a third player and so measure nothing asked.
   */
  lineupIfStarted: number
}

export type ReadyStartSitScenario = {
  kind: 'start_sit'
  status: 'ready'
  options: [StartSitOption, StartSitOption]
  unit: typeof LEAGUE_WEEK_UNIT
  week: ScenarioWeek
  /**
   * False when the question does not actually choose between them: both fit in the best lineup, or
   * neither does. The card and the prompt say which.
   */
  contested: boolean
  /** The option in the best lineup when `contested`; null otherwise. */
  startPlayerId: string | null
  /** `lineupIfStarted` of the pick minus that of the other; null when not contested. */
  delta: number | null
  /** Active rostered players left out of the lineup maths because nothing prices them this week. */
  unpricedExcluded: number
  /** Starting slots nobody priced can fill — every total leaves them out. */
  unfilledSlots: string[]
  playoffOdds: PlayoffOddsNotComputed
}

export type StartSitScenario =
  | ReadyStartSitScenario
  | { kind: 'start_sit'; status: 'unresolved'; reason: StartSitScenarioUnresolvedReason; detail: string }

/** Any scenario the drawer can render. */
export type ReadyChimmyScenario = ReadyTradeScenario | ReadyWaiverScenario | ReadyStartSitScenario

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isPlayer = (v: unknown): v is ScenarioPlayer =>
  Boolean(v) && typeof (v as ScenarioPlayer).playerId === 'string' && typeof (v as ScenarioPlayer).name === 'string'

/**
 * A `meta.scenario` the drawer may render, or null. Only well-formed READY shapes pass — a card that
 * renders a half-shaped object would print "undefined" into a number cell, and a wrong number is worse
 * than no card.
 */
export function readReadyScenario(value: unknown): ReadyChimmyScenario | null {
  if (!value || typeof value !== 'object') return null
  const s = value as Record<string, unknown>
  if (s.status !== 'ready') return null
  const kind = s.kind ?? 'trade'
  if (kind === 'trade') {
    return Array.isArray(s.give) && Array.isArray(s.get) && s.give.every(isPlayer) && s.get.every(isPlayer)
      ? (value as ReadyTradeScenario)
      : null
  }
  // Both cards print `playoffOdds.reason`; without it they would throw rather than render.
  const hasOddsRow = Boolean(s.playoffOdds) && typeof (s.playoffOdds as PlayoffOddsNotComputed).reason === 'string'
  // …and both print the week their numbers are for.
  const hasWeek = Boolean(s.week) && isNum((s.week as ScenarioWeek).week)
  if (kind === 'waiver') {
    return hasOddsRow && hasWeek && isPlayer(s.add) && (s.drop == null || isPlayer(s.drop)) ? (value as ReadyWaiverScenario) : null
  }
  if (kind === 'start_sit') {
    const options = s.options
    return hasOddsRow &&
      hasWeek &&
      Array.isArray(options) &&
      options.length === 2 &&
      options.every((o) => isPlayer(o) && isNum((o as StartSitOption).points) && isNum((o as StartSitOption).lineupIfStarted))
      ? (value as ReadyStartSitScenario)
      : null
  }
  return null
}
