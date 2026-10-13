/**
 * Loads a league's all-time standings (lib/league/allTimeStandings.ts) from Postgres only — no provider.
 *
 * Sources:
 *   - `LeagueSeason` rows: every archived season, imported or native;
 *   - for a native league, the season being played now, from its `RedraftRoster` rows, when it has no
 *     archived row yet;
 *   - "moves": free-agent adds and waiver claims (`WaiverTransaction`) plus completed trades in both
 *     trade systems (`AfLeagueTrade` processed, `RedraftTradeProposal` accepted), per manager;
 *   - "messages": league chat posts (`LeagueChatMessage`, private Chimmy threads excluded).
 *
 * ⚠ MOVES AND MESSAGES ARE ALLFANTASY ACTIVITY ONLY. An imported league's earlier seasons happened on
 * its host and none of that activity is on file; those columns say so (null) rather than showing a
 * misleading 0 for a league with no activity here at all.
 *
 * Owner ids: a native roster's owner is the AllFantasy user; an imported roster's owner is the host's
 * user id (Sleeper). A claimed imported team links the two (`LeagueTeam.claimedByUserId` ↔
 * `platformUserId`), which is how an AllFantasy chat author is matched to a Sleeper-keyed record.
 */
import 'server-only'
import { prisma } from '@/lib/prisma'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { computeAllTimeStandingsByOwner, type AllTimeStandingRow, type StandingsSeasonInput } from './allTimeStandings'

function bump(map: Map<string, number>, key: string | null | undefined, by = 1) {
  if (!key) return
  map.set(key, (map.get(key) ?? 0) + by)
}

export async function loadAllTimeStandings(leagueId: string): Promise<AllTimeStandingRow[]> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { platform: true, season: true, teams: { select: { claimedByUserId: true, platformUserId: true } } },
  })
  if (!league) return []
  const native = isNativePlatform(league.platform)

  const archived = await prisma.leagueSeason.findMany({
    where: { leagueId },
    select: { season: true, championTeamId: true, championName: true, runnerUpName: true, teamRecords: true },
  })
  const seasons: StandingsSeasonInput[] = archived.map((s) => ({ ...s, teamRecords: s.teamRecords }))

  // The season in progress, live, when it has not been archived yet.
  if (native) {
    const current = await prisma.redraftSeason.findFirst({
      where: { leagueId },
      orderBy: { season: 'desc' },
      select: {
        season: true,
        rosters: {
          select: { id: true, ownerId: true, ownerName: true, teamName: true, wins: true, losses: true, ties: true, pointsFor: true, pointsAgainst: true },
        },
      },
    })
    if (current && !archived.some((s) => s.season === current.season)) {
      seasons.push({
        season: current.season,
        inProgress: true,
        teamRecords: current.rosters.map((r) => ({
          rosterId: r.id,
          managerUserId: r.ownerId,
          managerName: r.ownerName,
          teamName: r.teamName,
          wins: r.wins,
          losses: r.losses,
          ties: r.ties,
          pointsFor: r.pointsFor,
          pointsAgainst: r.pointsAgainst,
        })),
      })
    }
  }

  // An AllFantasy user → the owner id their records are keyed by (only differs on an imported league).
  const aliases = new Map<string, string>()
  for (const t of league.teams) {
    if (t.claimedByUserId && t.platformUserId && t.claimedByUserId !== t.platformUserId) aliases.set(t.claimedByUserId, t.platformUserId)
  }
  const keyOf = (id: string | null | undefined) => (id ? aliases.get(id) ?? id : null)

  // Moves. Rosters key to their owner; native redraft rosters to theirs.
  const rosters = await prisma.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true } })
  const ownerByRoster = new Map(rosters.map((r) => [r.id, r.platformUserId]))
  const redraftRosters = await prisma.redraftRoster.findMany({ where: { leagueId }, select: { id: true, ownerId: true } })
  const ownerByRedraftRoster = new Map(redraftRosters.map((r) => [r.id, r.ownerId]))

  const [waivers, trades, redraftTrades, chat] = await Promise.all([
    prisma.waiverTransaction.groupBy({ by: ['rosterId'], where: { leagueId }, _count: { _all: true } }),
    prisma.afLeagueTrade.findMany({ where: { leagueId, status: 'processed' }, select: { proposerRosterId: true, receiverRosterId: true } }),
    prisma.redraftTradeProposal.findMany({ where: { leagueId, status: 'accepted' }, select: { proposerRosterId: true, receiverRosterId: true } }),
    prisma.leagueChatMessage.groupBy({ by: ['userId'], where: { leagueId, isPrivate: false }, _count: { _all: true } }),
  ])

  const moves = new Map<string, number>()
  for (const w of waivers) bump(moves, keyOf(ownerByRoster.get(w.rosterId)), w._count._all)
  for (const t of trades) {
    bump(moves, keyOf(ownerByRoster.get(t.proposerRosterId)))
    bump(moves, keyOf(ownerByRoster.get(t.receiverRosterId)))
  }
  for (const t of redraftTrades) {
    bump(moves, keyOf(ownerByRedraftRoster.get(t.proposerRosterId)))
    bump(moves, keyOf(ownerByRedraftRoster.get(t.receiverRosterId)))
  }
  const messages = new Map<string, number>()
  for (const c of chat) bump(messages, keyOf(c.userId), c._count._all)

  const hasActivity = native || moves.size > 0 || messages.size > 0
  return computeAllTimeStandingsByOwner({
    seasons,
    aliases,
    moves: hasActivity ? moves : null,
    messages: hasActivity ? messages : null,
  })
}
