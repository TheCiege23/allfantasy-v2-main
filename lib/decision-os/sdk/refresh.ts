/**
 * Decision OS — Phase 7.4 Widget SDK refresh strategy contract.
 *
 * Six deterministic refresh triggers. No timer implementation — only the
 * contract a runtime uses to configure its own refresh scheduling.
 *
 * ADR: PHASE_7_4_WIDGET_SDK_ADR.md
 */

import type { SDKRefreshStrategyConfig, SDKRefreshTrigger } from './types'

interface SDKRefreshDefaults {
  intervalSeconds: number | null
  maxRetries: number
  backoffSeconds: number
}

export const REFRESH_DEFAULTS: Readonly<Record<SDKRefreshTrigger, SDKRefreshDefaults>> = {
  manual:            { intervalSeconds: null, maxRetries: 0, backoffSeconds: 0 },
  scheduled:         { intervalSeconds: 300,  maxRetries: 3, backoffSeconds: 5 },
  visibility_change: { intervalSeconds: null, maxRetries: 2, backoffSeconds: 2 },
  api_push:          { intervalSeconds: null, maxRetries: 0, backoffSeconds: 0 },
  host_callback:     { intervalSeconds: null, maxRetries: 1, backoffSeconds: 1 },
  offline_retry:     { intervalSeconds: 30,   maxRetries: 5, backoffSeconds: 10 },
}

export const ALL_REFRESH_TRIGGERS: readonly SDKRefreshTrigger[] = [
  'manual', 'scheduled', 'visibility_change', 'api_push', 'host_callback', 'offline_retry',
]

/** Triggers that require a positive intervalSeconds. */
const INTERVAL_REQUIRED_TRIGGERS: readonly SDKRefreshTrigger[] = ['scheduled', 'offline_retry']

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Resolves a full refresh strategy config for a trigger, applying defaults
 * and merging any overrides. Deterministic.
 */
export function resolveRefreshStrategy(
  trigger: SDKRefreshTrigger,
  overrides: Partial<Omit<SDKRefreshStrategyConfig, 'trigger'>> = {},
): SDKRefreshStrategyConfig {
  const defaults = REFRESH_DEFAULTS[trigger]
  return {
    trigger,
    intervalSeconds: overrides.intervalSeconds ?? defaults.intervalSeconds,
    maxRetries: overrides.maxRetries ?? defaults.maxRetries,
    backoffSeconds: overrides.backoffSeconds ?? defaults.backoffSeconds,
  }
}

export interface RefreshValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * Validates a refresh strategy config. 'scheduled' and 'offline_retry'
 * require a positive intervalSeconds; other triggers must not carry one.
 */
export function validateRefreshStrategy(config: SDKRefreshStrategyConfig): RefreshValidationResult {
  const errors: string[] = []

  if (!ALL_REFRESH_TRIGGERS.includes(config.trigger)) {
    errors.push(`trigger '${config.trigger}' is not a valid refresh trigger`)
    return { valid: false, errors }
  }

  const requiresInterval = INTERVAL_REQUIRED_TRIGGERS.includes(config.trigger)
  if (requiresInterval && (config.intervalSeconds === null || config.intervalSeconds <= 0)) {
    errors.push(`trigger '${config.trigger}' requires a positive intervalSeconds`)
  }
  if (!requiresInterval && config.intervalSeconds !== null) {
    errors.push(`trigger '${config.trigger}' must not carry an intervalSeconds`)
  }

  if (config.maxRetries < 0) {
    errors.push('maxRetries must be >= 0')
  }
  if (config.backoffSeconds < 0) {
    errors.push('backoffSeconds must be >= 0')
  }

  return { valid: errors.length === 0, errors }
}
