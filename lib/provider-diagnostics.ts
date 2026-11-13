/**
 * PROMPT 155 — Provider diagnostics (re-export from admin service for use by orchestration).
 * Tracks recent failures, fallback events, latency. Safe only — no secrets.
 */

export {
  recordProviderFailure,
  recordProviderFallback,
  recordProviderLatency,
  recordDegradedModeActivation,
  logDiagnosticsEvent,
  getProviderDiagnostics,
  type ProviderId,
} from '@/lib/admin/provider-status-service'
