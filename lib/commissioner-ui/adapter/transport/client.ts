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
  /*
   * In-process first (2026-11-14). The intelligence reads Commissioner OS makes are served by this
   * same deployment, so they now run as a function call instead of an HTTP request back to
   * ourselves — no DECISION_OS_BASE_URL, API key or public-API flag required, and no round trip.
   * See lib/decision-os/behavioral/api/in-process.ts for the trust boundary. A path it does not
   * serve falls through to the HTTP transport below, unchanged. DECISION_OS_TRANSPORT=http forces
   * the old behaviour, as a rollback lever.
   */
  if (shouldTryInProcess(path, init)) {
    const inProcess = await callInProcess<T>(moduleId, path)
    if (inProcess) return inProcess
  }

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

const IN_PROCESS_PREFIX = '/api/v1/intelligence/'

function shouldTryInProcess(path: string, init: RequestInit): boolean {
  if (process.env.DECISION_OS_TRANSPORT?.trim().toLowerCase() === 'http') return false
  const method = (init.method ?? 'GET').toUpperCase()
  return method === 'GET' && path.startsWith(IN_PROCESS_PREFIX)
}

/**
 * `null` when the path is not served in-process (the caller then uses HTTP). A non-2xx result is
 * mapped through the same `categorizeStatus` the HTTP path uses, so a module cannot tell which
 * transport answered — only that it was faster.
 */
async function callInProcess<T>(
  moduleId: CommissionerErrorAttributableId,
  path: string,
): Promise<DecisionOSCallResult<T> | null> {
  const timer = createTimer()
  try {
    const { runIntelligenceInProcess } = await import('@/lib/decision-os/behavioral/api/in-process')
    const result = await runIntelligenceInProcess(path)
    if (!result) return null

    if (result.status >= 200 && result.status < 300) {
      logStructured('info', 'commissioner-os-transport', 'decision_os_call_success', {
        moduleId,
        path,
        transport: 'in-process',
        durationMs: timer.elapsedMs(),
      })
      return { data: result.body as T, error: null }
    }

    const category = categorizeStatus(result.status, false)
    const body = result.body as { message?: unknown; error?: unknown } | null
    const message =
      typeof body?.message === 'string' ? body.message
      : typeof body?.error === 'string' ? body.error
      : `Decision OS returned ${result.status}.`
    logStructured('warn', 'commissioner-os-transport', 'decision_os_call_failed', {
      moduleId,
      path,
      transport: 'in-process',
      durationMs: timer.elapsedMs(),
      status: result.status,
      category,
      error: message,
    })
    return {
      data: null,
      error: {
        category,
        message,
        moduleId,
        retryable: category === 'upstream_unavailable',
        timestamp: new Date().toISOString(),
      },
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'An unexpected error occurred inside Decision OS.'
    logStructured('error', 'commissioner-os-transport', 'decision_os_call_failed', {
      moduleId,
      path,
      transport: 'in-process',
      durationMs: timer.elapsedMs(),
      status: null,
      category: 'upstream_unavailable',
      error: message,
    })
    return {
      data: null,
      error: {
        category: 'upstream_unavailable',
        message,
        moduleId,
        retryable: true,
        timestamp: new Date().toISOString(),
      },
    }
  }
}
