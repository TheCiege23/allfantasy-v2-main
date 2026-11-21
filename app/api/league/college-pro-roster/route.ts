import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { Prisma } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertCommissionerAccess } from '@/lib/league/commissionerAccess'
import { loadCollegeProRoster } from '@/lib/league/collegePro/loadCollegeProRoster'
import { COLLEGE_PRO_SCORING_KEY, collegeProFormatOf } from '@/lib/league/collegePro/format'
import { COLLEGE_PRO_TEAM_MAP_KEY } from '@/lib/league/collegePro/headToHead'
import { readTeamMap } from '@/lib/league/collegePro/teamMatch'

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
 * The commissioner's scoring choices, saved on the PRO league:
 *   `{ leagueId, scoring: 'separate' | 'combined' }`: separate matchups or one combined total.
 *   `{ leagueId, teamMap: { [sleeperRosterId]: fantraxTeamId } }`: which college team is whose, for
 *   combined head to head. Replaces the saved map; one Fantrax team per Sleeper team.
 * The head commissioner, or a co-commissioner granted the scoring scope: the one commissioner rule
 * (lib/league/commissionerAccess.ts).
 */
export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { leagueId?: unknown; scoring?: unknown; teamMap?: unknown } | null
  const leagueId = typeof body?.leagueId === 'string' ? body.leagueId.trim() : ''
  const scoring = body?.scoring
  const teamMapInput = body?.teamMap
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  const savingMap = teamMapInput !== undefined
  if (savingMap) {
    if (!teamMapInput || typeof teamMapInput !== 'object' || Array.isArray(teamMapInput)) {
      return NextResponse.json({ error: 'teamMap must be an object of Sleeper roster id to Fantrax team id' }, { status: 400 })
    }
    const values = Object.values(teamMapInput as Record<string, unknown>).filter((v) => typeof v === 'string' && v.trim())
    if (new Set(values).size !== values.length) {
      return NextResponse.json({ error: 'Each Fantrax team can belong to only one Sleeper team' }, { status: 400 })
    }
  } else if (scoring !== 'separate' && scoring !== 'combined') {
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
  const patch = savingMap ? { [COLLEGE_PRO_TEAM_MAP_KEY]: readTeamMap(teamMapInput) } : { [COLLEGE_PRO_SCORING_KEY]: scoring }
  await prisma.league.update({
    where: { id: leagueId },
    data: { settings: { ...current, ...patch } as Prisma.InputJsonValue },
  })
  return NextResponse.json({ ok: true, ...patch })
}
