/**
 * GET: Leagues with orphan teams seeking managers (main-app League, orphanSeeking in settings).
 * Returns public-safe cards with join URL for /join?code=.
 * Supports ?page=1&limit=12 for offset pagination.
 */

import { getServedOrigin } from '@/lib/http/served-origin'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isSupportedSport } from '@/lib/sport-scope'
import { parseOffsetPageParams, cacheControlHeaders } from '@/lib/api-performance'

export const dynamic = 'force-dynamic'

function getBaseUrl(req: NextRequest): string {
  // Config-derived, never the Host / X-Forwarded-Host header, which the caller
  // controls — see lib/http/served-origin.ts.
  return getServedOrigin(req)
}

export interface OrphanLeagueCard {
  id: string
  name: string
  sport: string
  leagueSize: number
  isDynasty: boolean
  joinUrl: string
  fillPct: number
  memberCount: number
}

export async function GET(req: NextRequest) {
  try {
    const baseUrl = getBaseUrl(req)
    const sport = req.nextUrl.searchParams?.get('sport')?.trim() || null
    const { page, limit, skip } = parseOffsetPageParams(req, 24)

    const raw = await (prisma as any).league.findMany({
      where: sport && isSupportedSport(sport) ? { sport: sport.toUpperCase() } : undefined,
      select: {
        id: true,
        name: true,
        sport: true,
        leagueSize: true,
        isDynasty: true,
        settings: true,
        _count: { select: { rosters: true } },
      },
      orderBy: { lastSyncedAt: 'desc' },
      take: 100,
    })
    const leagues = raw.filter(
      (lg: any) => lg.settings && typeof lg.settings === 'object' && (lg.settings as Record<string, unknown>).orphanSeeking === true
    )

    const cards: OrphanLeagueCard[] = []
    for (const lg of leagues) {
      const settings = (lg.settings as Record<string, unknown>) || {}
      const inviteCode = (settings.inviteCode as string) ?? null
      if (!inviteCode) continue
      const memberCount = lg._count?.rosters ?? 0
      const maxMembers = Number(lg.leagueSize) || 12
      const fillPct = maxMembers > 0 ? Math.round((memberCount / maxMembers) * 100) : 0
      cards.push({
        id: lg.id,
        name: lg.name ?? 'Unnamed League',
        sport: String(lg.sport ?? 'NFL'),
        leagueSize: maxMembers,
        isDynasty: !!lg.isDynasty,
        joinUrl: `${baseUrl.replace(/\/$/, '')}/join?code=${encodeURIComponent(inviteCode)}`,
        fillPct,
        memberCount,
      })
    }

    const total = cards.length
    const paginated = cards.slice(skip, skip + limit)

    return NextResponse.json(
      {
        ok: true,
        leagues: paginated,
        pagination: { page, limit, total, hasMore: skip + paginated.length < total },
      },
      { headers: cacheControlHeaders('medium') }
    )
  } catch (err: unknown) {
    console.error('[discover/orphans]', err)
    return NextResponse.json({ error: 'Failed to load orphan leagues' }, { status: 500 })
  }
}

