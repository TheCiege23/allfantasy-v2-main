import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueAccess } from '@/lib/league-access'
import { readSurvivorEpisode } from '@/lib/survivor/survivorEpisode'

export const dynamic = 'force-dynamic'

/**
 * The season's episodes: one per week the recap posted, newest first. League members only. Each is
 * the same spoiler-safe text the league chat already received, stored on the recap's audit entry.
 */
export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  // One 403 for not-found and not-member, so league existence is not leaked.
  if (!(await resolveLeagueAccess(leagueId, userId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const rows = await prisma.survivorAuditEntry.findMany({
    where: { leagueId, action: 'weekly_recap_posted', isVisibleToPublic: true },
    orderBy: { week: 'desc' },
    select: { week: true, data: true },
    take: 60,
  })
  const episodes = rows.flatMap(row => {
    const episode = readSurvivorEpisode((row.data as Record<string, unknown> | null)?.episode)
    return episode ? [episode] : []
  })
  return NextResponse.json({ episodes }, { headers: { 'Cache-Control': 'no-store' } })
}
