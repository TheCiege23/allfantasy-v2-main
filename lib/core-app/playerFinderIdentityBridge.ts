import 'server-only'

import { prisma } from '@/lib/prisma'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { playerNamesAgree } from '@/lib/player-identity/externalIdNamespace'
import type { LeagueSlot, PlayerMatch } from './playerFinder'
import { isBestBallLeagueRow } from './leagueBestBall'
import { normalizePosition } from './positionNormalization'

type IdentityColumn = 'rollingInsightsId' | 'cfbdId' | 'apiSportsId' | 'sleeperNbaId'
type RosterColumn = 'rollingInsightsId' | 'sleeperId' | 'sleeperNbaId' | 'espnId' | 'mflId' | 'fleaflickerId' | 'fantraxId'
export type FinderIdentity = Record<RosterColumn, string | null> & { id: string; canonicalName: string; cfbdId: string | null }
type Identity = FinderIdentity
type FinderCandidate = Pick<PlayerMatch, 'sport' | 'source' | 'externalId' | 'name'> & {
  position?: string | null
  sleeperId?: string | null
}

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

function hasRosterIds(data: unknown): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false
  const pd = data as Record<string, unknown>
  return SLOT_ORDER.some((key) => Array.isArray(pd[key]) && (pd[key] as unknown[]).length > 0)
}

export function finderIdentityKey(player: Pick<PlayerMatch, 'sport' | 'source' | 'externalId'>): string {
  return `${player.sport}|${String(player.source ?? '').toLowerCase()}|${player.externalId}`
}

/** Batch source and reverse-target checks for the typeahead's several candidates. */
export async function identitiesForFinderPlayers(players: readonly FinderCandidate[]): Promise<Map<string, FinderIdentity>> {
  const out = new Map<string, FinderIdentity>()
  const eligible = players.map((player) => ({ player, column: player.sport === 'NBA' && player.source === 'sleeper'
    ? 'sleeperNbaId' as const : SOURCE_COLUMN[String(player.source ?? '').toLowerCase()],
    lookupId: player.sport === 'NBA' && player.source === 'sleeper' ? player.sleeperId : player.externalId }))
    .filter((item): item is { player: FinderCandidate; column: IdentityColumn; lookupId: string } => Boolean(item.column && item.lookupId))
  if (!eligible.length) return out
  const rows = await prisma.playerIdentityMap.findMany({
    where: { OR: eligible.map(({ player, column, lookupId }) => ({ sport: player.sport, [column]: lookupId })) },
    select: { id: true, sport: true, canonicalName: true, position: true, rollingInsightsId: true,
      cfbdId: true, apiSportsId: true, sleeperId: true, sleeperNbaId: true, espnId: true, mflId: true,
      fleaflickerId: true, fantraxId: true },
  })
  const accepted: Array<{ player: FinderCandidate; column: IdentityColumn; identity: FinderIdentity }> = []
  for (const { player, column, lookupId } of eligible) {
    const matches = rows.filter((row) => row.sport === player.sport && row[column] === lookupId)
    if (matches.length !== 1 || !playerNamesAgree(matches[0]!.canonicalName, player.name)) continue
    if (player.position && matches[0]!.position &&
      normalizePosition(player.position) !== normalizePosition(matches[0]!.position)) continue
    accepted.push({ player, column, identity: { ...matches[0]! } })
  }
  const targets = [...new Set<RosterColumn>(['rollingInsightsId', 'sleeperNbaId', ...Object.values(PLATFORM_COLUMN)])]
  const targetConditions = new Map<string, { sport: string; column: RosterColumn; id: string }>()
  for (const { player, column, identity } of accepted) {
    for (const target of targets) {
      const id = identity[target]?.trim()
      if (!id || target === column || target === 'sleeperId') continue
      targetConditions.set(`${player.sport}|${target}|${id}`, { sport: player.sport, column: target, id })
    }
  }
  const reverseRows = targetConditions.size ? await prisma.playerIdentityMap.findMany({
    where: { OR: [...targetConditions.values()].map(({ sport, column, id }) => ({ sport, [column]: id })) },
    select: { id: true, sport: true, rollingInsightsId: true, sleeperNbaId: true, espnId: true,
      mflId: true, fleaflickerId: true, fantraxId: true },
  }) : []
  for (const { player, column, identity } of accepted) {
    for (const target of targets) {
      const id = identity[target]?.trim()
      if (!id || target === column || target === 'sleeperId') continue
      const owners = reverseRows.filter((row) => row.sport === player.sport && row[target] === id)
      if (owners.length !== 1 || owners[0]!.id !== identity.id) identity[target] = null
    }
    out.set(finderIdentityKey(player), identity)
  }
  return out
}

/** Resolve one catalog row through its sport and source-qualified provider id. */
export async function identityForFinderPlayer(player: FinderCandidate): Promise<FinderIdentity | null> {
  return (await identitiesForFinderPlayers([player])).get(finderIdentityKey(player)) ?? null
}

/** The roster id for this player in this league's own namespace, if verified. */
export function rosterIdForFinderPlayer(
  player: Pick<PlayerMatch, 'sport' | 'source' | 'externalId'> & { sleeperId?: string | null },
  platform: string | null | undefined,
  identity: Identity | null,
): string | null {
  const provider = String(platform ?? '').toLowerCase()
  if (provider === 'sleeper' && player.sport === 'NBA' && player.source === 'sleeper') {
    return player.sleeperId?.trim() || null
  }
  if (provider === 'sleeper' && player.sport === 'NBA') return identity?.sleeperNbaId?.trim() || null
  if (isNativePlatform(provider)) {
    if (player.source === 'rolling_insights' && /^\d+$/.test(player.externalId)) return player.externalId
    if (player.source === 'thesportsdb' && /^tsdb_/.test(player.externalId)) return player.externalId
    return identity?.rollingInsightsId?.trim() || null
  }
  const column = PLATFORM_COLUMN[provider]
  return column ? identity?.[column]?.trim() || null : null
}

type FinderBridgeResult = {
  resolved: boolean
  slots: LeagueSlot[]
  unmatched: Array<{ leagueId: string; leagueName: string; platform: string }>
}

/** Read raw non-NFL rosters in their own id space; never translate them through Sleeper. */
export async function resolveNonNflLeagueSlots(
  player: FinderCandidate,
  leagueIds: string[],
  userId: string | null | undefined,
): Promise<FinderBridgeResult> {
  const identity = await identityForFinderPlayer(player)
  const resolved = Boolean(identity ||
    (player.source === 'rolling_insights' && /^\d+$/.test(player.externalId)) ||
    (player.source === 'thesportsdb' && /^tsdb_/.test(player.externalId)) ||
    (player.sport === 'NBA' && player.source === 'sleeper' && player.sleeperId))
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
    if (!leagueRosters.length) {
      result.unmatched.push({ leagueId: league.id, leagueName: league.name ?? 'League', platform })
      continue
    }
    const playerId = rosterIdForFinderPlayer(player, platform, identity)
    if (!playerId || !leagueRosters.some((r) => hasRosterIds(r.playerData))) {
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
