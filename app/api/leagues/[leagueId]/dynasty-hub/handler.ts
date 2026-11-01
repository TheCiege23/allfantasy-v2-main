/**
 * GET /api/leagues/[leagueId]/dynasty-hub
 *
 * The viewer's own taxi squad and future picks for the league's Dynasty tab (`DynastyHome`).
 *
 * 🛑 THAT TAB FETCHED `/dynasty/taxi` AND `/dynasty/picks`, WHICH NEVER EXISTED. Both 404'd, the
 * component fell back to `{ taxi: [] }` / `{ picks: [] }`, and every dynasty league in every sport
 * showed "No players on taxi squad" and "No future draft picks" regardless of its real roster.
 *
 * Reads through the same deterministic context the War Room uses, so taxi slots and pick capital
 * (native `future_draft_picks` or the imported-pick inventory) agree with what the War Room shows.
 * No AI call. Scoped to the viewer's own team only.
 *
 * Also feeds the dynasty League home (`DynastyLeagueHomeExtras`): `titles` (championship rafters,
 * league-wide) and `pipeline` (the viewer's taxi / devy / rookie counts). Both are null when there
 * is nothing real to show.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/get-current-user'
import { buildDynastyWarRoomContext } from '@/lib/dynasty-war-room/dynastyWarRoomContext'
import { prisma } from '@/lib/prisma'
import { loadKnownYearsExp } from '@/lib/roster-lineup-engine/playerYearsExp'
import { buildChampionRafters, leagueRunsDevy, summarizePipeline, type ChampionRafters } from '@/lib/league/dynastyHomeExtras'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> },
) {
  const { leagueId } = await params
  const user = await getCurrentUser()
  if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await buildDynastyWarRoomContext({ leagueId, userId: user.id })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  const context = result.context
  // League-wide, so it is read before the "has a team" branch: a commissioner host sees it too.
  const titles = await loadChampionRafters(leagueId, user.id, context.season)
  const myTeam = context.teams.find((t) => t.isUserTeam) ?? null
  if (!myTeam) {
    return NextResponse.json({ taxi: [], picks: [], hasTeam: false, picksState: context.availability.futurePicks, titles, pipeline: null })
  }

  const teamNameByRosterId = new Map(context.teams.map((t) => [t.rosterId, t.teamName ?? t.ownerName]))

  const taxi = myTeam.players
    .filter((p) => p.slotType === 'taxi')
    .map((p) => ({
      id: p.playerId,
      name: p.playerName,
      position: p.position,
      team: p.team,
      age: p.age,
      // Not derivable here without each player's pro-experience year; null rather than a guess.
      eligibilityYearsLeft: null as number | null,
    }))

  const picks = myTeam.picks
    .slice()
    .sort((a, b) => a.season - b.season || a.round - b.round)
    .map((pk) => {
      const own = !pk.originalRosterId || pk.originalRosterId === myTeam.rosterId
      return {
        id: pk.id,
        year: pk.season,
        round: pk.round,
        type: own ? ('own' as const) : ('incoming' as const),
        fromTeam: own
          ? null
          : (pk.originalTeamName ?? (pk.originalRosterId ? teamNameByRosterId.get(pk.originalRosterId) : null) ?? null),
      }
    })

  // Pipeline counts for the dynasty League home. Rookies come only from KNOWN experience
  // (`SportsPlayer.yearsExp`, the same reader the rollover and taxi checks use); unknown stays unknown.
  const leagueShape = await prisma.league
    .findUnique({ where: { id: leagueId }, select: { leagueVariant: true, leagueType: true } })
    .catch(() => null)
  const proIds = myTeam.players.filter((p) => p.lineupSection !== 'devy').map((p) => p.playerId)
  const yearsExpByPlayerId = await loadKnownYearsExp(
    [...new Set([context.sport, context.sport.toUpperCase(), context.sport.toLowerCase()])],
    [...new Set(proIds)],
  ).catch(() => new Map<string, number>())
  const pipeline = summarizePipeline({
    players: myTeam.players,
    taxiSlots: context.roster.taxiSlots,
    leagueHasDevy: leagueRunsDevy(leagueShape ?? {}),
    yearsExpByPlayerId,
  })

  return NextResponse.json({
    taxi,
    picks,
    hasTeam: true,
    picksState: context.availability.futurePicks,
    titles,
    pipeline,
  })
}

/**
 * Past champions for the rafters, from the two tables that record them: `league_seasons`
 * (imported history and native rollover) and `league_championships` (native playoff runtime,
 * Guilly, Survivor). Null when neither has a champion. Best-effort: a failed read hides the rafters.
 */
async function loadChampionRafters(leagueId: string, userId: string, currentSeason: number): Promise<ChampionRafters | null> {
  const [seasons, championships] = await Promise.all([
    prisma.leagueSeason
      .findMany({
        where: { leagueId },
        select: {
          season: true,
          championName: true,
          championTeam: { select: { platformUserId: true, claimedByUserId: true, teamName: true } },
        },
      })
      .catch(() => []),
    prisma.leagueChampionship
      .findMany({ where: { leagueId }, select: { season: true, championUserId: true, teamName: true } })
      .catch(() => []),
  ])
  return buildChampionRafters({
    seasons: seasons.map((row) => ({
      season: row.season,
      championName: row.championName,
      championTeamUserIds: row.championTeam ? [row.championTeam.platformUserId, row.championTeam.claimedByUserId] : [],
      championTeamName: row.championTeam?.teamName ?? null,
    })),
    championships,
    viewerUserId: userId,
    currentSeason: Number.isInteger(currentSeason) ? currentSeason : null,
  })
}
