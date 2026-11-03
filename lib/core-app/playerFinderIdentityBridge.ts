import 'server-only'

import { prisma } from '@/lib/prisma'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { playerNamesAgree } from '@/lib/player-identity/externalIdNamespace'
import type { LeagueSlot, PlayerMatch } from './playerFinder'
import { isBestBallLeagueRow } from './leagueBestBall'

type IdentityColumn = 'rollingInsightsId' | 'cfbdId' | 'apiSportsId'
type RosterColumn = 'rollingInsightsId' | 'sleeperId' | 'espnId' | 'mflId' | 'fleaflickerId' | 'fantraxId'
type Identity = Record<RosterColumn, string | null> & { id: string; canonicalName: string }

const SOURCE_COLUMN: Record<string, IdentityColumn> = {
  rolling_insights: 'rollingInsightsId',
  cfbd: 'cfbdId',
  api_sports: 'apiSportsId',
}
const PLATFORM_COLUMN: Record<string, RosterColumn> = {
  sleeper: 'sleeperId',
  espn: 'espnId',
  mfl: 'mflId',
  fleaflicker: 'fleaflickerId',
  fantrax: 'fantraxId',
}
const SLOT_ORDER = ['starters', 'reserve', 'taxi', 'players'] as const

function slotOf(data: unknown, playerId: string): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const pd = data as Record<string, unknown>
  for (const key of SLOT_ORDER) {
    if (!Array.isArray(pd[key]) || !(pd[key] as unknown[]).some((id) => String(id) === playerId)) continue
    return key === 'starters' ? 'STARTER' : key === 'reserve' ? 'IR SLOT' : key === 'taxi' ? 'TAXI' : 'BENCH'
  }
  return null
}

/** Resolve a catalog row only through its sport and the provider that minted its id. */
export async function identityForFinderPlayer(player: Pick<PlayerMatch, 'sport' | 'source' | 'externalId' | 'name'>): Promise<Identity | null> {
  const column = SOURCE_COLUMN[String(player.source ?? '').toLowerCase()]
  if (!column || !player.externalId) return null
  const rows = await prisma.playerIdentityMap.findMany({
    where: { sport: player.sport, [column]: player.externalId },
    select: {
      id: true, canonicalName: true, rollingInsightsId: true, sleeperId: true, espnId: true,
      mflId: true, fleaflickerId: true, fantraxId: true,
    },
    take: 2,
  })
  // Provider columns are indexed, but not unique. Two identity rows make a crosswalk unsafe.
  if (rows.length !== 1 || !playerNamesAgree(rows[0]!.canonicalName, player.name)) return null
  const identity: Identity = { ...rows[0]! }
  // The target columns are also nonunique. A duplicate Fantrax/ESPN/etc. id cannot
  // prove which athlete a roster means, even when this source id was unique.
  const targets = [...new Set<RosterColumn>(['rollingInsightsId', ...Object.values(PLATFORM_COLUMN)])]
  await Promise.all(targets.map(async (target) => {
    const id = identity[target]?.trim()
    if (!id || target === column || target === 'sleeperId') return
    const owners = await prisma.playerIdentityMap.findMany({
      where: { sport: player.sport, [target]: id }, select: { id: true }, take: 2,
    })
    if (owners.length !== 1 || owners[0]!.id !== identity.id) identity[target] = null
  }))
  return identity
}

/** The roster id for this player in this league's own namespace, if verified. */
export function rosterIdForFinderPlayer(
  player: Pick<PlayerMatch, 'sport' | 'source' | 'externalId'>,
  platform: string | null | undefined,
  identity: Identity | null,
): string | null {
  const provider = String(platform ?? '').toLowerCase()
  if (isNativePlatform(provider)) {
    if (player.source === 'rolling_insights' && /^\d+$/.test(player.externalId)) return player.externalId
    if (player.source === 'thesportsdb' && /^tsdb_/.test(player.externalId)) return player.externalId
    return identity?.rollingInsightsId?.trim() || null
  }
  const column = PLATFORM_COLUMN[provider]
  return column ? identity?.[column]?.trim() || null : null
}

export type FinderBridgeResult = {
  resolved: boolean
  slots: LeagueSlot[]
  unmatched: Array<{ leagueId: string; leagueName: string; platform: string }>
}

/** Read raw non-NFL rosters in their own id space; never translate them through Sleeper. */
export async function resolveNonNflLeagueSlots(
  player: Pick<PlayerMatch, 'sport' | 'source' | 'externalId' | 'name'>,
  leagueIds: string[],
  userId: string | null | undefined,
): Promise<FinderBridgeResult> {
  const identity = await identityForFinderPlayer(player)
  const resolved = Boolean(identity ||
    (player.source === 'rolling_insights' && /^\d+$/.test(player.externalId)) ||
    (player.source === 'thesportsdb' && /^tsdb_/.test(player.externalId)))
  const result: FinderBridgeResult = { resolved, slots: [], unmatched: [] }
  if (!leagueIds.length || !userId) return result

  const leagues = await prisma.league.findMany({
    where: { id: { in: leagueIds } },
    select: { id: true, name: true, platform: true, sport: true, leagueType: true,
      platformLeagueId: true, season: true, bestBallMode: true, leagueVariant: true, settings: true },
  })
  const sameSportLeagues = leagues.filter((l) => String(l.sport).toUpperCase() === player.sport.toUpperCase())
  if (!sameSportLeagues.length) return result
  const [rosters, teams] = await Promise.all([
    prisma.roster.findMany({
      where: { leagueId: { in: sameSportLeagues.map((l) => l.id) } },
      select: { leagueId: true, platformUserId: true, playerData: true },
    }),
    prisma.leagueTeam.findMany({
      where: { leagueId: { in: sameSportLeagues.map((l) => l.id) } },
      select: { leagueId: true, externalId: true, platformUserId: true, claimedByUserId: true,
        ownerName: true, teamName: true, avatarUrl: true },
    }),
  ])

  for (const league of sameSportLeagues) {
    const platform = String(league.platform ?? 'manual').toLowerCase()
    const leagueRosters = rosters.filter((r) => r.leagueId === league.id)
    if (!leagueRosters.length) continue
    const playerId = rosterIdForFinderPlayer(player, platform, identity)
    if (!playerId) {
      result.unmatched.push({ leagueId: league.id, leagueName: league.name ?? 'League', platform })
      continue
    }
    const holder = leagueRosters.map((r) => ({ roster: r, slot: slotOf(r.playerData, playerId) }))
      .find((r) => r.slot)
    if (!holder) continue
    const leagueTeams = teams.filter((t) => t.leagueId === league.id)
    const yours = leagueTeams.some((t) => t.claimedByUserId === userId &&
      [t.platformUserId, t.externalId, userId].includes(holder.roster.platformUserId))
    const yourTeam = leagueTeams.find((t) => t.claimedByUserId === userId)
    const owner = leagueTeams.find((t) => t.platformUserId === holder.roster.platformUserId || t.externalId === holder.roster.platformUserId)
    result.slots.push({
      leagueId: league.id,
      leagueName: league.name ?? 'League',
      platform,
      format: league.leagueType ?? null,
      platformLeagueId: league.platformLeagueId ?? null,
      season: league.season ?? null,
      teamExternalId: yourTeam?.externalId ?? null,
      slot: yours ? holder.slot! : 'NOT YOURS',
      isYours: yours,
      owner: yours || !owner ? null : {
        teamName: owner.teamName, ownerName: owner.ownerName,
        avatarUrl: owner.avatarUrl, externalId: owner.externalId,
      },
      bestBall: isBestBallLeagueRow(league),
    })
  }
  return result
}
