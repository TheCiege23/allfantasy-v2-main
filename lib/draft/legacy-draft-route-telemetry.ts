import { emitDraftHealth } from '@/lib/draft/observability'

/** Stable codes for log aggregation (no PII). */
export type LegacyDraftBlockedReason =
  | 'legacy_worker_live_blocked'
  | 'legacy_pick_make_blocked'
  | 'legacy_draft_picks_route_deprecated'
  | 'legacy_cpu_pick_live_blocked'

/** Whether `sessionId` looks like `live:…`, `mock:…`, or neither (no raw ids logged). */
export function sessionKeyPrefixShape(
  sessionId: string | null | undefined,
): 'live' | 'mock' | 'none' | 'invalid' {
  if (!sessionId) return 'none'
  if (sessionId.startsWith('live:')) return 'live'
  if (sessionId.startsWith('mock:')) return 'mock'
  return 'invalid'
}

/**
 * Phase 5F — warn-level structured log when a legacy draft HTTP route blocks or retires traffic.
 * Safe for Vercel log drains: route, reason, session key **shape** only, auth presence boolean.
 */
export function logLegacyDraftBlocked(
  route: string,
  reason: LegacyDraftBlockedReason,
  opts?: { sessionKeyShape?: ReturnType<typeof sessionKeyPrefixShape>; httpMethod?: string; authenticated?: boolean },
): void {
  emitDraftHealth('warn', 'legacy_draft_route_blocked', {
    outcome: 'blocked',
    reason,
    route,
    httpMethod: opts?.httpMethod ?? 'POST',
    authenticated: opts?.authenticated ?? false,
    sessionKeyShape: opts?.sessionKeyShape ?? 'none',
  })
}
