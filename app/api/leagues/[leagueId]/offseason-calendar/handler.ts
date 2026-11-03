/**
 * GET — the dynasty offseason calendar (lib/dynasty-core/offseasonCalendar.ts): what happens between the
 * champion and the next kickoff, and which steps AllFantasy takes by itself. `{ calendar: null }` outside
 * the offseason. Any member may read it. Read-only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { readOffseasonCalendar } from '@/lib/dynasty-core/offseasonCalendarService'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> | { leagueId: string } }

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const r = await readOffseasonCalendar(leagueId, userId)
  if (!r.ok) return NextResponse.json({ error: r.status === 404 ? 'League not found' : 'Forbidden' }, { status: r.status })
  return NextResponse.json({ calendar: r.view }, { headers: { 'Cache-Control': 'private, no-store' } })
}
