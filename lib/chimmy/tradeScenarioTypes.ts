/**
 * The wire shape of a Chimmy trade scenario — client-safe, no server imports.
 *
 * Kept apart from `tradeScenarioGrounding.ts` (which is `server-only`) because the /core drawer
 * renders `meta.scenario` and must be able to name its type without pulling the resolver into a
 * client bundle.
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

export type ReadyTradeScenario = {
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
  /** A literal `false`, so a renderer cannot mistake an absent number for a computed one. */
  playoffOdds: { available: false; reason: string }
}

export type TradeScenario =
  | ReadyTradeScenario
  | { status: 'unresolved'; reason: TradeScenarioUnresolvedReason; detail: string }
