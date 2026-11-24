import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { loadCollegeProStandings } from '@/lib/league/collegePro/loadCollegeProStandings'

export const dynamic = 'force-dynamic'

/** One standings table for a paired college + pro league. See loadCollegeProStandings. */
export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  try {
    return NextResponse.json(await loadCollegeProStandings(leagueId, userId))
  } catch {
    // The page keeps its standard standings rather than showing an error card.
    return NextResponse.json({ applies: false as const }, { status: 502 })
  }
}
