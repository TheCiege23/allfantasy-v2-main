import { isImportedPlatform } from '@/lib/league/isNativeLeague'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueAccess } from '@/lib/league-access'
import { CURRENT_TEAMS } from '@/lib/leagues/leagueTeamLifecycle'
import { readImportedPointsAgainst } from '@/lib/league-import/importedPointsAgainst'
import { buildRosterLabelMap } from '@/lib/scoring-engine/resolveTeamLabels'
import {
  computeAllPlay,
  computeStreaks,
  formatAllPlay,
  formatStreak,
} from '@/lib/standings/seasonForm'
import { parseActiveLeagueDivisions, resolveRosterDivisions, type LeagueTeamIdentity } from '@/lib/league/divisions/leagueDivisions'

export async function GET(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = params.leagueId
  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: {
      id: true,
      season: true,
      settings: true,
      platform: true,
      bestBallMode: true,
      bbMatchupFormat: true,
      leagueType: true,
      leagueVariant: true,
    },
  })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const rawMode =
    league.settings && typeof league.settings === 'object' && !Array.isArray(league.settings)
      ? (league.settings as Record<string, unknown>).scoring_mode
      : null
  const scoringMode: 'points' | 'h2h_category' | 'roto' =
    rawMode === 'h2h_category' || rawMode === 'roto' ? rawMode : 'points'

  // Canonical membership predicate. Was gating on the nullable `LeagueTeam.platformUserId`,
  // which 403'd real members of imported leagues (their membership lives in `Roster`).
  const access = await resolveLeagueAccess(leagueId, session.user.id)
  if (!access?.isMember) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sp = req.nextUrl.searchParams
  const season = Math.max(2000, Math.min(2100, Math.trunc(Number(sp.get('season'))) || league.season))

  // Imported records remain platform-owned; never substitute a native round-robin result.
  if (isImportedPlatform(league.platform)) {
    const teams = await prisma.leagueTeam.findMany({ where: { leagueId, ...CURRENT_TEAMS }, orderBy: [{ currentRank: 'asc' }, { teamName: 'asc' }] })
    const pointsAgainst = (team: typeof teams[number]) => readImportedPointsAgainst({
      settings: league.settings, platform: league.platform, season, externalId: team.externalId, persisted: team.pointsAgainst,
    })
    const played = teams.some(t => t.wins + t.losses + t.ties > 0 || t.pointsFor !== 0 || (pointsAgainst(t) ?? 0) !== 0)
    const standings = season === league.season && played ? teams.map(t => ({ rosterId: t.id, teamName: t.teamName?.trim() || t.ownerName?.trim() || 'Unnamed team',
      wins: t.wins, losses: t.losses, ties: t.ties, pointsFor: t.pointsFor, pointsAgainst: pointsAgainst(t), rank: t.currentRank,
      categoryWinsFor: null, categoryLossesFor: null, categoryTiesFor: null, streak: null, allPlay: null })) : []
    const owned = teams.filter(t => t.claimedByUserId === session.user!.id || t.platformUserId === session.user!.id)
    return NextResponse.json({ season, standings, scoringMode, viewerRosterId: owned.length === 1 ? owned[0].id : null,
      playoffCut: null, source: 'imported', sourcePlatform: league.platform, scoredWeeks: null, cumulative: league.bestBallMode && league.bbMatchupFormat === 'cumulative' },
      { headers: { 'Cache-Control': 'private, no-store' } })
  }

  /*
   * Streak and all-play (standings 9a) are DERIVED from the same weekly results the standings
   * themselves are built from — never stored, never estimated. `TeamWeekResult` is the only
   * source; when a league has no processed weeks the helpers return empty maps and the columns
   * render a dash rather than a zero that would read as a real record.
   */
  const [rows, labels, weekResults] = await Promise.all([
    prisma.fantasyStanding.findMany({
      where: { leagueId, season },
      orderBy: [{ rank: 'asc' }],
    }),
    buildRosterLabelMap(leagueId),
    prisma.teamWeekResult.findMany({
      where: { leagueId, season, status: 'final' },
      select: { week: true, rosterId: true, totalPoints: true, winLoss: true },
    }),
  ])

  const streaks = computeStreaks(weekResults)
  const allPlay = computeAllPlay(weekResults)

  const scoredRosterIds = new Set(weekResults.map(r => r.rosterId))
  const standings = rows.filter(r => scoredRosterIds.has(r.rosterId)).map((r) => ({
    rosterId: r.rosterId,
    teamName: labels.get(r.rosterId) ?? r.rosterId,
    wins: r.wins,
    losses: r.losses,
    ties: r.ties,
    pointsFor: r.pointsFor,
    pointsAgainst: r.pointsAgainst,
    rank: r.rank,
    playoffSeed: r.playoffSeed,
    categoryWinsFor: r.categoryWinsFor ?? 0,
    categoryLossesFor: r.categoryLossesFor ?? 0,
    categoryTiesFor: r.categoryTiesFor ?? 0,
    streak: formatStreak(streaks.get(r.rosterId)),
    allPlay: formatAllPlay(allPlay.get(r.rosterId)),
  }))

  /*
   * Which row is the viewer's. Drives the "you" highlight in the 9a table; null when the viewer
   * is a commissioner/owner with no roster of their own, in which case no row is highlighted
   * rather than an arbitrary one.
   *
   * ⚠ Keyed on `Roster.platformUserId`, which in this schema holds the AF user id — it is the
   * same column `resolveLeagueMembership` uses as its canonical roster-membership predicate
   * (NOT NULL, unique per league). `Roster` has no `userId`, and `LeagueTeam.platformUserId` is
   * the nullable lookalike that must never be used for identity.
   */
  const viewerRosterId =
    (await prisma.roster.findFirst({
      where: { leagueId, platformUserId: session.user.id },
      select: { id: true },
    }))?.id ?? null

  /*
   * Playoff-cut position, for the divider row. Read from league settings when present; the table
   * omits the divider entirely rather than assuming a conventional top-6.
   */
  const playoffTeams =
    league.settings && typeof league.settings === 'object' && !Array.isArray(league.settings)
      ? Number((league.settings as Record<string, unknown>).playoff_teams)
      : NaN
  const playoffCut = Number.isFinite(playoffTeams) && playoffTeams > 0 ? playoffTeams : null

  /*
   * The commissioner's divisions (`settings.division_config`, keyed by `LeagueTeam.id`). A standings
   * row is a generic `Roster.id`, which is its team's `externalId`. Best-effort: a failed read shows the
   * overall table alone, as before divisions were read here.
   */
  let divisions: Array<{ key: string; name: string; rosterIds: string[] }> | null = null
  const activeDivisions = parseActiveLeagueDivisions(league.settings)
  if (activeDivisions && standings.length > 0) {
    try {
      const [teams, rosters] = await Promise.all([
        prisma.leagueTeam.findMany({
          where: { leagueId },
          select: { id: true, externalId: true, claimedByUserId: true, platformUserId: true },
        }) as Promise<LeagueTeamIdentity[]>,
        prisma.roster.findMany({
          where: { leagueId, id: { in: standings.map((r) => r.rosterId) } },
          select: { id: true, platformUserId: true },
        }),
      ])
      const byRoster = resolveRosterDivisions(
        activeDivisions,
        teams,
        rosters.map((r) => ({ rosterId: r.id, ids: [r.platformUserId] })),
      )
      if (byRoster.size > 0) {
        divisions = activeDivisions.divisions.map((d) => ({
          key: d.key,
          name: d.name,
          rosterIds: standings.filter((r) => byRoster.get(r.rosterId)?.key === d.key).map((r) => r.rosterId),
        }))
      }
    } catch {
      divisions = null
    }
  }

  return NextResponse.json({ season, standings, scoringMode, viewerRosterId, playoffCut, divisions, divisionPlayoffRule: divisions ? activeDivisions?.playoffRule ?? null : null, source: 'native', sourcePlatform: 'AllFantasy', scoredWeeks: new Set(weekResults.map(r => r.week)).size, cumulative: league.bestBallMode && league.bbMatchupFormat === 'cumulative' }, { headers: { 'Cache-Control': 'private, no-store' } })
}
