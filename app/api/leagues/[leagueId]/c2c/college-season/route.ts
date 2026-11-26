/**
 * GET: the college side of a "separate" NFL C2C league (lib/c2c/campusSeason): college standings, a week
 * of college matchups (`?week=`), the college champion and the overall title. League members only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league/league-access'
import { loadCampusSeasonView } from '@/lib/c2c/campusSeason/campusSeasonView'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const weekParam = Number(req.nextUrl.searchParams?.get('week'))
  try {
    const view = await loadCampusSeasonView(leagueId, { week: Number.isInteger(weekParam) && weekParam > 0 ? weekParam : null })
    return NextResponse.json({ collegeSeason: view })
  } catch (e) {
    // Before the college season tables exist (migration 20261124230000_c2c_campus_season), say so plainly.
    if ((e as { code?: string })?.code === 'P2021') return NextResponse.json({ collegeSeason: null, unavailable: true })
    throw e
  }
}
