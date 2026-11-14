/**
 * AI reliability layer types (Prompt 127).
 */

type ProviderStatus = 'ok' | 'failed' | 'timeout' | 'invalid_response';

export interface ProviderResultMeta {
  provider: string;
  status: ProviderStatus;
  error?: string;
  latencyMs?: number;
}

export interface ReliabilityMetadata {
  /** Final confidence 0–100 after guards */
  confidence: number;
  /** Whether result used deterministic-only fallback */
  usedDeterministicFallback: boolean;
  /** Provider results (ok/failed/etc.) */
  providerResults: ProviderResultMeta[];
  /** Human-readable fallback explanation when AI failed */
  fallbackExplanation?: string;
  /** Data quality / fact-guard warnings */
  dataQualityWarnings: string[];
  /** Whether any hard rule was violated */
  hardViolation: boolean;
}

