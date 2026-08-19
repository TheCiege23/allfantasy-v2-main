/**
 * POST /api/leagues/import/resync
 * Re-run normalization + merge for an already-imported external league (commissioner / owner).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireVerifiedUser } from '@/lib/auth-guard'
import { resolveProvider } from '@/lib/league-import/ImportProviderResolver'
import { isImportProviderAvailable } from '@/lib/league-import/provider-ui-config'
import { resyncImportedLeague } from '@/lib/league-import/resyncImportUtility'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const auth = await requireVerifiedUser()
  if (!auth.ok) return auth.response

  const body = await req.json().catch(() => ({}))
  const provider = resolveProvider(typeof body.provider === 'string' ? body.provider : '')
  const sourceId = typeof body.sourceId === 'string' ? body.sourceId.trim() : ''

  if (!provider || !sourceId) {
    return NextResponse.json({ error: 'provider and sourceId required' }, { status: 400 })
  }
  if (!isImportProviderAvailable(provider)) {
    return NextResponse.json({ error: `Import from ${provider} is not available.` }, { status: 400 })
  }

  const out = await resyncImportedLeague({
    userId: auth.userId,
    provider,
    sourceId,
  })
  if (!out.ok) {
    // Normalization / audit failed (e.g. league not found, normalization error) — a client-side issue.
    return NextResponse.json({ ok: false, error: out.error }, { status: 400 })
  }

  // Sanitized diagnostics only — never a provider payload, credentials, lock token, or raw error detail.
  const base = {
    leagueId: out.leagueId,
    runId: out.runId,
    warningCount: out.warningCount,
    reviewRequired: out.reviewRequired,
  }
  const refresh = out.refresh

  // Non-Sleeper providers have no durable read-model refresh step — preserve existing success behavior.
  if (refresh === null) {
    return NextResponse.json({ ok: true, ...base })
  }

  // A pre-run authorization / not-found / invalid-connection failure keeps its appropriate 4xx meaning.
  if (refresh.kind === 'auth') {
    return NextResponse.json(
      { ok: false, ...base, refresh: { status: 'not_authorized' }, error: refresh.error },
      { status: refresh.httpStatus },
    )
  }

  // Sleeper durable-refresh outcome → honest HTTP status. A non-completed refresh is NEVER reported as success.
  const refreshResult = { status: refresh.status, advancedFreshness: refresh.advancedFreshness, executed: refresh.executed }

  if (refresh.status === 'completed' && refresh.advancedFreshness === true && refresh.executed === true) {
    return NextResponse.json({ ok: true, ...base, refresh: refreshResult })
  }
  if (refresh.status === 'locked') {
    return NextResponse.json(
      { ok: false, ...base, refresh: refreshResult, error: 'This league is already being refreshed. Try again shortly.' },
      { status: 409 },
    )
  }
  if (refresh.status === 'partial' || refresh.status === 'failed') {
    return NextResponse.json(
      { ok: false, ...base, refresh: refreshResult, error: 'The existing league data was preserved, but the refresh did not complete. Please try again shortly.' },
      { status: 503 },
    )
  }
  // Unknown or non-executed durable outcome — fail closed rather than reporting success.
  return NextResponse.json(
    { ok: false, ...base, refresh: refreshResult, error: 'The refresh did not complete. The existing league data was preserved.' },
    { status: 503 },
  )
}
