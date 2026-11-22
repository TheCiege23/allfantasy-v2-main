/**
 * Fact guard: block unsupported claims, cap confidence by data quality (Prompt 127).
 * Delegates to trade-engine quality-gate where applicable; provides shared helpers.
 */

const MAX_CONFIDENCE_FOR_STALE_INJURY = 70;
const MAX_CONFIDENCE_FOR_STALE_VALUATION = 65;

export interface FactGuardInput {
  confidence: number;
  dataCoveragePercent?: number;
  missingDataCount?: number;
  injuryDataStale?: boolean;
  valuationDataStale?: boolean;
  adpDataStale?: boolean;
}

export interface FactGuardResult {
  cappedConfidence: number;
  violations: { rule: string; detail: string; severity: 'hard' | 'soft' }[];
  blocked: boolean;
}

/**
 * Cap confidence based on data quality. Does not run full quality gate (see trade-engine/quality-gate).
 */
export function capConfidenceByDataQuality(input: FactGuardInput): FactGuardResult {
  const violations: FactGuardResult['violations'] = [];
  let ceiling = 100;

  if (input.dataCoveragePercent != null) {
    if (input.dataCoveragePercent <= 30) {
      ceiling = Math.min(ceiling, 35);
      violations.push({
        rule: 'coverage_tier',
        detail: `Data coverage ${input.dataCoveragePercent}% — confidence capped`,
        severity: 'soft',
      });
    } else if (input.dataCoveragePercent <= 50) {
      ceiling = Math.min(ceiling, 55);
      violations.push({
        rule: 'coverage_tier',
        detail: `Data coverage ${input.dataCoveragePercent}% — confidence capped`,
        severity: 'soft',
      });
    } else if (input.dataCoveragePercent <= 70) {
      ceiling = Math.min(ceiling, 75);
    } else if (input.dataCoveragePercent < 85) {
      ceiling = Math.min(ceiling, 90);
    }
  }

  if ((input.missingDataCount ?? 0) > 0) {
    const penalty = Math.min(input.missingDataCount! * 5, 25);
    const dataCeiling = Math.max(55, 80 - penalty);
    if (dataCeiling < ceiling) {
      ceiling = dataCeiling;
      violations.push({
        rule: 'missing_data',
        detail: `${input.missingDataCount} missing fields — confidence reduced`,
        severity: 'soft',
      });
    }
  }

  if (input.injuryDataStale) {
    ceiling = Math.min(ceiling, MAX_CONFIDENCE_FOR_STALE_INJURY);
    violations.push({
      rule: 'stale_injury',
      detail: 'Injury data is stale',
      severity: 'soft',
    });
  }

  if (input.valuationDataStale) {
    ceiling = Math.min(ceiling, MAX_CONFIDENCE_FOR_STALE_VALUATION);
    violations.push({
      rule: 'stale_valuation',
      detail: 'Valuation data is stale',
      severity: 'soft',
    });
  }

  const cappedConfidence = Math.min(input.confidence, ceiling);
  return {
    cappedConfidence,
    violations,
    blocked: false,
  };
}

/**
 * Block if confidence would be forced to zero or below threshold for "supported" claim.
 */
export function blockUnsupportedClaim(
  confidence: number,
  minThreshold: number = 40
): boolean {
  return confidence < minThreshold;
}
