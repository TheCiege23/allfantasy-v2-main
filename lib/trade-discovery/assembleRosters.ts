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
import { crosswalkToSleeperIds, sleeperLookupId } from '@/lib/core-app/rosterIdCrosswalk'
import { latestProjectionWeek } from '@/lib/core-app/playerProjections'

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
      select: { draftPickTrading: true, settings: true, leagueType: true, platform: true },
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

  /*
   * 🛑 `fantasy_projections` IS KEYED ON SLEEPER IDS AND AN IMPORTED ROSTER IS NOT. This read was
   * `playerId IN <roster ids>` with no platform check, so an ESPN / Fleaflicker roster priced its players
   * on whoever holds those digits in Sleeper's space (ESPN 12483 Matthew Stafford -> Jack Bech; Fleaflicker
   * 10888 Cairo Santos -> Jalen Carter) and trade discovery, the package finder and the trade block ranked
   * on it. Each roster id is translated through the crosswalk (`sleeperLookupId`, as matchupProjections
   * does); one that does not translate is unpriced (`value: null`), never a stranger's number.
   */
  const platform = league?.platform ?? null
  const sleeperIdByRosterId = await crosswalkToSleeperIds(String(platform ?? ''), season.sport, allPlayerIds).catch(
    () => new Map<string, string>(),
  )
  const lookupOf = (id: string) => sleeperLookupId(platform, id, sleeperIdByRosterId, season.sport)
  const lookupIds = [...new Set(allPlayerIds.map(lookupOf).filter((x): x is string => x != null))]

  /*
   * ⚠ THE WEEK THE FEED HOLDS, NOT "THE NEWEST ROW PER PLAYER". With no season/week filter a player not
   * projected this week (a bye, an injury) was priced on whatever week he last had a row for. The feed's
   * current week comes from `latestProjectionWeek`, the reader every other current-projection surface uses.
   */
  const projectionWeek = lookupIds.length ? await latestProjectionWeek().catch(() => null) : null
  const projRows = projectionWeek
    ? await prisma.fantasyProjection.findMany({
        where: {
          playerId: { in: lookupIds },
          sport: season.sport,
          season: projectionWeek.season,
          week: projectionWeek.week,
          source: { not: 'allfantasy' },
        },
        select: { playerId: true, projectedPoints: true, fetchedAt: true },
        orderBy: { fetchedAt: 'desc' },
      })
    : []
  const projBySleeperId = new Map<string, number>()
  for (const row of projRows) if (!projBySleeperId.has(row.playerId)) projBySleeperId.set(row.playerId, row.projectedPoints)
  const projOf = (rosterId: string) => {
    const sid = lookupOf(rosterId)
    return sid ? projBySleeperId.get(sid) : undefined
  }

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
  // Keyed on Sleeper ids too (`valueBySleeperId`), so it is asked with the translated ids.
  const idpValues = lookupIds.length
    ? (
        await loadLeagueIdpVorp({
          prisma,
          leagueId,
          rosterPositions,
          rosterPlayerIds: lookupIds,
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
        const proj = projOf(p.playerId)
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
            const sid = lookupOf(p.playerId)
            const idpValue = (sid ? idpValues.get(sid) : null) ?? null
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
