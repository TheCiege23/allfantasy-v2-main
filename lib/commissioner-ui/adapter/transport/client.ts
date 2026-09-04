import { fetchJsonWithRetry } from '@/lib/error-handling'
import { logStructured, createTimer } from '@/lib/logging/structured'
import type { CommissionerErrorAttributableId, CommissionerErrorCategory, CommissionerErrorContract } from '../../contracts'
import { getDecisionOSTransportConfig, isDecisionOSConfigured, type DecisionOSTransportConfig } from './config'
import { resolveDecisionOSAuthHeaders } from './auth'

export interface DecisionOSCallResult<T> {
  data: T | null
  error: CommissionerErrorContract | null
}

function notConfiguredError(moduleId: CommissionerErrorAttributableId): CommissionerErrorContract {
  return {
    category: 'upstream_unavailable',
    message: 'The live Decision OS backend is not yet integrated in this environment.',
    moduleId,
    retryable: false,
    timestamp: new Date().toISOString(),
  }
}

function categorizeStatus(status: number | undefined, isTimeout: boolean): CommissionerErrorCategory {
  if (isTimeout) return 'upstream_unavailable'
  switch (status) {
    case 400: return 'validation'
    case 401: return 'unauthorized'
    case 403: return 'forbidden'
    case 404: return 'not_found'
    case 409: return 'conflict'
    default: return status && status >= 500 ? 'upstream_unavailable' : 'unknown'
  }
}

/**
 * The one function every future real `live.ts` calls through — never a
 * second, per-module HTTP client, per the Provider Audit's own
 * recommendation. Reuses `fetchJsonWithRetry` (`lib/error-handling`,
 * already used elsewhere in this app) for the retry-with-backoff
 * transport itself rather than reimplementing it; adds a hard per-call
 * timeout via `AbortSignal.timeout` — the same idiom already used
 * elsewhere in this app (e.g. `lib/workers/providers/espn.ts`) — since
 * `fetchWithRetry` has no timeout of its own.
 *
 * Every failure mode — not configured, timeout, network error, non-2xx,
 * malformed JSON — normalizes into the exact `CommissionerErrorContract`
 * shape the adapter already expects and every stub/demo/live client
 * already returns. A real `live.ts` implementation only ever needs to
 * call this once and pass the result straight through; it never needs
 * its own error-handling, retry, or timeout code.
 */
export async function callDecisionOS<T>(
  moduleId: CommissionerErrorAttributableId,
  path: string,
  init: RequestInit = {},
  config: DecisionOSTransportConfig = getDecisionOSTransportConfig()
): Promise<DecisionOSCallResult<T>> {
  if (!isDecisionOSConfigured(config)) {
    return { data: null, error: notConfiguredError(moduleId) }
  }

  const timer = createTimer()
  const authHeaders = await resolveDecisionOSAuthHeaders(config)
  const url = `${config.baseUrl}${path}`

  // Self-referential calls into Vercel Preview/protected deployments hit Vercel's
  // own SSO wall (redirect to vercel.com/sso-api) before ever reaching this route,
  // since Deployment Protection applies to server-to-server requests exactly like
  // browser requests. VERCEL_AUTOMATION_BYPASS_SECRET (set via Project Settings ->
  // Deployment Protection -> Protection Bypass for Automation) is Vercel's own
  // documented mechanism for exempting exactly this case; absent locally and in
  // any environment without protection enabled, so this is a no-op there.
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  const bypassHeaders: Record<string, string> = bypassSecret
    ? { 'x-vercel-protection-bypass': bypassSecret }
    : {}

  try {
    const data = await fetchJsonWithRetry<T>(
      url,
      {
        ...init,
        headers: { 'Content-Type': 'application/json', ...authHeaders, ...bypassHeaders, ...init.headers },
        signal: AbortSignal.timeout(config.timeoutMs),
      },
      { context: `decision-os:${moduleId}:${path}` }
    )
    logStructured('info', 'commissioner-os-transport', 'decision_os_call_success', {
      moduleId,
      path,
      durationMs: timer.elapsedMs(),
    })
    return { data, error: null }
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'TimeoutError'
    const status = (err as { status?: number })?.status
    const message = err instanceof Error ? err.message : 'An unexpected error occurred while contacting Decision OS.'
    const category = categorizeStatus(status, isTimeout)

    logStructured('error', 'commissioner-os-transport', 'decision_os_call_failed', {
      moduleId,
      path,
      durationMs: timer.elapsedMs(),
      status: status ?? null,
      isTimeout,
      category,
      error: message,
    })

    return {
      data: null,
      error: {
        category,
        message,
        moduleId,
        retryable: category === 'upstream_unavailable' && !isTimeout,
        timestamp: new Date().toISOString(),
      },
    }
  }
}
