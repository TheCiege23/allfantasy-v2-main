/**
 * Browser client for the two trade-reversal endpoints.
 *
 *   generic  POST /api/leagues/[leagueId]/trades/[tradeId]/process   { action: 'reverse_preflight' | 'reverse' }
 *   native   POST /api/redraft/trade-votes                            { action: 'commissioner_reverse_preflight' | 'commissioner_reverse' }
 *
 * ⚠ THE READINESS TYPE IS DECLARED HERE, NOT IMPORTED FROM THE SERVER MODULES. `lib/league-trade-engine/
 * tradeReversal` and `lib/redraft/tradeReversal` are server code; importing their types into a client
 * bundle couples the UI to modules it must never load, and to their exact blocker unions. This file
 * types the JSON the routes return, which is the actual contract between them.
 *
 * ⚠ THESE HELPERS NEVER THROW ON AN HTTP ERROR. A reversal refusal is an expected, explainable answer
 * — "a roster changed since this trade" — and turning it into an exception would push every caller
 * into a generic "something went wrong". They return an outcome the dialog can render as-is.
 */

export type ReversalReadiness = {
  ok: boolean
  blockers: string[]
  drift?: { rosterId: string; expected: string; actual: string }[]
}

export type ReversalPreflight = { ok: true; readiness: ReversalReadiness } | { ok: false; message: string }

export type ReversalOutcome =
  | { ok: true }
  | { ok: false; message: string; readiness: ReversalReadiness | null }

/**
 * Plain-language copy for every blocker either engine can return.
 *
 * A commissioner is deciding whether to undo two managers' trade. `ROSTER_CHANGED_SINCE_EXECUTION` means
 * nothing to them; "one of these rosters has changed since" does, and it tells them what to go and look
 * at. Unknown codes still render — with the code — rather than as a blank refusal.
 */
const BLOCKER_COPY: Record<string, string> = {
  NO_EXECUTION_SNAPSHOT:
    'This trade went through before AllFantasy started recording trade evidence, so there is nothing to restore it from.',
  ROSTER_CHANGED_SINCE_EXECUTION:
    'One of these rosters has changed since the trade went through. Reversing it now would also undo those later moves.',
  ALREADY_REVERSED: 'This trade has already been reversed.',
  TRADE_NOT_PROCESSED: 'This trade has not been processed yet, so there is nothing to reverse.',
  PROPOSAL_NOT_ACCEPTED: 'This trade has not been accepted, so there is nothing to reverse.',
  TRADE_NOT_FOUND: 'This trade could not be found.',
  PROPOSAL_NOT_FOUND: 'This trade could not be found.',
  ROSTER_MISSING: 'One of the rosters in this trade no longer exists.',
  SNAPSHOT_NOT_GENERIC: 'This trade was recorded by a different trade system and cannot be reversed here.',
  SNAPSHOT_NOT_NATIVE: 'This trade was recorded by a different trade system and cannot be reversed here.',
  CAP_LEDGER_MISSING: 'Part of this trade’s salary-cap record is missing, so it cannot be reversed safely.',
  CAP_RECORD_MOVED_SINCE_EXECUTION:
    'A salary that moved in this trade has changed since, so it cannot be put back safely.',
}

export function describeBlocker(code: string): string {
  return BLOCKER_COPY[code] ?? `This trade cannot be reversed (${code}).`
}

function readReadiness(value: unknown): ReversalReadiness | null {
  if (!value || typeof value !== 'object') return null
  const v = value as { ok?: unknown; blockers?: unknown; drift?: unknown }
  if (typeof v.ok !== 'boolean' || !Array.isArray(v.blockers)) return null
  return {
    ok: v.ok,
    blockers: v.blockers.filter((b): b is string => typeof b === 'string'),
    drift: Array.isArray(v.drift) ? (v.drift as ReversalReadiness['drift']) : undefined,
  }
}

/** `status: 0` means the request did not complete — which is NOT the same as "the server said no". */
async function post(url: string, body: unknown): Promise<{ status: number; body: unknown }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { status: res.status, body: await res.json().catch(() => null) }
  } catch {
    return { status: 0, body: null }
  }
}

function errorText(body: unknown): string | null {
  if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
    return (body as { error: string }).error
  }
  return null
}

function toPreflight(r: { status: number; body: unknown }): ReversalPreflight {
  if (r.status >= 200 && r.status < 300) {
    const readiness = readReadiness((r.body as { readiness?: unknown } | null)?.readiness)
    if (readiness) return { ok: true, readiness }
  }
  if (r.status === 0) return { ok: false, message: 'Could not reach AllFantasy to check this trade. Try again.' }
  if (r.status === 403) return { ok: false, message: 'Only a commissioner can reverse a trade.' }
  return { ok: false, message: errorText(r.body) ?? 'Could not check whether this trade can be reversed.' }
}

function toOutcome(r: { status: number; body: unknown }): ReversalOutcome {
  if (r.status >= 200 && r.status < 300 && (r.body as { ok?: unknown } | null)?.ok === true) {
    return { ok: true }
  }
  /*
   * ⚠ A TRANSPORT FAILURE MUST NOT SAY "NOTHING WAS CHANGED". The request may have reached the server
   * and committed before the connection dropped. Every server-side refusal below is safe to describe as
   * a no-op — the reversal runs in one transaction and refuses before writing — but a dropped request
   * is an unknown, and telling a commissioner otherwise invites a second attempt on a trade that is
   * already reversed.
   */
  if (r.status === 0) {
    return {
      ok: false,
      message: 'The connection dropped before AllFantasy confirmed the result. Refresh to see whether the trade was reversed.',
      readiness: null,
    }
  }
  const readiness = readReadiness((r.body as { readiness?: unknown } | null)?.readiness)
  if (r.status === 403) {
    return { ok: false, message: 'Only a commissioner can reverse a trade. Nothing was changed.', readiness }
  }
  return {
    ok: false,
    message: `${errorText(r.body) ?? 'The trade could not be reversed.'} Nothing was changed.`,
    readiness,
  }
}

function tradeProcessUrl(leagueId: string, tradeId: string): string {
  return `/api/leagues/${encodeURIComponent(leagueId)}/trades/${encodeURIComponent(tradeId)}/process`
}

export async function previewGenericTradeReversal(leagueId: string, tradeId: string): Promise<ReversalPreflight> {
  return toPreflight(await post(tradeProcessUrl(leagueId, tradeId), { action: 'reverse_preflight' }))
}

export async function requestGenericTradeReversal(
  leagueId: string,
  tradeId: string,
  reason: string,
): Promise<ReversalOutcome> {
  return toOutcome(await post(tradeProcessUrl(leagueId, tradeId), { action: 'reverse', reason }))
}

export async function previewNativeTradeReversal(proposalId: string): Promise<ReversalPreflight> {
  return toPreflight(
    await post('/api/redraft/trade-votes', { proposalId, action: 'commissioner_reverse_preflight' }),
  )
}

export async function requestNativeTradeReversal(proposalId: string, reason: string): Promise<ReversalOutcome> {
  return toOutcome(
    await post('/api/redraft/trade-votes', { proposalId, action: 'commissioner_reverse', reason }),
  )
}
