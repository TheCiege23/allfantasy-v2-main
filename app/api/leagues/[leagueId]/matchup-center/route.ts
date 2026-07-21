import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildMatchupCenterPayload } from '@/server/services/matchupCenterService'
import { assertValidMatchupPayload } from '@/lib/matchup-center/validateMatchupPayload'
import { dedupeLeagueRequest } from '@/lib/league-engine-performance/leagueRequestDedupe'
import { withLeagueEngineTimedOperation } from '@/lib/league-engine-performance/jobRunner'
import { DEFAULT_SLOW_ROUTE_MS } from '@/lib/league-engine-performance/observability'
import { isSportsDataEnabled } from '@/lib/fantasy-os/sports-runtime/gates'
import { CertifiedMatchupIntegrationService, type CertifiedMatchupContext } from '@/lib/fantasy-os/sports-runtime/matchupIntegration'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = session.user!.id
  const { leagueId } = await params
  const sp = req.nextUrl.searchParams
  const season = sp.get('season') ? Number(sp.get('season')) : undefined
  const week = sp.get('week') ? Number(sp.get('week')) : undefined
  const seasonKey = Number.isFinite(season!) ? String(season) : 'current'
  const weekKey = Number.isFinite(week!) ? String(week) : 'current'

  const out = await dedupeLeagueRequest(
    {
      leagueId,
      surface: 'matchup_center',
      fragments: [userId, seasonKey, weekKey],
    },
    () =>
      withLeagueEngineTimedOperation(
        {
          subsystem: 'matchup',
          action: 'matchup_center_get',
          leagueId,
          slowThresholdMs: DEFAULT_SLOW_ROUTE_MS,
        },
        () =>
          buildMatchupCenterPayload({
            leagueId,
            viewerUserId: userId,
            season: Number.isFinite(season!) ? season : undefined,
            week: Number.isFinite(week!) ? week : undefined,
          }),
      ),
  )

  if ('error' in out) {
    // Do not leak the engine's internal string ("Forbidden", "Roster not found") to the client.
    // Map to a stable, user-facing message keyed on status; the engine detail stays server-side.
    const clientError =
      out.status === 403
        ? 'You do not have access to this league.'
        : out.status === 404
          ? 'League not found.'
          : 'Unable to load the matchup center.'
    if (out.status >= 500) console.warn('[matchup-center] engine error', out)
    return NextResponse.json({ error: clientError }, { status: out.status })
  }

  const v = assertValidMatchupPayload(out)
  if (!v.ok) {
    console.warn('[matchup-center] payload validation', v.errors)
  }

  // Gated, informational certified GAME context. Read-only: it never mutates the payload, scores, ownership,
  // winner, or standings. NFL only; wrapped so it can never fail the read. No new persistence occurs.
  let sportsContext: CertifiedMatchupContext | undefined
  if (isSportsDataEnabled('matchup')) {
    try {
      const resolvedWeek = Number.isFinite(week!) ? week! : (out as { week?: number }).week
      const resolvedSeason = Number.isFinite(season!) ? season! : (out as { season?: number }).season
      const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true } })
      if (league && String(league.sport ?? 'NFL').toUpperCase() === 'NFL' && resolvedWeek != null) {
        sportsContext = await new CertifiedMatchupIntegrationService().describeMatchupGameStates({
          season: String(resolvedSeason ?? new Date().getFullYear()),
          week: String(resolvedWeek),
        })
      }
    } catch {
      sportsContext = undefined
    }
  }

  return NextResponse.json({ payload: out, validation: v, ...(sportsContext ? { sportsContext } : {}) })
}
