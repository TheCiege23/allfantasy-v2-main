import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { Prisma } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertCommissionerAccess } from '@/lib/league/commissionerAccess'
import { loadCollegeProRoster } from '@/lib/league/collegePro/loadCollegeProRoster'
import { COLLEGE_PRO_SCORING_KEY, collegeProFormatOf } from '@/lib/league/collegePro/format'

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

/**
 * The commissioner's choice: college and pro scored as separate matchups, or as one combined total.
 * Body `{ leagueId, scoring: 'separate' | 'combined' }`. The head commissioner, or a co-commissioner
 * granted the scoring scope: the one commissioner rule (lib/league/commissionerAccess.ts).
 */
export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { leagueId?: unknown; scoring?: unknown } | null
  const leagueId = typeof body?.leagueId === 'string' ? body.leagueId.trim() : ''
  const scoring = body?.scoring
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  if (scoring !== 'separate' && scoring !== 'combined') {
    return NextResponse.json({ error: "scoring must be 'separate' or 'combined'" }, { status: 400 })
  }

  let league: Awaited<ReturnType<typeof assertCommissionerAccess>>['league']
  try {
    ;({ league } = await assertCommissionerAccess(leagueId, userId, 'scoring'))
  } catch (err) {
    const status = (err as { status?: number }).status === 404 ? 404 : 403
    return NextResponse.json({ error: status === 404 ? 'League not found' : 'Only the commissioner can change scoring' }, { status })
  }
  if (!collegeProFormatOf(league)) {
    return NextResponse.json({ error: 'This is not a C2C or Devy league' }, { status: 400 })
  }

  // Merge, never replace: League.settings carries the platform's settings and other AllFantasy keys.
  const current =
    league.settings && typeof league.settings === 'object' && !Array.isArray(league.settings)
      ? (league.settings as Record<string, unknown>)
      : {}
  await prisma.league.update({
    where: { id: leagueId },
    data: { settings: { ...current, [COLLEGE_PRO_SCORING_KEY]: scoring } as Prisma.InputJsonValue },
  })
  return NextResponse.json({ ok: true, scoring })
}
