/**
 * Shareable AI Insight Cards (PROMPT 293) — payload types for card generator.
 */

export type AICardVariant =
  | 'trade_grade'
  | 'matchup_prediction'
  | 'draft_grade'
  | 'power_rankings'

interface AICardPayloadBase {
  /** Short title (e.g. "Trade Grade") */
  title: string
  /** AI insight or verdict (1-3 sentences) */
  insight: string
  /** Optional sport for theming */
  sport?: string
}

export interface TradeGradePayload extends AICardPayloadBase {
  variant: 'trade_grade'
  /** Side A names (e.g. player names) */
  sideA: string[]
  /** Side B names */
  sideB: string[]
  /** Grade label (e.g. "B+", "Fair") */
  grade?: string
  /** Optional short verdict */
  verdict?: string
}

export interface MatchupPredictionPayload extends AICardPayloadBase {
  variant: 'matchup_prediction'
  /** Team or manager name 1 */
  team1: string
  /** Team or manager name 2 */
  team2: string
  /** Prediction (e.g. "Team A by 8") */
  prediction?: string
  /** Optional week/round */
  weekOrRound?: string
}

export interface DraftGradePayload extends AICardPayloadBase {
  variant: 'draft_grade'
  /** Team or manager name */
  teamName: string
  /** Grade (e.g. "A-") */
  grade?: string
  /** Optional highlights (e.g. "Best value: Round 5") */
  highlights?: string[]
  /** Optional round/pick context */
  roundOrPick?: string
}

export interface PowerRankingsPayload extends AICardPayloadBase {
  variant: 'power_rankings'
  /** Rank (e.g. 1) */
  rank: number
  /** Team or manager name */
  teamName: string
  /** Optional change (e.g. "+2") */
  change?: string
  /** Optional one-liner */
  blurb?: string
}

export type AICardPayload =
  | TradeGradePayload
  | MatchupPredictionPayload
  | DraftGradePayload
  | PowerRankingsPayload
