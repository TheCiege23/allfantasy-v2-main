import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { loadCollegeProRoster } from '@/lib/league/collegePro/loadCollegeProRoster'

export const dynamic = 'force-dynamic'

/** Both halves of a college + pro league (C2C / Devy) as one roster page. See loadCollegeProRoster. */
export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  try {
    return NextResponse.json(await loadCollegeProRoster(leagueId, userId))
  } catch {
    // The page falls back to its standard roster view rather than showing an error card.
    return NextResponse.json({ applies: false as const, error: 'Roster unavailable' }, { status: 502 })
  }
}
