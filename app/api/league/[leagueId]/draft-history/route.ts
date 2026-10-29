import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueAccess } from '@/lib/league-access'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { loadNativeSeasonHistory } from '@/lib/redraft/offseason/nativeSeasonHistory'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ leagueId: string }> },
) {
  try {
    const session = (await getServerSession(authOptions as never)) as {
      user?: { id?: string }
    } | null
    const userId = session?.user?.id?.trim()
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { leagueId } = await params
    const id = leagueId?.trim()
    if (!id) {
      return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
    }

    const url = new URL(req.url)
    const seasonParam = url.searchParams.get('season')
    const season = seasonParam ? Number.parseInt(seasonParam, 10) : null

    const access = await resolveLeagueAccess(id, userId)
    if (!access?.isMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const league = await prisma.league.findUnique({ where: { id }, select: { platform: true } })
    if (league && isNativePlatform(league.platform)) {
      const years = await prisma.leagueSeason.findMany({ where: { leagueId: id, ...(season ? { season } : {}) }, select: { season: true }, orderBy: { season: 'desc' } })
      const seasons = await Promise.all(years.map(async ({ season: year }) => ({ year, picks: (await loadNativeSeasonHistory(id, year))?.draft ?? [] })))
      return NextResponse.json({ seasons })
    }
    const where: { leagueId: string; season?: number } = { leagueId: id }
    if (season && Number.isFinite(season)) where.season = season

    const picks = await prisma.draftFact.findMany({
      where,
      orderBy: [{ season: 'desc' }, { round: 'asc' }, { pickNumber: 'asc' }],
      select: {
        draftId: true,
        season: true,
        round: true,
        pickNumber: true,
        playerId: true,
        managerId: true,
      },
    })

    const grouped = new Map<number, typeof picks>()
    for (const p of picks) {
      const y = p.season ?? 0
      const arr = grouped.get(y) ?? []
      arr.push(p)
      grouped.set(y, arr)
    }

    const seasons = Array.from(grouped.entries())
      .map(([year, ps]) => ({ year, picks: ps }))
      .sort((a, b) => b.year - a.year)

    return NextResponse.json({ seasons })
  } catch (e) {
    console.error('[api/league/[leagueId]/draft-history GET]', e)
    return NextResponse.json({ error: 'Failed to load draft history' }, { status: 500 })
  }
}
