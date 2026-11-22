/**
 * Fantasy Coach Mode types.
 */

export type AdviceType = 'lineup' | 'trade' | 'waiver';

export interface CoachContext {
  leagueId?: string;
  leagueName?: string;
  week?: number;
  teamName?: string;
  sport?: string;
  [key: string]: unknown;
}

export interface StrategyRecommendation {
  type: AdviceType;
  summary: string;
  bullets: string[];
  actions: string[];
  contextSummary: string;
}

export interface CoachAdviceResult {
  type: AdviceType;
  summary: string;
  bullets: string[];
  challenge: string;
  tone: 'motivational' | 'cautious' | 'celebration' | 'neutral';
}

export interface CoachProviderInsights {
  deepseek: string;
  grok: string;
  openai: string;
}

export interface CoachEvaluationMetric {
  id: string;
  label: string;
  score: number;
  trend: 'up' | 'steady' | 'down';
  summary: string;
}

export interface CoachTeamSnapshot {
  presetId: string;
  presetName: string;
  teamName: string;
  week: number;
  adjustedProjection: number;
  adjustedFloor: number;
  adjustedCeiling: number;
  scheduleAdjustment: number;
  strongestSlot: string;
  weakestSlot: string;
  swingSlot: string;
}

export interface WaiverOpportunity {
  playerName: string;
  position?: string;
  reason: string;
  priority?: 'high' | 'medium';
  /** Where the suggestion leads. Waiver targets are archetypes, so this opens the waiver tool on that slot (`/waiver-ai?focus=`). */
  playerHref: string;
}

export interface TradeSuggestion {
  summary: string;
  /** Opens trade analyzer tool. */
  tradeAnalyzerHref: string;
  targetHint?: string;
  priority?: 'high' | 'medium';
}

export interface ActionRecommendation {
  id: string;
  type: 'lineup' | 'trade' | 'waiver' | 'tool';
  label: string;
  summary: string;
  priority?: 'high' | 'medium';
  /** Opens the relevant tool (waiver, trade, rankings, etc.). */
  toolHref: string;
}

export interface CoachEvaluationResult {
  sport: string;
  rosterStrengths: string[];
  rosterWeaknesses: string[];
  waiverOpportunities: WaiverOpportunity[];
  tradeSuggestions: TradeSuggestion[];
  lineupImprovements: string[];
  actionRecommendations: ActionRecommendation[];
  evaluationMetrics: CoachEvaluationMetric[];
  teamSummary: string;
  teamSnapshot: CoachTeamSnapshot;
  providerInsights: CoachProviderInsights;
  rosterMathSummary: string | null;
  strategyInsight: string | null;
  weeklyAdvice: string | null;
  deterministicSeed: number;
  lastEvaluatedAt: string;
}
