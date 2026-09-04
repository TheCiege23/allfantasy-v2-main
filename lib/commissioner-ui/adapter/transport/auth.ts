import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import type { DecisionOSTransportConfig } from './config'

/**
 * Auth strategy, two paths tried in order, both reusing infrastructure
 * this app already has rather than inventing a new one:
 *
 * 1. Service-to-service API key (`DECISION_OS_API_KEY`) — sent as
 *    `X-AllFantasy-API-Key`, the literal header name and `afk_{test|live}_
 *    {token}` format the ported Decision OS Intelligence API's own gate
 *    (`lib/decision-os/behavioral/api/gate.ts`) requires. Confirmed by
 *    reading that gate directly during Phase 3.2's Mission Control
 *    integration — it does not accept a generic `Authorization: Bearer`
 *    header, so this must match its exact expectation, not a generic
 *    server-to-server convention.
 * 2. Otherwise, forward the current commissioner's identity by reusing
 *    the app's own existing NextAuth session (`getServerSession(authOptions)`,
 *    the identical call already used by `app/api/user/active-league/route.ts`
 *    and others) — Commissioner OS pages already run inside this session,
 *    there is no separate "Commissioner OS auth" to build. Note: the
 *    ported Intelligence API's gate does not read this header at all
 *    today (it is API-key-only) — kept as the honest fallback for any
 *    other future real backend behind this same transport that does
 *    accept a forwarded session identity.
 *
 * Resolves to an empty header set (never throws) when neither applies —
 * a request with no identifying header is a legitimate, real state this
 * function must produce (e.g. no session in scope), not an error.
 */
export async function resolveDecisionOSAuthHeaders(
  config: DecisionOSTransportConfig
): Promise<Record<string, string>> {
  if (config.apiKey) {
    return { 'X-AllFantasy-API-Key': config.apiKey }
  }

  try {
    const session = await getServerSession(authOptions)
    const userId = session?.user?.id
    if (userId) {
      return { 'X-Commissioner-User-Id': String(userId) }
    }
  } catch {
    // No request scope to read a session from (e.g. a script/test context) — proceed with no identity header.
  }

  return {}
}
