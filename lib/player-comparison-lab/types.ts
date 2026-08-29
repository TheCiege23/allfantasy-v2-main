/**
 * Player Comparison Lab — types (Prompt 117 + Prompt 130).
 */

export interface HistoricalSeasonRow {
  season: string;
  gamesPlayed: number | null;
  fantasyPoints: number | null;
  fantasyPointsPerGame: number | null;
  passingYards?: number | null;
  rushingYards?: number | null;
  receivingYards?: number | null;
  receptions?: number | null;
}

export interface ProjectionRow {
  value: number;
  rank: number;
  positionRank: number;
  trend30Day: number;
  redraftValue: number | null;
  source: string;
  position?: string | null;
  team?: string | null;
  /** Volatility (e.g. moving std dev); lower = more stable (Prompt 130). */
  volatility?: number | null;
}

export interface DeterministicSourceFlags {
  fantasyCalc: boolean;
  sleeper: boolean;
  espnInjuryFeed: boolean;
  internalAdp: boolean;
  internalProjections: boolean;
  leagueScoringSettings: boolean;
  /** {@link MarketAdpSignal} was resolved from adp_data. Distinct from `sleeper`. */
  marketAdp: boolean;
}

/**
 * Draft cost read from `adp_data`, for the players the static CSV cannot see.
 *
 * 🛑 THE NUMBER TRAVELS WITH ITS PROVENANCE, DELIBERATELY. The comparison lab's only other
 * ADP fields are both unusable: `internalAdp` reads `ai_adp_snapshots`, which holds ZERO rows
 * in production (its writer `runAiAdpJob` has no scheduled caller), and `sleeperAdp` comes
 * from a column of `data/nfl-adp-multiplatform.csv` — a hand-placed export dated 2026-03-08,
 * before the April 2026 draft, covering 4 of ~377 skill-position rookies.
 *
 * A 2026 rookie's figure here is priced by `ffc` ALONE at providerCount 1. Rendering it as a
 * bare number beside a veteran's would assert a corroboration that does not exist, so every
 * surface that shows `adp` must also show `providerCount`/`providers` and `scoring`.
 *
 * ⚠ NOT ROUTED INTO THE `market_value` MATRIX ROW, ON PURPOSE. That row proxies ADP into a
 * FantasyCalc-scaled value via `Math.max(0, 10000 - adp * 35)`, compares it head-to-head with
 * real FantasyCalc values, and feeds the winner to the model through `buildSummaryLines` with
 * no provenance attached. The transform is linear where value is steeply convex, so a rookie
 * would price at ~89% of the board leader and could win "Market value" outright. It also
 * saturates to a scored 0 past pick ~286, turning "no data" into "worthless".
 */
export interface MarketAdpSignal {
  adp: number;
  /** NULL means the row did not state a count — which is NOT the same as 1. */
  providerCount: number | null;
  /** Named sources, so a single-source price cannot read as a consensus. */
  providers: string[];
  season: number;
  week: number;
  /**
   * The board's own basis, which is NOT the league's scoring. The blended
   * `redraft`/`standard` board is requested deliberately because it is a superset carrying
   * the CSV's veterans AND ffc's rookies; `redraft`/`ppr` is pure ffc and would drop
   * veterans. That tradeoff is only honest if the basis is disclosed.
   */
  format: string;
  scoring: string;
  /** Identity from the same row, usable as a last-resort position/team fallback. */
  position: string | null;
  team: string | null;
}

export interface InjurySignal {
  status: string | null;
  source: 'espn' | 'none';
  riskScore: number | null;
  note: string | null;
}

export interface LeagueScoringSettings {
  ppr?: number | null;
  tePremium?: number | null;
  superflex?: boolean | null;
  passTdPoints?: number | null;
}

export interface ResolvedPlayerStats {
  name: string;
  position: string | null;
  team: string | null;
  historical: HistoricalSeasonRow[];
  projection: ProjectionRow | null;
  internalAdp: number | null;
  sleeperAdp: number | null;
  /** Draft cost from `adp_data`. See {@link MarketAdpSignal} — never collapse into `sleeperAdp`. */
  marketAdp: MarketAdpSignal | null;
  internalProjectionPoints: number | null;
  injury: InjurySignal;
  scheduleDifficultyScore: number | null;
  sourceFlags: DeterministicSourceFlags;
}

export type ChartMode = 'historical' | 'projections' | 'both';

export interface ComparisonChartSeries {
  label: string;
  playerA: number | null;
  playerB: number | null;
  unit?: string;
}

export interface PlayerComparisonResult {
  playerA: ResolvedPlayerStats;
  playerB: ResolvedPlayerStats;
  chartSeries: ComparisonChartSeries[];
  summaryLines: string[];
}

export interface DeterministicStatComparisonRow {
  metricId: string;
  label: string;
  playerAValue: number | null;
  playerBValue: number | null;
  higherIsBetter: boolean;
  winner: 'playerA' | 'playerB' | 'tie' | 'none';
  edgeScore: number | null;
}

export interface TwoPlayerComparisonDeterministicOutput {
  recommendedSide: 'playerA' | 'playerB' | 'tie';
  recommendedPlayerName: string | null;
  confidencePct: number;
  basedOn: Array<'stats_comparison'>;
  summary: string;
  statComparisons: DeterministicStatComparisonRow[];
}

export interface TwoPlayerComparisonExplanation {
  source: 'deterministic' | 'ai';
  text: string;
}

export interface TwoPlayerComparisonEngineResult {
  sport: string;
  comparison: PlayerComparisonResult;
  deterministic: TwoPlayerComparisonDeterministicOutput;
  explanation: TwoPlayerComparisonExplanation;
}

// ——— Prompt 130: Multi-player comparison lab ———

export type ScoringFormat = 'ppr' | 'half_ppr' | 'non_ppr';

export type ComparisonDimensionId =
  | 'market_value'
  | 'fantasy_production'
  | 'projection'
  | 'volatility'
  | 'consistency'
  | 'schedule_difficulty'
  | 'injury_risk'
  | 'trend_momentum';

export interface ComparisonMatrixRow {
  dimensionId: ComparisonDimensionId;
  label: string;
  /** Keyed by player name; value is numeric for this dimension (higher = better unless inverted). */
  valuesByPlayer: Record<string, number | null>;
  /** Player name that wins this category (best value); null if tie or no data. */
  winnerName: string | null;
  /** When higher is worse (e.g. volatility, injury_risk), winner is the one with lower value. */
  higherIsBetter: boolean;
}

export interface CategoryWinnerHighlight {
  dimensionId: ComparisonDimensionId;
  label: string;
  winnerName: string;
  value: number | null;
}

/** Per-player deterministic scores for display. */
export interface PlayerComparisonScores {
  playerName: string;
  /** Value Over Replacement proxy: value delta vs baseline (e.g. position replacement). */
  vorpDifference: number | null;
  /** Projected fantasy points or value delta. */
  projectionDelta: number | null;
  /** 0–100 or similar; higher = more consistent. */
  consistencyScore: number | null;
  /** Lower = less volatile (prefer for safety). */
  volatilityScore: number | null;
}

export interface MultiPlayerComparisonResult {
  sport: string;
  scoringFormat: ScoringFormat;
  leagueScoringSettings?: LeagueScoringSettings | null;
  players: ResolvedPlayerStats[];
  /** Rows = dimensions, columns = players. */
  matrix: ComparisonMatrixRow[];
  categoryWinners: CategoryWinnerHighlight[];
  playerScores: PlayerComparisonScores[];
  summaryLines: string[];
  sourceCoverage: DeterministicSourceFlags;
  /** For charts: same shape as before but with N players. */
  chartSeries?: ComparisonChartSeries[];
}

export interface ComparisonAIInsight {
  finalRecommendation: string;
  deepseekAnalysis: string | null;
  grokNarrative: string | null;
  openaiSummary: string | null;
  finalRecommendationSource?: 'deterministic' | 'ai';
  providerStatus: {
    deepseek: boolean;
    grok: boolean;
    openai: boolean;
  };
}
