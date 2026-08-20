import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { computeCommissionerPulse, type PulseManager } from '@/lib/league-intel/commissionerPulseService'
import { createLeagueChatMessage } from '@/lib/league-chat/LeagueChatMessageService'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * League-health leaderboard (dashboard, commissioner-only):
 *  GET  → every league the viewer OWNS, pulse-scanned via the shared
 *         commissionerPulseService, ranked worst-first.
 *  POST → "send nudge": posts a FRIENDLY system message to that league's chat
 *         naming the team and the counted signals (same announcer identity as
 *         weekly awards). Deduped per roster per 3 days so a nudge can never
 *         become a nag.
 */

const NUDGE_PREFIX = 'nudge-sent:v1:'
const NUDGE_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000

export type LeaderboardRow = {
  leagueId: string
  leagueName: string
  flaggedCount: number
  teamCount: number
  flagged: PulseManager[]
}

export async function GET(_req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagues = await prisma.league.findMany({
    where: { userId, platform: 'sleeper', platformLeagueId: { not: '' } },
    select: { id: true, name: true, platformLeagueId: true },
    take: 10,
  })
  if (leagues.length === 0) return NextResponse.json({ rows: [], method: null })

  const rows: LeaderboardRow[] = []
  let method: string | null = null
  for (const league of leagues) {
    const pulse = await computeCommissionerPulse(league.platformLeagueId as string).catch(() => null)
    if (!pulse) continue
    method = pulse.method
    rows.push({
      leagueId: league.id,
      leagueName: league.name ?? 'League',
      flaggedCount: pulse.flaggedCount,
      teamCount: pulse.managers.length,
      flagged: pulse.managers.filter((m) => m.flagged),
    })
  }
  rows.sort((a, b) => b.flaggedCount - a.flaggedCount)
  return NextResponse.json({ rows, method })
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { leagueId?: string; rosterId?: number }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const leagueId = body.leagueId?.trim()
  const rosterId = typeof body.rosterId === 'number' ? body.rosterId : null
  if (!leagueId || rosterId == null) {
    return NextResponse.json({ error: 'leagueId and rosterId are required' }, { status: 400 })
  }

  // Nudges are a commissioner power: league OWNER only.
  const league = await prisma.league.findFirst({
    where: { id: leagueId, userId, platform: 'sleeper', platformLeagueId: { not: '' } },
    select: { id: true, platformLeagueId: true, userId: true },
  })
  if (!league) {
    return NextResponse.json({ error: 'Only the league owner can send nudges' }, { status: 403 })
  }

  const nudgeKey = `${NUDGE_PREFIX}${league.platformLeagueId}:${rosterId}`
  const existing = await prisma.sportsDataCache.findUnique({ where: { cacheKey: nudgeKey } }).catch(() => null)
  if (existing && existing.expiresAt > new Date()) {
    return NextResponse.json({ posted: false as const, reason: 'nudged within the last 3 days' })
  }

  const pulse = await computeCommissionerPulse(league.platformLeagueId as string)
  const manager = pulse?.managers.find((m) => m.rosterId === rosterId)
  if (!manager || !manager.flagged) {
    return NextResponse.json({ posted: false as const, reason: 'no active flags for that roster' })
  }

  const teamLabel = manager.teamName || manager.name
  const message =
    `👋 Friendly check-in for ${teamLabel}: ` +
    `${manager.signals.join(', ')}. ` +
    `No judgment — just keeping every matchup fair for the whole league. Need a hand? The Roster tab shows the open slots.`

  const created = await createLeagueChatMessage(league.id, league.userId as string, message, {
    type: 'system',
    metadata: { isSystem: true, commissionerNudge: true, rosterId },
  }).catch(() => null)
  if (!created) {
    return NextResponse.json({ posted: false as const, reason: 'chat post failed' }, { status: 502 })
  }
  await prisma.sportsDataCache
    .upsert({
      where: { cacheKey: nudgeKey },
      update: { data: { version: 1 } as unknown as object, expiresAt: new Date(Date.now() + NUDGE_COOLDOWN_MS) },
      create: { cacheKey: nudgeKey, data: { version: 1 } as unknown as object, expiresAt: new Date(Date.now() + NUDGE_COOLDOWN_MS) },
    })
    .catch(() => null)
  return NextResponse.json({ posted: true as const })
}
