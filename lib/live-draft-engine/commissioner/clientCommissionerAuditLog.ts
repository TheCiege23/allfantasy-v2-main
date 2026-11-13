/**
 * Client wrapper for GET /api/leagues/[leagueId]/draft/commissioner/audit-log.
 * Read-only; commissioner-gated on the server.
 */

import type { CommissionerPickEditAction } from '@/lib/live-draft-engine/commissioner/commissionerPickEditService'

export interface CommissionerAuditLogRow {
  id: string
  action: CommissionerPickEditAction
  overallPickNumber: number
  round: number
  actorUserId: string
  oldRosterId: string | null
  newRosterId: string | null
  oldPlayerId: string | null
  oldPlayerName: string | null
  newPlayerId: string | null
  newPlayerName: string | null
  reason: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

interface CommissionerAuditLogPage {
  items: CommissionerAuditLogRow[]
  nextCursor: string | null
}

interface FetchCommissionerAuditLogParams {
  leagueId: string
  limit?: number
  cursor?: string | null
  action?: CommissionerPickEditAction | null
  since?: string | null
  until?: string | null
  signal?: AbortSignal
}

export async function fetchCommissionerAuditLog(
  params: FetchCommissionerAuditLogParams,
): Promise<CommissionerAuditLogPage> {
  const qs = new URLSearchParams()
  if (params.limit) qs.set('limit', String(params.limit))
  if (params.cursor) qs.set('cursor', params.cursor)
  if (params.action) qs.set('action', params.action)
  if (params.since) qs.set('since', params.since)
  if (params.until) qs.set('until', params.until)

  const url = `/api/leagues/${encodeURIComponent(params.leagueId)}/draft/commissioner/audit-log${
    qs.toString() ? `?${qs.toString()}` : ''
  }`

  const res = await fetch(url, {
    method: 'GET',
    cache: 'no-store',
    signal: params.signal,
  })

  let body: Record<string, unknown> = {}
  try {
    body = (await res.json()) as Record<string, unknown>
  } catch {
    /* ignore */
  }

  if (!res.ok) {
    const err = new Error(typeof body.error === 'string' ? body.error : `Audit log fetch failed (${res.status})`)
    ;(err as Error & { status?: number }).status = res.status
    throw err
  }

  const items = Array.isArray(body.items) ? (body.items as CommissionerAuditLogRow[]) : []
  const nextCursor = typeof body.nextCursor === 'string' ? body.nextCursor : null
  return { items, nextCursor }
}
