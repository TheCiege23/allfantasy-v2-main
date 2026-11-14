/**
 * [UPDATED] app/api/tournament/[tournamentId]/standings/route.ts
 * GET: Universal standings for a tournament.
 * Supports Legacy tournaments via TournamentStandingsService.
 * ?bubble=true returns only bubble-zone rows.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUniversalStandings } from '@/lib/tournament-mode/TournamentStandingsService'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tournamentId: string }> }
) {
  const { tournamentId } = await params
  if (!tournamentId) return NextResponse.json({ error: 'tournamentId required' }, { status: 400 })

  const bubbleOnly = req.nextUrl.searchParams?.get('bubble') === 'true'

  // Try Shell model first
  const shell = await prisma.tournamentShell.findUnique({ where: { id: tournamentId } }).catch(() => null)
  if (shell) {
    // Shell standings are stored in conference standingsCache
    const conferences = await prisma.tournamentConference.findMany({
      where: { tournamentId },
      select: { id: true, name: true, standingsCache: true },
    })
    return NextResponse.json({
      standings: conferences.flatMap((c) => {
        const cache = c.standingsCache as Array<Record<string, unknown>> | null
        return (cache ?? []).map((row) => ({ ...row, conferenceName: c.name }))
      }),
    })
  }

  // Legacy tournament: use the real standings service
  const legacy = await prisma.legacyTournament.findUnique({
    where: { id: tournamentId },
    select: { id: true, creatorId: true },
  })
  if (!legacy) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    let rows = await getUniversalStandings(tournamentId)

    // Enrich with user display names
    const userIds = [...new Set(rows.map((r) => r.userId).filter(Boolean))] as string[]
    if (userIds.length > 0) {
      const profiles = await prisma.userProfile.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, displayName: true },
      })
      const nameMap = new Map(profiles.map((p) => [p.userId, p.displayName]))
      rows = rows.map((r) => ({
        ...r,
        teamName: r.teamName ?? (r.userId ? nameMap.get(r.userId) ?? null : null),
      }))
    }

    if (bubbleOnly) {
      rows = rows.filter((r) => r.advancementStatus === 'bubble' || r.onBubble)
    }

    return NextResponse.json({ standings: rows, rows })
  } catch (e) {
    console.error('[tournament/standings]', e)
    return NextResponse.json({ error: 'Failed to compute standings' }, { status: 500 })
  }
}
