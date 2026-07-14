import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { assembleUserOsRecommendations } from '@/lib/shared-services/league-hub/userOsRecommendations'
import { USER_OS_DOMAINS } from '@/lib/shared-services/league-hub/recommendationContract'
import type { LeagueRecommendationDomain } from '@/lib/shared-services/league-hub/types'

export const dynamic = 'force-dynamic'

const VALID_DOMAINS = new Set<string>(USER_OS_DOMAINS)

function parseRequestedDomains(url: URL): LeagueRecommendationDomain[] | undefined {
  const raw = url.searchParams.get('domains')
  if (!raw) return undefined
  const requested = raw
    .split(',')
    .map((d) => d.trim())
    .filter((d) => VALID_DOMAINS.has(d)) as LeagueRecommendationDomain[]
  return requested.length ? requested : undefined
}

export async function GET(req: Request, { params }: { params: Promise<{ leagueId: string }> }) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const { leagueId } = await params
  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId is required' }, { status: 400 })
  }

  const requestedDomains = parseRequestedDomains(new URL(req.url))

  try {
    const result = await assembleUserOsRecommendations({
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
    console.error('[League Hub User OS Recommendations]', error)
    return NextResponse.json({ error: 'Failed to load recommendations' }, { status: 500 })
  }
}
