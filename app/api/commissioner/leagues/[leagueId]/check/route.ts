import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { readCommissionerStanding } from '@/lib/league/commissionerAccess'

/**
 * Is the viewer a commissioner of this league, and which areas may they change (2026-11-16)?
 *
 * `isCommissioner` used to be the head commissioner only, so a co-commissioner never saw the commissioner tools in the
 * nav, the chat dock or the broadcast page — tools whose writes they were allowed to make. It is now any commissioner;
 * `scopes` says which areas (lib/league/commissionerAccess.ts), and `isHeadCommissioner` the head-only tools.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  const leagueId = params.leagueId
  if (!leagueId) return NextResponse.json({ error: 'League ID required' }, { status: 400 })
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const standing = await readCommissionerStanding(leagueId, userId)
  return NextResponse.json({
    isCommissioner: standing.role != null,
    isHeadCommissioner: standing.role === 'head',
    scopes: standing.scopes,
  })
}
