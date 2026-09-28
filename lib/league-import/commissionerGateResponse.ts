/**
 * The commissioner gate's refusal, turned into the HTTP response every import-writing route
 * returns. Moved out of `app/api/leagues/import/commit/route.ts` when the two legacy routes
 * (`/api/import-espn`, `/api/mfl/import`) started running the same gate — three copies of one
 * status mapping is how they drift apart.
 *
 * ⚠ TYPE-ONLY IMPORT OF THE GATE ON PURPOSE. Route tests `vi.mock('@/lib/league-import/commissionerGate')`
 * with just the two functions they need; a runtime import from there would hand this module
 * `undefined` inside those suites.
 */

import { NextResponse } from 'next/server'
import type { CommissionerGateResult } from './commissionerGate'

/**
 * 🛑 `CommissionerGateResult.notFound`'S OWN DOC COMMENT SAYS "maps to 404, not 403" — the
 * commit route used to answer 403 for every refusal regardless. A bulk run needs the split: a
 * 429 on one league means slow the whole run down, a 404 never resolves on retry, and neither
 * is the caller lacking permission. 5xx is bucketed to 503 ("their side, retry later"); 429
 * passes through as itself. Everything else (not-linked, not-a-member, attestation-required)
 * stays 403.
 */
export function mapGateFailureStatus(gate: Pick<CommissionerGateResult, 'notFound' | 'status'>): number {
  if (gate.notFound) return 404
  if (gate.status === 429) return 429
  if (gate.status != null && gate.status >= 500) return 503
  return 403
}

export function commissionerGateFailureCode(gate: CommissionerGateResult): string {
  if (gate.requiresAttestation) return 'ATTESTATION_REQUIRED'
  if (gate.notFound) return 'LEAGUE_NOT_FOUND'
  if (gate.status === 429 || (gate.status != null && gate.status >= 500)) return 'PROVIDER_UNAVAILABLE'
  return 'NOT_COMMISSIONER'
}

/**
 * Where the confirm-you-are-commissioner checkbox lives. The legacy import forms
 * (EspnImportForm, LegacyImportForm) have no attestation UI and only render `data.error`, so a
 * bare "confirm you are the commissioner" would ask for something the screen cannot collect.
 */
export const ATTESTATION_UI_HINT = 'Import this league from /import, where you can confirm that.'

export function commissionerGateFailureResponse(
  gate: CommissionerGateResult,
  opts: { attestationHint?: boolean } = {},
): NextResponse {
  const reason = gate.reason ?? 'Commissioner verification failed.'
  return NextResponse.json(
    {
      error: gate.requiresAttestation && opts.attestationHint ? `${reason} ${ATTESTATION_UI_HINT}` : reason,
      code: commissionerGateFailureCode(gate),
      requiresAttestation: gate.requiresAttestation ?? false,
    },
    { status: mapGateFailureStatus(gate) },
  )
}
