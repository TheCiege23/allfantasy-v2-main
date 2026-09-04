/**
 * Decision OS transport configuration — read directly from `process.env`
 * at call time, the same convention every other external integration in
 * this app already uses (no shared env-schema-validation layer exists
 * here to plug into; see e.g. `process.env.ROLLING_INSIGHTS_API_KEY` in
 * `lib/rolling-insights.ts`). Three variables, following the exact
 * `{PROVIDER}_API_KEY` / `{PROVIDER}_BASE_URL` naming convention already
 * established for every other provider in `.env.example`
 * (`OPENAI_API_KEY`/`OPENAI_BASE_URL`, `DEEPSEEK_API_KEY`/`DEEPSEEK_BASE_URL`,
 * `ROLLING_INSIGHTS_API_KEY`/`ROLLING_INSIGHTS_BASE_URL`, etc.) rather than
 * inventing a new one.
 */
export interface DecisionOSTransportConfig {
  baseUrl: string | null
  apiKey: string | null
  timeoutMs: number
}

const DEFAULT_TIMEOUT_MS = 10_000

export function getDecisionOSTransportConfig(): DecisionOSTransportConfig {
  const timeoutRaw = Number(process.env.DECISION_OS_TIMEOUT_MS)
  return {
    baseUrl: process.env.DECISION_OS_BASE_URL?.trim() || null,
    apiKey: process.env.DECISION_OS_API_KEY?.trim() || null,
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : DEFAULT_TIMEOUT_MS,
  }
}

/**
 * True once a real backend has been pointed at — the only thing that
 * distinguishes "live mode selected but nothing configured yet" (today,
 * always) from "a real Decision OS is reachable" (once `DECISION_OS_BASE_URL`
 * is actually set, in some future environment). Never assumed true.
 */
export function isDecisionOSConfigured(config: DecisionOSTransportConfig = getDecisionOSTransportConfig()): boolean {
  return Boolean(config.baseUrl)
}
