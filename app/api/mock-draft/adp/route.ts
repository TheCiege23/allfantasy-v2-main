import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { DEFAULT_SPORT, normalizeToSupportedSport } from '@/lib/sport-scope'
import { getCachedMockDraftPool } from '@/lib/mock-draft/mock-draft-pool-cache'

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const action = req.nextUrl.searchParams?.get('action') || 'live'
    const type = (req.nextUrl.searchParams?.get('type') || 'redraft') as 'dynasty' | 'redraft'
    const pool = req.nextUrl.searchParams?.get('pool') || 'all'
    const sport = normalizeToSupportedSport(req.nextUrl.searchParams?.get('sport') || DEFAULT_SPORT)
    const limit = Math.min(parseInt(req.nextUrl.searchParams?.get('limit') || '300'), sport === 'NBA' ? 1000 : 500)
    const { payload } = await getCachedMockDraftPool({
      action,
      type,
      pool,
      sport,
      limit,
      leagueId: req.nextUrl.searchParams?.get('leagueId'),
      mockDraftId: req.nextUrl.searchParams?.get('mockDraftId'),
      draftType: req.nextUrl.searchParams?.get('draftType'),
      scoring: req.nextUrl.searchParams?.get('scoring') || req.nextUrl.searchParams?.get('format'),
      teamCount: Number(req.nextUrl.searchParams?.get('teamCount') || '0'),
      season: req.nextUrl.searchParams?.get('season'),
      forceRefresh: req.nextUrl.searchParams?.get('refresh') === '1',
    })

    return NextResponse.json(payload)
  } catch (err: any) {
    console.error('[mock-draft/adp] Error:', err)
    return NextResponse.json({ error: err.message || 'Failed to fetch ADP' }, { status: 500 })
  }
}

