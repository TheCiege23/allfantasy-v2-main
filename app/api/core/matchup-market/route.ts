import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'

import { authOptions } from '@/lib/auth'
import { buildRateLimit429, consumeRateLimit, getClientIp } from '@/lib/rate-limit'
import { readWeekMarketContextByTeam } from '@/lib/odds/gameOddsReads'
import { pickMarketForTeams } from '@/lib/core-app/matchupMarket'

/**
 * The /core Matchup screen's "scoring environment" panel: the stored market read for the clubs
 * your starters play for, this week.
 *
 * 🛑 DB-FIRST. `readWeekMarketContextByTeam` reads `game_odds` + `SportsGame` and calls no provider
 * on any path; the writer is the `/api/cron/import-schedules?odds=1` sync. A miss is a null per club,
 * which the panel states as "no market read yet" — this route never reaches for the vendor while
 * someone waits.
 *
 * Its own route because the screen is a server render that has finished by the time the panel
 * mounts, and the matchup loader is not this panel's to widen. NFL only: no other sport has a feed.
 * Forecast fields only — no prices, no sportsbook, and no NFL win probability (see matchupMarket.ts).
 */
export const dynamic = 'force-dynamic'

const headers = { 'Cache-Control': 'private, no-store' }

const querySchema = z.object({
  season: z.coerce.number().int().min(2000).max(2100),
  week: z.coerce.number().int().min(1).max(25),
  // A club code, or the full name the games writer stores when its abbreviation table misses.
  team: z.array(z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9 .'&-]+$/)).min(1).max(30),
})

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })

  const rl = consumeRateLimit({
    scope: 'core',
    action: 'matchup_market',
    // The bucket is per signed-in account (the field's name is historical).
    sleeperUsername: session.user.id,
    ip: getClientIp(req),
    includeIpInKey: true,
    // One request per matchup page view; a manager flicking through leagues makes a few a minute.
    maxRequests: 60,
    windowMs: 60_000,
  })
  if (!rl.success) {
    return NextResponse.json(buildRateLimit429({ message: 'Too many requests. Please slow down.', rl }), {
      status: 429,
      headers: { ...headers, 'Retry-After': String(rl.retryAfterSec) },
    })
  }

  const { searchParams } = new URL(req.url)
  const parsed = querySchema.safeParse({
    season: searchParams.get('season'),
    week: searchParams.get('week'),
    team: [...new Set(searchParams.getAll('team'))],
  })
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers })

  try {
    const byTeam = await readWeekMarketContextByTeam('NFL', parsed.data.season, parsed.data.week)
    return NextResponse.json(pickMarketForTeams(byTeam, parsed.data.team), { headers })
  } catch {
    return NextResponse.json({ error: 'Market read temporarily unavailable' }, { status: 503, headers })
  }
}
