import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueAccess } from '@/lib/league-access'
import { buildRosterLabelMap } from '@/lib/scoring-engine/resolveTeamLabels'
import { loadNativeScoreboard } from '@/server/services/nativeMatchupCenter'
import { loadImportedScoreboard } from '@/server/services/importedScoreboard'
import { isNativePlatform } from '@/lib/dashboard/platform-label'

export async function GET(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = params.leagueId
  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { id: true, season: true, sport: true, settings: true, leagueVariant: true, platform: true, platformLeagueId: true, playoffWeeksPerRound: true },
  })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Canonical membership predicate. Was gating on the nullable `LeagueTeam.platformUserId`,
  // which 403'd real members of imported leagues (their membership lives in `Roster`).
  const access = await resolveLeagueAccess(leagueId, session.user.id)
  if (!access?.isMember) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sp = req.nextUrl.searchParams

  /*
   * A league that plays here: the week's games from its own schedule and bracket. `teamWeekResult`
   * below is never written for it on a schedule (lib/matchup-center/nativeMatchupModel.ts). `games`
   * is one line per game, so a team that plays several games in a week is drawn once per game;
   * `matchups` keeps the one-row-per-team shape for anything still reading it.
   */
  const askedSeason = Number(sp.get('season'))
  const askedWeek = Number(sp.get('week'))
  const native = await loadNativeScoreboard({
    league,
    viewerUserId: session.user.id,
    season: Number.isInteger(askedSeason) && askedSeason >= 2000 && askedSeason <= 2100 ? askedSeason : undefined,
    week: Number.isInteger(askedWeek) && askedWeek >= 1 && askedWeek <= 60 ? askedWeek : undefined,
  })
  if (native) {
    // The per-team rows only ever existed for a scored week, with a number in them: keep that contract.
    // A game not started yet, and a bye, are in `games` only.
    const side = (
      mine: { rosterId: string; teamName: string; totalPoints: number | null },
      theirs: { rosterId: string; teamName: string; totalPoints: number | null },
      status: string,
    ) => {
      const a = mine.totalPoints ?? 0
      const b = theirs.totalPoints ?? 0
      return {
        rosterId: mine.rosterId,
        teamName: mine.teamName,
        totalPoints: a,
        opponentRosterId: theirs.rosterId,
        opponentName: theirs.teamName,
        winLoss: status === 'final' ? (a > b ? 'W' : a < b ? 'L' : 'T') : null,
        status,
      }
    }
    const matchups = native.games.flatMap((g) =>
      g.away && g.status !== 'upcoming' ? [side(g.home, g.away, g.status), side(g.away, g.home, g.status)] : [],
    )
    return NextResponse.json({ season: native.season, week: native.week, matchups, games: native.games })
  }

  /*
   * 🛑 AN IMPORTED LEAGUE'S WEEK LIVES IN `WeeklyMatchup` (found live 2026-11-23). Nothing writes
   * `teamWeekResult` for one, so the read below said "Scores appear here once week N is scored" in a
   * scored week. `games` only: the per-team `matchups` rows are the native contract, and the screen
   * draws one line per game from `games`.
   */
  if (league.platformLeagueId && !isNativePlatform(league.platform)) {
    const imported = await loadImportedScoreboard({
      leagueId,
      viewerUserId: session.user.id,
      week: Number.isInteger(askedWeek) && askedWeek >= 1 && askedWeek <= 60 ? askedWeek : undefined,
    }).catch(() => null)
    if (imported) return NextResponse.json({ season: imported.season, week: imported.week, matchups: [], games: imported.games })
  }

  const season = Math.max(2000, Math.min(2100, Number(sp.get('season')) || league.season))
  const week = Math.max(1, Math.min(40, Number(sp.get('week')) || 1))

  const [rows, labels] = await Promise.all([
    prisma.teamWeekResult.findMany({
      where: { leagueId, season, week },
      orderBy: { rosterId: 'asc' },
    }),
    buildRosterLabelMap(leagueId),
  ])

  const enriched = rows.map((r) => ({
    rosterId: r.rosterId,
    teamName: labels.get(r.rosterId) ?? r.rosterId,
    totalPoints: r.totalPoints,
    opponentRosterId: r.opponentRosterId,
    opponentName: r.opponentRosterId ? labels.get(r.opponentRosterId) ?? r.opponentRosterId : null,
    winLoss: r.winLoss,
    status: r.status,
  }))

  return NextResponse.json({ season, week, matchups: enriched })
}
