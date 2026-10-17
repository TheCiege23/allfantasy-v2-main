import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveLeagueMembership } from '@/lib/league-access'
import { getBigBrotherSchedule } from '@/lib/big-brother/BigBrotherScheduleService'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  const access = await resolveLeagueMembership(leagueId, session.user.id)
  if (!access.ok) return NextResponse.json({ error: access.status === 404 ? 'League not found' : 'Forbidden' }, { status: access.status })
  try {
    const schedule = await getBigBrotherSchedule(leagueId)
    if (!schedule) return NextResponse.json({ error: 'Not a Big Brother league' }, { status: 404 })
    return NextResponse.json({ ...schedule, isCommissioner: access.access.isCommissioner }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return NextResponse.json({ error: 'Unable to load Big Brother schedule. Please retry.' }, { status: 500 })
  }
}
