/**
 * GET /api/leagues/[leagueId]/history
 * Returns merged league history: imported Sleeper seasons + AF-native seasons.
 * Read-only, accessible to all league members. No commissioner restriction.
 * Unified list — no differentiation between imported and AF-native records.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueAccess } from '@/lib/league-access'

export const dynamic = 'force-dynamic'

interface HistorySeason {
  season: number
  championName: string | null
  championAvatar: string | null
  runnerUpName: string | null
  regularSeasonWinnerName: string | null
  teamCount: number | null
  scoringFormat: string | null
  isDynasty: boolean
  status: string | null
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params

  // Verify user is a league member (not just commissioner)
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      name: true,
      season: true,
      sport: true,
      platform: true,
      platformLeagueId: true,
      userId: true,
      settings: true,
      teams: { select: { platformUserId: true } },
    },
  })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Canonical membership predicate. This previously read the nullable `LeagueTeam.platformUserId`
  // with a `Roster` fallback bolted on — which covered imported rosters but still 403'd claim-only
  // managers and redraft members.
  const access = await resolveLeagueAccess(leagueId, session.user.id)
  if (!access?.isMember) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Fetch all LeagueSeason rows for this league (covers imported + AF-native)
  const dbSeasons = await prisma.leagueSeason.findMany({
    where: { leagueId },
    orderBy: { season: 'desc' },
    select: {
      season: true,
      championName: true,
      championAvatar: true,
      runnerUpName: true,
      regularSeasonWinnerName: true,
      teamCount: true,
      scoringFormat: true,
      isDynasty: true,
      status: true,
    },
  })

  // Also include the current active season if not already in the DB
  const currentYear = league.season ?? new Date().getFullYear()
  const hasCurrent = dbSeasons.some((s) => s.season === currentYear)
  const seasons: HistorySeason[] = [...dbSeasons]

  if (!hasCurrent) {
    // Add current active season as a "live" entry
    seasons.unshift({
      season: currentYear,
      championName: null,
      championAvatar: null,
      runnerUpName: null,
      regularSeasonWinnerName: null,
      teamCount: league.teams.length,
      scoringFormat: null,
      isDynasty: false,
      status: 'active',
    })
  }

  // Deduplicate by season year (in case of overlap)
  const seen = new Set<number>()
  const unique = seasons.filter((s) => {
    if (seen.has(s.season)) return false
    seen.add(s.season)
    return true
  })

  const settings = (league.settings as Record<string, unknown> | null) ?? {}

  /*
   * The orchestrator's own status row. Read defensively — the table is written
   * only on paths that reach `runDynastyBackfill`, so a league imported before
   * that existed simply has no row, which is not an error.
   */
  const providerStatus = await prisma.dynastyBackfillStatus
    .findFirst({
      where: { leagueId },
      orderBy: { updatedAt: 'desc' },
      select: { status: true, failureMessage: true, lastStartedAt: true, updatedAt: true },
    })
    .catch(() => null)
  return NextResponse.json({
    leagueId,
    leagueName: league.name,
    sport: league.sport,
    seasons: unique,
    /*
     * ⚠ THE ONLY PLACE THE PRODUCT REPORTS THIS, so it has to report enough to
     * act on. `status` alone said `complete` for 52 production leagues that had
     * imported zero prior seasons — it cannot distinguish "no earlier seasons
     * exist" from "three exist and none landed". The counts can, and the
     * provider's own `failureMessage` names the reason.
     *
     * `providerStatus` is `dynasty_backfill_status`, the row the orchestrator
     * actually writes its verdict to. Nothing in `app/` read that table, which is
     * why a silently failing backfill was invisible from inside the product.
     */
    historicalBackfill: {
      status:
        (settings.historicalBackfillStatus as string | undefined) ??
        (unique.length > 1 ? 'complete' : 'unknown'),
      startedAt: (settings.historicalBackfillStartedAt as string | undefined) ?? null,
      completedAt: (settings.historicalBackfillCompletedAt as string | undefined) ?? null,
      error: (settings.historicalBackfillError as string | undefined) ?? null,
      seasonsDiscovered:
        (settings.historicalBackfillSeasonsDiscovered as number | undefined) ?? null,
      seasonsImported:
        (settings.historicalBackfillSeasonsImported as number | undefined) ?? null,
      seasonsSkipped:
        (settings.historicalBackfillSeasonsSkipped as number | undefined) ?? null,
      providerStatus: providerStatus
        ? {
            status: providerStatus.status,
            failureMessage: providerStatus.failureMessage,
            lastStartedAt: providerStatus.lastStartedAt,
            updatedAt: providerStatus.updatedAt,
          }
        : null,
    },
  })
}
