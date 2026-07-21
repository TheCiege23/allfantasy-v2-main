import { NextResponse, type NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { consumeRateLimit } from '@/lib/rate-limit'
import {
  getPlayerIntelligence,
  GENERIC_MARKET_SETTINGS,
} from '@/lib/players/playerIntelligenceService'
import { resolveLeagueMarketSettings } from '@/lib/players/leagueMarketSettings'

export const dynamic = 'force-dynamic'

/**
 * GET /api/players/intelligence
 *
 * Backs the Player Intelligence Center. Returns players enriched with the sources
 * that genuinely exist, each metric carrying its own availability state so the
 * client renders "no source" rather than a plausible-looking zero.
 *
 * Query params:
 *   sport      required — one of the sports that has player rows (NFL, NCAAF,
 *              NCAAB, MLB, NHL, SOCCER, NBA)
 *   q          optional — name search, 2+ chars. Omitted browses the top of the market.
 *   limit      optional — 1..100, default 24
 *   leagueId   optional — values players under that league's real settings instead
 *              of the generic default. Accepts either id space (see
 *              `resolveLeagueMarketSettings`).
 *
 * Auth: required. This reads a user's league configuration when `leagueId` is
 * supplied, so it must not be callable anonymously.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  // Per-user AND per-IP. `includeIpInKey` must be explicit: the helper defaults it
  // to false, in which case an ip-only call collapses every caller on the platform
  // into a single shared bucket while still reading like a per-IP limit.
  const limit = consumeRateLimit({
    scope: 'players',
    action: 'intelligence',
    sleeperUsername: userId,
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    includeIpInKey: true,
    maxRequests: 60,
    windowMs: 60_000,
  })

  if (!limit.success) {
    return NextResponse.json(
      { error: 'Too many requests', retryAfterSec: limit.retryAfterSec },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } },
    )
  }

  const { searchParams } = new URL(req.url)
  const sport = (searchParams.get('sport') ?? 'NFL').toUpperCase()
  const query = searchParams.get('q') ?? undefined
  const leagueId = searchParams.get('leagueId')

  const parsedLimit = Number.parseInt(searchParams.get('limit') ?? '', 10)
  const resultLimit = Number.isFinite(parsedLimit) ? parsedLimit : undefined

  try {
    const leagueContext = leagueId
      ? await resolveLeagueMarketSettings({ leagueId, userId })
      : null

    const result = await getPlayerIntelligence({
      sport,
      query,
      limit: resultLimit,
      leagueSettings: leagueContext?.settings,
    })

    return NextResponse.json({
      players: result.players,
      dataGaps: [...result.dataGaps, ...(leagueContext?.dataGaps ?? [])],
      marketDataAgeMs: result.marketDataAgeMs,
      valuationContext: leagueContext
        ? {
            leagueSpecific: true,
            leagueName: leagueContext.leagueName,
            settings: leagueContext.settings,
            derivedFrom: leagueContext.derivedFrom,
          }
        : {
            leagueSpecific: false,
            leagueName: null,
            settings: GENERIC_MARKET_SETTINGS,
            derivedFrom: 'Generic 12-team, 1-QB, full-PPR redraft settings.',
          },
    })
  } catch (error) {
    console.error('[players/intelligence] failed', error)
    return NextResponse.json(
      { error: 'Player intelligence is temporarily unavailable.' },
      { status: 503 },
    )
  }
}
