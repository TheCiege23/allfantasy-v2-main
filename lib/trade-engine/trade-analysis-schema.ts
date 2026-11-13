import { z } from "zod";

const VerdictEnum = z.enum([
  "Team A",
  "Team B",
  "Even",
  "Slight edge to Team A",
  "Slight edge to Team B",
  "Disagreement",
]);

const PeerReviewVerdictSchema = z.object({
  verdict: VerdictEnum.exclude(["Disagreement"]),
  confidence: z.number().min(0).max(100),
  reasons: z.array(z.string()).min(1),
  counters: z.array(z.string()),
  warnings: z.array(z.string()),
}).strict();

type PeerReviewVerdict = z.infer<typeof PeerReviewVerdictSchema>;

type PeerReviewProviderResult = {
  provider: "openai" | "grok";
  verdict: PeerReviewVerdict | null;
  raw: any;
  latencyMs: number;
  error?: string;
  schemaValid: boolean;
};

type DisagreementCode =
  | 'verdict_polarity_mismatch'
  | 'confidence_spread_high'
  | 'reason_overlap_low'
  | 'data_quality_concern'
  | 'provider_degraded';

export type DisagreementBlock = {
  winnerMismatch: boolean;
  confidenceSpread: number;
  keyDifferences: string[];
  reviewMode: boolean;
};

export type PeerReviewConsensus = {
  verdict: z.infer<typeof VerdictEnum>;
  confidence: number;
  reasons: string[];
  counters: string[];
  warnings: string[];
  disagreement: DisagreementBlock;
  meta: {
    providers: PeerReviewProviderResult[];
    consensusMethod: "agreement" | "disagreement" | "single_provider" | "degraded_fallback";
    totalLatencyMs: number;
    confidenceAdjustment: string;
    disagreementCodes?: DisagreementCode[];
    disagreementDetails?: string;
  };
};

const LegacyWinnerEnum = z.enum([
  "Team A",
  "Team B",
  "Even",
  "Slight edge to Team A",
  "Slight edge to Team B",
]);

const ConfidenceBreakdownSchema = z.object({
  data_quality: z.number().min(0).max(100),
  market_alignment: z.number().min(0).max(100),
  risk_weighting: z.number().min(0).max(100),
});

export type ConfidenceBreakdown = z.infer<typeof ConfidenceBreakdownSchema>;

const TradeAnalysisSchema = z.object({
  winner: LegacyWinnerEnum,
  confidence: z.number().min(0).max(100),
  reasoning: z.string().min(1),
  key_factors: z.array(z.string()).min(1),
  risk_flags: z.array(z.string()),
  counter_suggestions: z.array(z.string()),
  news_impact: z.array(z.string()),
  confidence_breakdown: ConfidenceBreakdownSchema,
  /** @deprecated kept for backwards compat — maps to reasoning */
  valueDelta: z.string().optional(),
  /** @deprecated kept for backwards compat — maps to key_factors */
  factors: z.array(z.string()).optional(),
  dynastyVerdict: z.string().optional(),
  vetoRisk: z.string().optional(),
  agingConcerns: z.array(z.string()).optional(),
  recommendations: z.array(z.string()).optional(),
  youGiveAdjusted: z.string().optional(),
  youWantAdded: z.string().optional(),
  reason: z.string().optional(),
});

type TradeAnalysis = z.infer<typeof TradeAnalysisSchema>;

type ProviderResult = {
  provider: "openai" | "grok";
  analysis: TradeAnalysis | null;
  raw: any;
  latencyMs: number;
  error?: string;
  schemaValid: boolean;
  confidenceScore: number;
};

export type ConsensusAnalysis = TradeAnalysis & {
  meta: {
    providers: ProviderResult[];
    consensusMethod: "single" | "weighted_merge" | "primary_fallback";
    primaryProvider: "openai" | "grok";
    totalLatencyMs: number;
  };
};

/**
 * Score a provider result on a 100-point scale:
 *   Schema validity    — 40 pts
 *   Reasoning depth    — 20 pts
 *   Factor diversity   — 10 pts
 *   Confidence calib.  — 20 pts
 *   News relevance     — 10 pts
 */
export function scoreProviderResult(result: ProviderResult): number {
  let score = 0;

  // --- Schema validity (40 pts) ---
  if (result.schemaValid) score += 40;

  if (!result.analysis) return score;

  const a = result.analysis;

  // --- Reasoning depth (20 pts) ---
  const reasoningLen = (a.reasoning ?? '').length;
  if (reasoningLen >= 200) score += 20;
  else if (reasoningLen >= 100) score += 14;
  else if (reasoningLen >= 40) score += 8;
  else if (reasoningLen > 0) score += 4;

  // --- Factor diversity (10 pts) ---
  const factorCount = a.key_factors?.length ?? 0;
  if (factorCount >= 5) score += 10;
  else if (factorCount >= 3) score += 7;
  else if (factorCount >= 1) score += 4;

  // --- Confidence calibration (20 pts) ---
  // Reward middle-ground confidence; penalize extremes (0 or 100) unless justified
  const cb = a.confidence_breakdown;
  if (cb) {
    const avg = (cb.data_quality + cb.market_alignment + cb.risk_weighting) / 3;
    const spread = Math.max(cb.data_quality, cb.market_alignment, cb.risk_weighting) -
                   Math.min(cb.data_quality, cb.market_alignment, cb.risk_weighting);
    // Reasonable average → up to 14 pts, low spread → up to 6 pts
    score += Math.min(14, Math.round((avg / 100) * 14));
    score += spread <= 30 ? 6 : spread <= 50 ? 3 : 0;
  } else {
    // Fallback: simple confidence score
    score += Math.min(20, Math.round((a.confidence / 100) * 20));
  }

  // --- News relevance (10 pts) ---
  const newsCount = a.news_impact?.length ?? 0;
  if (newsCount >= 3) score += 10;
  else if (newsCount >= 1) score += 6;
  // 0 news is acceptable for OpenAI (no live data), still earns partial
  else if (result.provider === 'openai') score += 3;

  return Math.min(100, score);
}

