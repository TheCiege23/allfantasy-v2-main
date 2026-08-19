import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import {
  assembleCrossLeaguePlayerPortfolio,
  type CrossLeaguePlayerPortfolioItem,
} from '@/lib/shared-services/league-hub/crossLeaguePlayerPortfolio'
import { computePlayerUrgency, urgencyRank, type PlayerUrgencySummary } from '@/lib/shared-services/league-hub/playerUrgency'
import type { LeagueHubProvider } from '@/lib/shared-services/league-hub/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Player Command Center (Slice 3) — the first live consumer of the canonical
// cross-league player portfolio. Search a player once; see every league where
// they matter, what changed, how much time is left, and which leagues need
// action. Everything is derived server-side from the authenticated session —
// no client-supplied user/roster/league ownership is trusted (the portfolio
// service enforces the same boundary internally).

interface CommandCenterItem extends CrossLeaguePlayerPortfolioItem {
  urgency: PlayerUrgencySummary
}

export async function GET(req: NextRequest) {
  try {
    const session = (await getServerSession(authOptions as never)) as {
      user?: { id?: string }
    } | null
    const userId = session?.user?.id
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const ip = getClientIp(req) || 'unknown'
    const rl = rateLimit(`player-command-center:${ip}`, 30, 60_000)
    if (!rl.success) {
      return NextResponse.json({ error: 'Too many requests. Try again shortly.' }, { status: 429 })
    }

    const params = req.nextUrl.searchParams
    const q = (params.get('q') ?? '').trim().toLowerCase()
    const sport = params.get('sport')?.trim().toUpperCase() || undefined
    const provider = (params.get('provider')?.trim().toLowerCase() || undefined) as LeagueHubProvider | undefined
    const playerId = params.get('playerId')?.trim() || undefined
    const urgentOnly = params.get('urgentOnly') === 'true'
    const now = new Date()

    const portfolio = await assembleCrossLeaguePlayerPortfolio({
      appUserId: userId,
      sport,
      provider,
      requestTime: now,
    })

    let items: CommandCenterItem[] = portfolio.items.map((item) => ({
      ...item,
      urgency: computePlayerUrgency(item, now),
    }))

    if (playerId) {
      items = items.filter((i) => i.canonicalPlayerId === playerId)
    } else if (q) {
      items = items.filter((i) => i.displayName.toLowerCase().includes(q))
    }
    if (urgentOnly) {
      items = items.filter((i) => i.urgency.urgentLeagueCount > 0)
    }

    // Most urgent first; ties broken by exposure (players you own everywhere
    // matter more), then name for stability.
    items.sort((a, b) => {
      const byUrgency = urgencyRank(b.urgency.overall) - urgencyRank(a.urgency.overall)
      if (byUrgency !== 0) return byUrgency
      const byExposure = b.exposure.leagueCount - a.exposure.leagueCount
      if (byExposure !== 0) return byExposure
      return a.displayName.localeCompare(b.displayName)
    })

    return NextResponse.json({
      ok: true,
      generatedAt: now.toISOString(),
      connectedLeagueCount: portfolio.connectedLeagueCount,
      unsupportedSports: portfolio.unsupportedSports,
      waiverWorldByLeague: portfolio.waiverWorldByLeague,
      // Slice 18 — injury source health: ambiguous name collisions the injury
      // read port refused to bind, plus feed-level staleness. Reported, never
      // swallowed — a missing badge is a gap; the wrong player's badge is a
      // falsehood.
      injuryPort: portfolio.injuryPort,
      totalPlayers: items.length,
      urgentPlayerCount: items.filter((i) => i.urgency.urgentLeagueCount > 0).length,
      items,
    })
  } catch (error: unknown) {
    console.error('[player-command-center] error:', error)
    const message = error instanceof Error ? error.message : 'Failed to load player command center.'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
