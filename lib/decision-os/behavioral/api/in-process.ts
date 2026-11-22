/**
 * Run a `/api/v1/intelligence/*` read in-process, for first-party server callers.
 *
 * WHY THIS EXISTS. Commissioner OS reached Decision OS by making an HTTP request to its OWN
 * deployment (`callDecisionOS` → `${DECISION_OS_BASE_URL}/api/v1/intelligence/...`). That needed
 * three things all set correctly in production — the base URL, a registered API key, and the
 * public-API flag — and any one missing turned five paid modules into "not yet integrated". It
 * also paid a network round trip, a JSON encode/decode and a second auth pass for data the same
 * process can compute directly. The B2C backbone is meant to be invisible plumbing; a self-call
 * that can be misconfigured is the opposite of that.
 *
 * THE TRUST BOUNDARY. The public API's key + flag gate admits EXTERNAL callers. An in-process
 * caller is already past a stronger check: Commissioner OS resolves its league from the session
 * user's own commissioned leagues (`resolveActiveLeagueId`) behind a signed-in layout and the
 * commissioner paywall. So it runs at the `commissioner` tier — exactly the scope a registered
 * commissioner key would get — and never at `platform`.
 *
 * WHAT IT SERVES. Only the league-scoped reads Commissioner OS actually calls. The two retired
 * profile routes answer 410 here exactly as they do over HTTP, so moving off HTTP cannot
 * re-open the Competitive Edge privacy boundary. Any other path returns `null`, and the caller
 * keeps its HTTP behaviour — nothing that worked before stops working.
 *
 * DATA PROVIDER. The real behavioural pipeline, not `resolveDataProvider()`'s stub default: that
 * env switch controls what the PUBLIC API exposes. Each Commissioner OS module still checks its own
 * owner-controlled `isLiveReady()` switch before calling, so this does not turn anything on by
 * itself.
 */

import 'server-only'

import {
  leagueDeadlineIntelligenceHandler,
  leagueIntelligenceHandler,
  leagueTrendIntelligenceHandler,
  type IntelligenceApiContext,
  type IntelligenceHandlerResult,
} from './intelligence-handlers'
import { realDataProvider } from './real-data-provider'

export const IN_PROCESS_TIER = 'commissioner' as const

const RETIRED_PROFILE_PATHS = new Set([
  '/api/v1/intelligence/league/managers',
  '/api/v1/intelligence/league/manager-dna',
  '/api/v1/intelligence/manager',
])

const NO_HEADERS = { get: () => null }

/** `null` means "not served in-process" — the caller should use its HTTP transport. */
export async function runIntelligenceInProcess(pathWithQuery: string): Promise<IntelligenceHandlerResult | null> {
  let url: URL
  try {
    url = new URL(pathWithQuery, 'http://in-process.invalid')
  } catch {
    return null
  }
  const path = url.pathname.replace(/\/+$/, '')

  if (RETIRED_PROFILE_PATHS.has(path)) {
    return {
      status: 410,
      body: { error: 'Use Competitive Edge within a league decision.', code: 'PROFILE_SURFACE_RETIRED' },
    }
  }

  const ctx: IntelligenceApiContext = {
    headers: NO_HEADERS,
    searchParams: url.searchParams,
    internalTier: IN_PROCESS_TIER,
  }

  switch (path) {
    case '/api/v1/intelligence/league':
      return leagueIntelligenceHandler(ctx, realDataProvider)
    case '/api/v1/intelligence/league/trend':
      return leagueTrendIntelligenceHandler(ctx)
    case '/api/v1/intelligence/league/deadlines':
      return leagueDeadlineIntelligenceHandler(ctx)
    default:
      return null
  }
}
