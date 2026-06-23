/**
 * T10 — Chimmy Trade Intelligence shared types.
 *
 * All values that reach Chimmy come from the deterministic T2–T9 layers; nothing
 * here invents numbers. `text` fields are short, safe, source-attributed snippets
 * the LLM may surface verbatim or paraphrase — it must NOT fabricate beyond them.
 */

export type TradeRole = 'commissioner' | 'manager' | 'non_member'

export type TradeIntentKind =
  | 'explain_trade'
  | 'commissioner_review'
  | 'find_partners'
  | 'suggest_packages'
  | 'explain_player_value'
  | 'summarize_block'
  | 'teach'
  | 'general_trade'

export interface TradeToolLimitation {
  code:
    | 'INSUFFICIENT_SAMPLE'
    | 'NO_SNAPSHOT'
    | 'NO_PUBLISHED_VALUE'
    | 'NOT_FOUND'
    | 'PERMISSION_REQUIRED'
    | 'NOT_REDRAFT_LEAGUE'
    | 'NO_ROSTER'
    | 'LIMITED_DATA'
  detail: string
}

/** Every tool returns structured data + a small set of safe text lines. */
export interface TradeToolResult<T> {
  ok: boolean
  data: T | null
  text: string[]
  limitations: TradeToolLimitation[]
}

export interface ExplainTradeData {
  proposalId: string
  status: string
  /** Immutable grade captured at proposal time (T2 snapshot). */
  snapshotGrade: string | null
  fairnessScore: number | null
  confidenceScore: number | null
  valueDifference: number | null
  sideTotals: Array<{ rosterId: string; total: number }>
  reasons: string[]
  warnings: string[]
  /** Snapshot values are historical; current market value may differ (T9/T6). */
  snapshotIsHistorical: true
}

export interface PlayerMarketValueData {
  playerId: string
  playerName: string | null
  position: string | null
  /** AllFantasy official market value (T9) — separate from provider/ADP/projection. */
  allFantasyMarketValue: number | null
  baseValue: number | null
  adjustmentPercent: number | null
  confidence: number | null
  sampleSize: number | null
  published: boolean
  direction: string | null
  /** Source labels kept explicit so Chimmy never conflates them. */
  sources: {
    allFantasyMarket: 'official AllFantasy market value (internal trade signals)'
    provider: 'provider/ADP/projection values are a SEPARATE source and are not shown here'
    snapshot: 'historical trade snapshot values are immutable and may differ from current'
  }
}

export interface TradeBlockSummaryData {
  leagueVisibleItems: Array<{ rosterId: string; playerId: string; playerName: string | null; note: string | null }>
  myInterests: Array<{ playerId: string; playerName: string | null }>
  myInterestPositions: string[]
  hasNativeBlock: boolean
}
