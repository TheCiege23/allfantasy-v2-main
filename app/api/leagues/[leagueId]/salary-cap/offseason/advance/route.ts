/**
 * POST: Advance to new season — decrement contract years (commissioner). PROMPT 339.
 */

import { assertCommissionerAccess } from '@/lib/league/commissionerAccess'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isSalaryCapLeague } from '@/lib/salary-cap/SalaryCapLeagueConfig'
import { advanceToNewSeason } from '@/lib/salary-cap/SalaryCapOffseasonCalendar'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  try {
    await assertCommissionerAccess(leagueId, userId, 'league')
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const isCap = await isSalaryCapLeague(leagueId)
  if (!isCap) return NextResponse.json({ error: 'Not a salary cap league' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const newCapYear = Number(body.newCapYear ?? new Date().getFullYear())
  if (!Number.isInteger(newCapYear) || newCapYear < 2020) {
    return NextResponse.json({ error: 'Invalid newCapYear' }, { status: 400 })
  }

  const result = await advanceToNewSeason(leagueId, newCapYear)
  return NextResponse.json({ ok: true, updated: result.updated })
}
