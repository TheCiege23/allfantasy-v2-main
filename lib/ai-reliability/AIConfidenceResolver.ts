/**
 * Resolves final confidence from deterministic + LLM + data quality (Prompt 127).
 */

import { capConfidenceByDataQuality, type FactGuardInput, type FactGuardResult } from './AIFactGuard';
import type { ProviderResultMeta } from './types';

interface ConfidenceInput {
  deterministicConfidence: number;
  llmConfidence?: number;
  dataCoveragePercent?: number;
  missingDataCount?: number;
  injuryDataStale?: boolean;
  valuationDataStale?: boolean;
  adpDataStale?: boolean;
  providerResults?: ProviderResultMeta[];
}

interface ConfidenceResult {
  finalConfidence: number;
  source: 'deterministic' | 'llm' | 'capped';
  factGuard: FactGuardResult;
  /** When true, one or more providers failed but we still have a result */
  partialProviderFailure: boolean;
}

/**
 * Resolve final confidence: prefer LLM when available and valid, apply fact guard ceiling.
 */
export function resolveConfidence(input: ConfidenceInput): ConfidenceResult {
  const baseConfidence = input.llmConfidence != null && input.llmConfidence >= 0
    ? Math.min(100, Math.max(0, input.llmConfidence))
    : input.deterministicConfidence;

  const factGuardInput: FactGuardInput = {
    confidence: baseConfidence,
    dataCoveragePercent: input.dataCoveragePercent,
    missingDataCount: input.missingDataCount,
    injuryDataStale: input.injuryDataStale,
    valuationDataStale: input.valuationDataStale,
    adpDataStale: input.adpDataStale,
  };

  const factGuard = capConfidenceByDataQuality(factGuardInput);

  const partialProviderFailure =
    Array.isArray(input.providerResults) &&
    input.providerResults.some((r) => r.status !== 'ok') &&
    input.providerResults.some((r) => r.status === 'ok');

  let source: ConfidenceResult['source'] = 'deterministic';
  if (input.llmConfidence != null && input.llmConfidence >= 0) {
    source = factGuard.cappedConfidence < baseConfidence ? 'capped' : 'llm';
  }

  return {
    finalConfidence: factGuard.cappedConfidence,
    source,
    factGuard,
    partialProviderFailure,
  };
}
