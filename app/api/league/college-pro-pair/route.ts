import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveLeagueAccess } from '@/lib/league-access'
import { loadCollegeProPairLink } from '@/lib/league/collegePro/pairLink'

export const dynamic = 'force-dynamic'

/** The league this one is paired with (college + pro), for the page's one-league links. See pairLink.ts. */
export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  if ((await resolveLeagueAccess(leagueId, userId)) == null) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    return NextResponse.json(await loadCollegeProPairLink(leagueId, userId))
  } catch {
    // The page simply shows no link rather than an error.
    return NextResponse.json({ applies: false as const }, { status: 502 })
  }
}
