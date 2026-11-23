/**
 * The AllFantasy projection engine's own numbers, for `/projections`.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────
 * `/projections` read `/api/player-valuations`, which does not touch `AFProjectionSnapshot` at
 * all — so the engine's 19,556 rows reached no user-facing surface, and the page hardcoded
 * `ceiling`, `floor` and `restOfSeasonPoints` to null. This is Phase 6.1: show the basis, the
 * confidence and the reason, from the table the engine actually writes.
 *
 * ── 🛑 SESSION-GATED, MATCHING THE PAGE ────────────────────────────────────────────────────
 * `app/projections/page.tsx` redirects to /login without a session. An open API behind a gated
 * page is not a smaller hole for being inconsistent — it is the same data with the gate removed.
 *
 * The standard board is available to signed-in users. League-scored metrics
 * require access to the requested league.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { listAfProjections } from '@/lib/af-projections/readAfProjections'
import { loadLeaguePlayerMetrics } from '@/lib/af-projections/leaguePlayerMetrics'
import { authorizeLeagueRead } from '@/lib/decision-os/leagueReadAuthorization'
import { isSupportedSport } from '@/lib/sport-scope'
import { gateAfIntelligence, readAfIntelligenceAccess } from '@/lib/core-app/afIntelligenceGate'

export const dynamic = 'force-dynamic'

function intParam(v: string | null): number | null {
  if (v == null || v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.floor(n) : null
}

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ip = getClientIp(req as never) || 'unknown'
  const rl = rateLimit(`projections-af:${session.user.id}:${ip}`, 60, 60_000)
  if (!rl.success) return NextResponse.json({ error: 'Rate limited' }, { status: 429 })

  const sp = req.nextUrl.searchParams
  const sportParam = (sp.get('sport') ?? 'NFL').trim().toUpperCase()
  const sport = sportParam === 'NCAABB' ? 'NCAAB' : sportParam
  if (!isSupportedSport(sport)) {
    /*
     * ⚠ A 400 RATHER THAN AN EMPTY LIST. "We hold no rows for MADEUPBALL" and "this sport does not
     * exist" are different answers, and an empty list for a typo reads as "nobody is projected".
     */
    return NextResponse.json({ error: `Unknown sport: ${sport}` }, { status: 400 })
  }

  try {
    // AF Intelligence (AF Pro, AF Commissioner, AF Supreme — owner, 2026-11-22). Without it the board keeps
    // the provider's baseline and loses AF's own number, its reason and its rest-of-season line.
    const afAccess = await readAfIntelligenceAccess(session.user.id)
    const leagueId = sp.get('leagueId')?.trim()
    if (leagueId) {
      const access = await authorizeLeagueRead(leagueId, session.user.id)
      if (!access.authorized) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
      const playerPool = sport === 'NBA' && sp.get('view') === 'weekly-player-pool'
      const result = await loadLeaguePlayerMetrics({
        afIntelligence: afAccess.unlocked,
        leagueId,
        week: intParam(sp.get('week')),
        position: sp.get('position'),
        playerName: sp.get('player'),
        limit: intParam(sp.get('limit')) ?? (playerPool ? undefined : 100),
        ...(playerPool ? { includePlayerPool: true, includeTradeValues: false } : {}),
      })
      if (!result) return NextResponse.json({ error: 'League metrics unavailable' }, { status: 404 })
      if (sp.has('sport') && result.sport !== sport) {
        return NextResponse.json({ error: 'Sport does not match the league' }, { status: 400 })
      }
      if (sp.has('season') && intParam(sp.get('season')) !== result.season) {
        return NextResponse.json({ error: 'Season does not match the league' }, { status: 400 })
      }
      return NextResponse.json(gateAfIntelligence(result, afAccess))
    }
    const { rows, season } = await listAfProjections({
      sport,
      season: intParam(sp.get('season')),
      position: sp.get('position'),
      week: intParam(sp.get('week')),
      limit: intParam(sp.get('limit')) ?? 100,
    })

    return NextResponse.json({
      sport,
      season,
      /*
       * ⚠ THE CALLER MUST BE ABLE TO SAY WHY IT IS EMPTY. `season: null` means we hold no rows for
       * this sport at all — a stalled or never-run compute — which is a different message from
       * "this position has nobody". The projections cron silently wrote nothing for 13 days while
       * reporting success, so this distinction is not hypothetical.
       */
      ...(afAccess.unlocked ? {} : { afIntelligenceLock: afAccess }),
      rows: rows.map((r) => afAccess.unlocked ? ({
        playerId: r.playerId,
        playerName: r.playerName,
        position: r.position,
        week: r.week,
        // PER GAME. Named so a consumer cannot mistake it for a season total.
        perGame: r.afProjection,
        baseline: r.baselineProjection,
        weatherAdjustment: r.weatherAdjustment,
        // REST OF SEASON, or null. Never coerce to 0 — see the reader.
        restOfSeason: r.rosProjection,
        restOfSeasonWeeks: r.rosWeeksRemaining,
        confidence: r.confidenceLevel,
        reason: r.adjustmentReason,
        isOutdoorGame: r.isOutdoorGame,
        computedAt: r.computedAt.toISOString(),
      }) : ({
        playerId: r.playerId,
        playerName: r.playerName,
        position: r.position,
        week: r.week,
        perGame: null,
        baseline: r.baselineProjection,
        weatherAdjustment: null,
        restOfSeason: null,
        restOfSeasonWeeks: null,
        confidence: null,
        reason: null,
        isOutdoorGame: r.isOutdoorGame,
        computedAt: r.computedAt.toISOString(),
      })),
    })
  } catch {
    return NextResponse.json({ error: 'Could not read projections' }, { status: 500 })
  }
}
