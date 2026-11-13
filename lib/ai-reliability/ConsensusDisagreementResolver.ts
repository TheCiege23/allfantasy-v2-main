/**
 * When multiple providers disagree, produce explanation and optional merged stance (Prompt 127).
 */

interface VerdictStance {
  verdict: string;
  confidence: number;
  provider: string;
}

interface DisagreementResult {
  hasDisagreement: boolean;
  explanation: string;
  primaryVerdict: string;
  primaryConfidence: number;
  alternateVerdicts: { verdict: string; confidence: number; provider: string }[];
}

/**
 * Build user-facing explanation when providers disagree on verdict.
 */
export function resolveConsensusDisagreement(stances: VerdictStance[]): DisagreementResult {
  if (stances.length === 0) {
    return {
      hasDisagreement: false,
      explanation: '',
      primaryVerdict: '',
      primaryConfidence: 0,
      alternateVerdicts: [],
    };
  }

  const sorted = [...stances].sort((a, b) => b.confidence - a.confidence);
  const primary = sorted[0];
  const alternates = sorted.slice(1);

  const sameVerdict = alternates.every((a) => a.verdict === primary.verdict);
  if (sameVerdict || alternates.length === 0) {
    return {
      hasDisagreement: false,
      explanation: '',
      primaryVerdict: primary.verdict,
      primaryConfidence: primary.confidence,
      alternateVerdicts: [],
    };
  }

  const explanation =
    `Providers gave different verdicts: ${sorted.map((s) => `${s.provider} (${s.verdict}, ${s.confidence}%)`).join('; ')}. Showing highest-confidence result.`;

  return {
    hasDisagreement: true,
    explanation,
    primaryVerdict: primary.verdict,
    primaryConfidence: primary.confidence,
    alternateVerdicts: alternates.map((a) => ({ verdict: a.verdict, confidence: a.confidence, provider: a.provider })),
  };
}
