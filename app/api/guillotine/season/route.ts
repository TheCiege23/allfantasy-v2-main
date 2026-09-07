import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { requireCommissionerRole } from '@/lib/league/permissions'
import { ensureGuillotineSeason } from '@/lib/guillotine/ensureGuillotineSeason'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const seasonId = req.nextUrl.searchParams?.get('seasonId')?.trim()
  if (!seasonId) return NextResponse.json({ error: 'seasonId required' }, { status: 400 })

  const g = await prisma.guillotineSeason.findFirst({
    where: { id: seasonId },
    include: {
      eliminations: { orderBy: { scoringPeriod: 'desc' } },
      survivalLog: { take: 50, orderBy: { scoringPeriod: 'desc' } },
    },
  })
  if (!g) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const gate = await assertLeagueMember(g.leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  return NextResponse.json({ season: g })
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { leagueId?: string; redraftSeasonId?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const leagueId = body.leagueId?.trim()
  const redraftSeasonId = body.redraftSeasonId?.trim()
  if (!leagueId || !redraftSeasonId) {
    return NextResponse.json({ error: 'leagueId and redraftSeasonId required' }, { status: 400 })
  }

  try {
    await requireCommissionerRole(leagueId, userId)
  } catch (err) {
    if (err instanceof Response) return err
    throw err
  }

  /*
   * Delegates to `ensureGuillotineSeason`, which the post-draft finalization now
   * also calls. This route was the ONLY thing that ever created a
   * `GuillotineSeason` — production holds zero of them against 12 guillotine
   * leagues — so the season shell existed only if a commissioner knew to ask for
   * it by hand. Now that a second caller exists, the creation rule lives in one
   * place rather than being copied into it.
   *
   * ⚠ `body.sport` / `body.season` OVERRIDES ARE DROPPED, AND THAT IS A FIX.
   * They defaulted to the RedraftSeason's own values and nothing in the app
   * sends them; accepting them let a caller build a guillotine season whose
   * sport or year disagreed with the RedraftSeason it is keyed to, which every
   * downstream engine then reads as authoritative.
   */
  const result = await ensureGuillotineSeason({ leagueId, redraftSeasonId })

  if (!result.ok) {
    if (result.reason === 'REDRAFT_SEASON_NOT_FOUND') {
      return NextResponse.json({ error: 'RedraftSeason not found' }, { status: 404 })
    }
    if (result.reason === 'NOT_GUILLOTINE') {
      return NextResponse.json({ error: 'Not a guillotine league' }, { status: 400 })
    }
    return NextResponse.json(
      { error: 'League has no drafted rosters yet — finish the draft first' },
      { status: 409 },
    )
  }

  const season = await prisma.guillotineSeason.findUnique({ where: { id: result.seasonId } })
  return NextResponse.json({ season })
}

