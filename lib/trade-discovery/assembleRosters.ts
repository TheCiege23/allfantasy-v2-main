/**
 * T7 server helper — assemble DiscoveryRoster[] for a league from RedraftRoster + players, valuing
 * players via the T2 value engine over batch FantasyProjection projectedPoints. Deterministic, no
 * external calls. Players without a projection get `value: null` (engine treats as low-confidence —
 * never fabricated).
 */

import { prisma } from '@/lib/prisma'
import { buildTeamProfile } from '@/lib/trade-value/teamProfile'
import { normalizedPlayerValue } from '@/lib/trade-value/valueEngine'
import type { DiscoveryRoster } from '@/lib/trade-discovery/redraftTradeDiscovery'

const RECENT_DAYS = 30

export interface AssembledLeague {
  sport: string
  draftPickTrading: boolean
  rosters: DiscoveryRoster[]
  /** ownerId per rosterId — used for ownership/privacy checks (never returned to the client). */
  ownerByRoster: Map<string, string>
}

export async function assembleDiscoveryLeague(leagueId: string): Promise<AssembledLeague | null> {
  const season = await prisma.redraftSeason.findFirst({
    where: { leagueId },
    select: { id: true, sport: true },
    orderBy: { season: 'desc' },
  })
  if (!season) return null

  const [league, rosters] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { draftPickTrading: true } }),
    prisma.redraftRoster.findMany({
      where: { seasonId: season.id },
      select: {
        id: true, ownerId: true, ownerName: true, teamName: true,
        wins: true, losses: true, ties: true, pointsFor: true, playoffSeed: true, faabBalance: true,
        players: { where: { droppedAt: null }, select: { playerId: true, playerName: true, position: true, isLocked: true, byeWeek: true } },
      },
    }),
  ])

  const leagueSize = rosters.length || 12
  const allPlayerIds = [...new Set(rosters.flatMap((r) => r.players.map((p) => p.playerId)))]

  // Batch projections (latest per player) → value.
  const projRows = allPlayerIds.length
    ? await prisma.fantasyProjection.findMany({
        where: { playerId: { in: allPlayerIds }, sport: season.sport, source: { not: 'allfantasy' } },
        select: { playerId: true, projectedPoints: true, fetchedAt: true },
        orderBy: { fetchedAt: 'desc' },
      })
    : []
  const projByPlayer = new Map<string, number>()
  for (const row of projRows) if (!projByPlayer.has(row.playerId)) projByPlayer.set(row.playerId, row.projectedPoints)

  // Recent trade activity per roster (last 30 days, any status).
  const cutoff = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000)
  const recent = await prisma.redraftTradeProposal.findMany({
    where: { seasonId: season.id, createdAt: { gte: cutoff } },
    select: { proposerRosterId: true, receiverRosterId: true },
  })
  const recentByRoster = new Map<string, number>()
  for (const t of recent) {
    recentByRoster.set(t.proposerRosterId, (recentByRoster.get(t.proposerRosterId) ?? 0) + 1)
    recentByRoster.set(t.receiverRosterId, (recentByRoster.get(t.receiverRosterId) ?? 0) + 1)
  }

  const ownerByRoster = new Map<string, string>()
  const discoveryRosters: DiscoveryRoster[] = rosters.map((r) => {
    ownerByRoster.set(r.id, r.ownerId)
    const profile = buildTeamProfile({
      rosterId: r.id, wins: r.wins, losses: r.losses, ties: r.ties, pointsFor: r.pointsFor,
      playoffSeed: r.playoffSeed, leagueSize, positions: r.players.map((p) => p.position),
    })
    return {
      rosterId: r.id,
      teamName: r.teamName ?? r.ownerName ?? r.id.slice(0, 6),
      managerDisplayName: r.ownerName ?? null,
      stance: profile.stance,
      weakPositions: profile.weakPositions,
      strongPositions: profile.strongPositions,
      faabBalance: r.faabBalance,
      recentTradeCount: recentByRoster.get(r.id) ?? 0,
      players: r.players.map((p) => {
        const proj = projByPlayer.get(p.playerId)
        return {
          playerId: p.playerId,
          playerName: p.playerName,
          position: p.position,
          value: typeof proj === 'number' ? normalizedPlayerValue({ projection: proj, position: p.position }) : null,
          isLocked: p.isLocked,
          byeWeek: p.byeWeek,
        }
      }),
    }
  })

  return { sport: season.sport, draftPickTrading: league?.draftPickTrading ?? false, rosters: discoveryRosters, ownerByRoster }
}
