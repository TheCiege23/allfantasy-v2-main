import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { assembleCommissionerOsRecommendations, type CommissionerDomainKey } from '@/lib/shared-services/league-hub/commissionerOsRecommendations'

export const dynamic = 'force-dynamic'

const VALID_DOMAINS = new Set<string>(['health', 'engagement', 'rankings', 'storylines', 'rivalries', 'draft', 'trades', 'integrity'])

function parseRequestedDomains(url: URL): CommissionerDomainKey[] | undefined {
  const raw = url.searchParams.get('domains')
  if (!raw) return undefined
  const requested = raw
    .split(',')
    .map((d) => d.trim())
    .filter((d) => VALID_DOMAINS.has(d)) as CommissionerDomainKey[]
  return requested.length ? requested : undefined
}

/**
 * A normal manager gets the same 404 a nonexistent league would — never a
 * distinguishable "you're not the commissioner" response, which would leak
 * whether a protected league exists to someone who merely knows its id.
 */
export async function GET(req: Request, { params }: { params: Promise<{ leagueId: string }> }) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const { leagueId } = await params
  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId is required' }, { status: 400 })
  }

  const requestedDomains = parseRequestedDomains(new URL(req.url))

  try {
    const result = await assembleCommissionerOsRecommendations({
      appUserId: auth.userId,
      canonicalLeagueId: leagueId,
      requestedDomains,
    })

    if (result.accessDenied) {
      return NextResponse.json({ error: 'League not found or not accessible' }, { status: 404 })
    }

    return NextResponse.json({
      bundle: result.bundle,
      domainStatus: result.domainStatus,
      generatedAt: result.generatedAt,
    })
  } catch (error: unknown) {
    console.error('[League Hub Commissioner OS Recommendations]', error)
    return NextResponse.json({ error: 'Failed to load commissioner recommendations' }, { status: 500 })
  }
}
