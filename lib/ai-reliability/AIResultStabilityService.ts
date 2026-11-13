/**
 * Orchestrates stable AI result: run analysis, on full failure return deterministic + explanation (Prompt 127).
 */

import type { ReliabilityMetadata, ProviderResultMeta } from './types';
import { resolveProviderFailure } from './ProviderFailureResolver';

/**
 * Build reliability metadata from provider results and optional consensus/gate.
 */
export function buildReliabilityMetadata(params: {
  providerResults: ProviderResultMeta[];
  confidence: number;
  usedDeterministicFallback: boolean;
  fallbackExplanation?: string;
  dataQualityWarnings?: string[];
  hardViolation?: boolean;
}): ReliabilityMetadata {
  const failureState = resolveProviderFailure(params.providerResults);
  return {
    confidence: params.confidence,
    usedDeterministicFallback: params.usedDeterministicFallback,
    providerResults: params.providerResults,
    fallbackExplanation: params.fallbackExplanation ?? (failureState.allFailed ? failureState.message : undefined),
    dataQualityWarnings: params.dataQualityWarnings ?? [],
    hardViolation: params.hardViolation ?? false,
  };
}

