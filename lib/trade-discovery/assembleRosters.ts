/**
 * T7 server helper — assemble DiscoveryRoster[] for a league from RedraftRoster + players, valuing
 * players via the T2 value engine over batch FantasyProjection projectedPoints. Deterministic, no
 * external calls. Players without a projection get `value: null` (engine treats as low-confidence —
 * never fabricated).
 */

import { prisma } from '@/lib/prisma'
import { buildTeamProfile } from '@/lib/trade-value/teamProfile'
import { normalizedPlayerValue } from '@/lib/trade-value/valueEngine'
import { loadLeagueIdpVorp } from '@/lib/idp-projections/leagueIdpVorp'
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
    prisma.league.findUnique({
      where: { id: leagueId },
      select: { draftPickTrading: true, settings: true, leagueType: true },
    }),
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

  /*
   * ⚠ DEFENDERS HAVE NO PROJECTION HERE AND NO MARKET PRICE ANYWHERE. `FantasyProjection` is an
   * offensive feed and `PlayerValueSnapshot` contains ZERO defensive players, so in an IDP league
   * every defender previously arrived at the discovery engine valued at null — which reads as
   * "worthless" to anything ranking a package.
   *
   * This is the one trade path that can fix that honestly. The other two deliberately pass
   * `idpValue: null` because they carry no league at all — a described trade may name no league,
   * and the snapshot write path has no scoring or slots — and an IDP value computed against the
   * wrong league is worse than an absent one. Here the league IS known, so its own scoring and
   * starting slots price its own defenders.
   */
  const rosterPositions = (() => {
    const raw = ((league?.settings ?? {}) as Record<string, unknown>).roster_positions
    return Array.isArray(raw) ? raw.map((x) => String(x).toUpperCase()) : null
  })()
  const idpValues = allPlayerIds.length
    ? (
        await loadLeagueIdpVorp({
          prisma,
          leagueId,
          rosterPositions,
          rosterPlayerIds: allPlayerIds,
          numTeams: leagueSize,
          isDynasty: (league?.leagueType ?? '').toLowerCase().includes('dynasty'),
        }).catch(() => null)
      )?.valueBySleeperId ?? new Map<string, number>()
    : new Map<string, number>()

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
          /*
           * `normalizedPlayerValue` already prefers an IDP value over a projection when one is
           * present, so a defender is priced on his league's own board and an offensive player is
           * unaffected. A defender with neither stays null rather than being scored as a zero.
           */
          value: (() => {
            const idpValue = idpValues.get(p.playerId) ?? null
            if (idpValue == null && typeof proj !== 'number') return null
            return normalizedPlayerValue({
              projection: typeof proj === 'number' ? proj : null,
              position: p.position,
              idpValue,
            })
          })(),
          isLocked: p.isLocked,
          byeWeek: p.byeWeek,
        }
      }),
    }
  })

  return { sport: season.sport, draftPickTrading: league?.draftPickTrading ?? false, rosters: discoveryRosters, ownerByRoster }
}
