/**
 * E2E-only live tick (G11 Phase 4 browser proof).
 *
 * Drives ONE live-scoring tick for a seeded league via a fixture provider that bumps
 * the rostered DEF's sacks (+1 each call → +5 pts), then broadcasts the affected SSE
 * events through the real `leagueRealtimeStore`. Used by the browser spec to prove the
 * live loop updates the matchup UI without a reload. Reuses the exact Phase 3 runner —
 * no scoring logic here.
 *
 * Hard-gated: `(NODE_ENV !== 'production' || ALLOW_E2E_SEED === '1') && x-allfantasy-e2e:1`
 * (same model as the seed/register routes). Real production never sets ALLOW_E2E_SEED.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { runLiveScoringTickForSeason } from '@/server/services/liveScoring/liveScoreRunner'
import { FixtureLiveStatsProvider } from '@/lib/live-scoring/provider'

export const dynamic = 'force-dynamic'

function e2eAllowed(request: Request): boolean {
  const envAllows = process.env.NODE_ENV !== 'production' || process.env.ALLOW_E2E_SEED === '1'
  return envAllows && request.headers.get('x-allfantasy-e2e') === '1'
}

function asNumberStats(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const n = Number(v)
    if (Number.isFinite(n)) out[k] = n
  }
  return out
}

export async function POST(request: Request) {
  if (!e2eAllowed(request)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as { leagueId?: string }
  const leagueId = body.leagueId?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const season = await prisma.redraftSeason.findFirst({
    where: { leagueId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, leagueId: true, sport: true, season: true, currentWeek: true },
  })
  if (!season) return NextResponse.json({ error: 'No redraft season for league' }, { status: 404 })

  const week = Math.max(1, season.currentWeek || 1)
  const def = await prisma.redraftRosterPlayer.findFirst({
    where: { playerId: { startsWith: 'nfl:def:' }, droppedAt: null, roster: { seasonId: season.id } },
    select: { playerId: true, team: true },
  })
  if (!def) return NextResponse.json({ error: 'No rostered DEF to tick' }, { status: 404 })

  const team = (def.team ?? def.playerId.replace(/^nfl:def:/i, '')).toUpperCase()
  const prev = await prisma.playerWeeklyScore.findUnique({
    where: { playerId_week_season_sport: { playerId: def.playerId, week, season: season.season, sport: season.sport } },
    select: { stats: true },
  })
  const prevSack = asNumberStats(prev?.stats).def_sack ?? 0

  // Fixture: the DEF's team is in a live game; bump sacks so the diff always fires.
  const provider = new FixtureLiveStatsProvider({
    games: [{ gameId: 'e2e-live', homeTeam: team, awayTeam: 'OPP', status: 'in_progress', startTime: new Date() }],
    teamDefenseStats: new Map([[def.playerId, { def_sack: prevSack + 1, def_int: 1, def_points_allowed: 10 }]]),
  })

  // Default broadcast publishes to the real SSE store → the open browser refetches.
  const res = await runLiveScoringTickForSeason(prisma, season, { provider })

  return NextResponse.json({
    ok: true,
    changedPlayerIds: res.changedPlayerIds,
    affectedMatchups: res.plan.affectedMatchupIds.length,
    broadcastEvents: res.events.length,
    polled: res.polled,
    defSackNow: prevSack + 1,
  })
}
