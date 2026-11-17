/**
 * Resolves provider failure state and user-facing message (Prompt 127).
 */

import type { ProviderResultMeta } from './types';

interface ProviderFailureState {
  allFailed: boolean;
  someFailed: boolean;
  fallbackUsed: boolean;
  message: string;
  providerSummary: string[];
}

export function resolveProviderFailure(providerResults: ProviderResultMeta[]): ProviderFailureState {
  const ok = providerResults.filter((r) => r.status === 'ok');
  const failed = providerResults.filter((r) => r.status !== 'ok');

  const allFailed = providerResults.length > 0 && ok.length === 0;
  const someFailed = failed.length > 0;
  const fallbackUsed = someFailed && ok.length > 0;

  const providerSummary = providerResults.map((r) => {
    const status = r.status === 'ok' ? 'ok' : r.status === 'timeout' ? 'timeout' : r.status === 'invalid_response' ? 'invalid' : 'failed';
    return `${r.provider}: ${status}`;
  });

  let message: string;
  if (allFailed) {
    message = 'AI analysis is temporarily unavailable. You can still see deterministic (data-only) results below.';
  } else if (fallbackUsed) {
    message = `Some AI providers didn't respond; results are based on ${ok.map((r) => r.provider).join(' and ')}.`;
  } else {
    message = '';
  }

  return {
    allFailed,
    someFailed,
    fallbackUsed,
    message,
    providerSummary,
  };
}

