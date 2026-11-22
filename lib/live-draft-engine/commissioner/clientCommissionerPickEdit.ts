/**
 * Client wrapper for POST /api/leagues/[leagueId]/draft/commissioner/pick-edit.
 * Throws CommissionerPickEditClientError on non-2xx so callers can branch on
 * code (e.g. ROSTER_ELIGIBILITY → show "Force anyway" prompt).
 */

import type { DraftSessionSnapshot } from '@/lib/live-draft-engine/types'
import type { CommissionerPickEditAction } from '@/lib/live-draft-engine/commissioner/commissionerPickEditService'

export interface CommissionerPickEditClientParams {
  leagueId: string
  action: CommissionerPickEditAction
  overallPickNumber: number
  reason?: string | null
  force?: boolean
  playerName?: string | null
  position?: string | null
  team?: string | null
  byeWeek?: number | null
  playerId?: string | null
  playerImageUrl?: string | null
  newRosterId?: string | null
  /** Slice 2 — required when the server rejects with SELF_BENEFIT_CONFIRM_REQUIRED. */
  confirmSelfBenefit?: boolean
}

interface CommissionerPickEditWarning {
  message: string
}

export class CommissionerPickEditClientError extends Error {
  status: number
  code?: string
  warnings?: CommissionerPickEditWarning[]
  snapshot?: DraftSessionSnapshot

  constructor(opts: {
    status: number
    message: string
    code?: string
    warnings?: CommissionerPickEditWarning[]
    snapshot?: DraftSessionSnapshot
  }) {
    super(opts.message)
    this.name = 'CommissionerPickEditClientError'
    this.status = opts.status
    this.code = opts.code
    this.warnings = opts.warnings
    this.snapshot = opts.snapshot
  }
}

export async function commissionerPickEditClient(
  params: CommissionerPickEditClientParams,
): Promise<DraftSessionSnapshot> {
  const { leagueId, ...body } = params
  const res = await fetch(
    `/api/leagues/${encodeURIComponent(leagueId)}/draft/commissioner/pick-edit`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    },
  )

  let data: Record<string, unknown> = {}
  try {
    data = (await res.json()) as Record<string, unknown>
  } catch {
    /* ignore parse error – we'll fall through */
  }

  if (!res.ok) {
    throw new CommissionerPickEditClientError({
      status: res.status,
      message: typeof data.error === 'string' ? data.error : `Request failed (${res.status})`,
      code: typeof data.code === 'string' ? data.code : undefined,
      warnings: Array.isArray(data.warnings)
        ? (data.warnings as CommissionerPickEditWarning[])
        : undefined,
      snapshot:
        data.session && typeof data.session === 'object'
          ? (data.session as DraftSessionSnapshot)
          : undefined,
    })
  }

  if (!data.session || typeof data.session !== 'object') {
    throw new CommissionerPickEditClientError({
      status: res.status,
      message: 'Server returned no draft session snapshot.',
    })
  }

  return data.session as DraftSessionSnapshot
}
