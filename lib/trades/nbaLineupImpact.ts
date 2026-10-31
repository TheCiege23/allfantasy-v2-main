import 'server-only'

import { prisma } from '@/lib/prisma'
import { rosterSourceTeamId } from '@/lib/league-import/importedRosterIdentity'
import type { TradeLeagueContext } from './loadTradeLeagueContext'
import { priceNbaHistory, readNbaPlayerHistory, type NbaPricedPlayer } from './nbaPointsTradeEvaluation'

type LineupPlayer = { playerId: string; name: string; position: string; pointsPerGame: number }
type TeamImpact = { teamId: string; before: number; after: number; delta: number }
export type NbaLineupImpact =
  | { status: 'verified'; sender: TeamImpact; receiver: TeamImpact }
  | { status: 'unavailable'; reason: string }

const NBA_POSITIONS = new Set(['PG', 'SG', 'SF', 'PF', 'C'])
const NBA_SLOTS = new Set(['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL'])
const round = (value: number) => Math.round(value * 100) / 100

function positionTokens(position: string): string[] {
  return position.toUpperCase().split(/[,/;\s]+/).filter(Boolean)
}

function eligible(position: string, slot: string): boolean {
  const tokens = positionTokens(position)
  if (slot === 'UTIL') return tokens.some((token) => NBA_POSITIONS.has(token))
  if (slot === 'G') return tokens.some((token) => token === 'PG' || token === 'SG')
  if (slot === 'F') return tokens.some((token) => token === 'SF' || token === 'PF')
  return tokens.includes(slot)
}

/** Exact maximum-weight assignment; flexible slots cannot steal a scarce position. */
export function bestNbaLineup(players: LineupPlayer[], starterSlots: Record<string, number>): number | null {
  const slots: string[] = []
  for (const [label, count] of Object.entries(starterSlots)) {
    const slot = label.toUpperCase()
    if (!NBA_SLOTS.has(slot) || !Number.isInteger(count) || count < 0 || count > 25) return null
    for (let i = 0; i < count; i++) slots.push(slot)
  }
  if (!slots.length || slots.length > 25) return null
  // Hungarian algorithm for min cost assignment, with one zero-value dummy per slot.
  const n = slots.length
  const m = players.length + n
  const u = Array(n + 1).fill(0) as number[]
  const v = Array(m + 1).fill(0) as number[]
  const p = Array(m + 1).fill(0) as number[]
  const way = Array(m + 1).fill(0) as number[]
  const cost = (row: number, column: number) => column > players.length ? 0
    : eligible(players[column - 1].position, slots[row - 1])
      ? -players[column - 1].pointsPerGame : 1_000_000
  for (let row = 1; row <= n; row++) {
    p[0] = row
    let column = 0
    const minv = Array(m + 1).fill(Infinity) as number[]
    const used = Array(m + 1).fill(false) as boolean[]
    do {
      used[column] = true
      const current = p[column]
      let delta = Infinity
      let next = 0
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue
        const reduced = cost(current, j) - u[current] - v[j]
        if (reduced < minv[j]) { minv[j] = reduced; way[j] = column }
        if (minv[j] < delta) { delta = minv[j]; next = j }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta }
        else minv[j] -= delta
      }
      column = next
    } while (p[column] !== 0)
    do {
      const previous = way[column]
      p[column] = p[previous]
      column = previous
    } while (column !== 0)
  }
  let total = 0
  for (let column = 1; column <= m; column++) {
    if (p[column] && column <= players.length && eligible(players[column - 1].position, slots[p[column] - 1])) {
      total += players[column - 1].pointsPerGame
    }
  }
  return round(total)
}

function rawPlayerIds(playerData: unknown): string[] | null {
  const data = playerData && typeof playerData === 'object' && !Array.isArray(playerData)
    ? playerData as Record<string, unknown> : null
  const rows = Array.isArray(playerData) ? playerData : data?.players
  if (!Array.isArray(rows) || !rows.length) return null
  const ids = rows.map((row) => {
    const id = typeof row === 'string' || typeof row === 'number' ? row
      : row && typeof row === 'object' && !Array.isArray(row)
        ? (row as Record<string, unknown>).id ?? (row as Record<string, unknown>).player_id : null
    return typeof id === 'string' || typeof id === 'number' ? String(id).trim() : ''
  })
  return ids.some((id) => !id) ? null : [...new Set(ids)]
}

/** Reads only selected teams' canonical rosters. Owner ids and names never select an imported roster. */
export async function loadNbaLineupImpact(args: {
  league: TradeLeagueContext
  senderTeamId: string | undefined
  receiverTeamId: string | undefined
  senderGives: NbaPricedPlayer[]
  receiverGives: NbaPricedPlayer[]
}): Promise<NbaLineupImpact> {
  const { league } = args
  const matches = [args.senderTeamId, args.receiverTeamId].map((id) =>
    league.teams.filter((team) => id && (team.id === id || team.externalId === id)))
  if (matches.some((rows) => rows.length !== 1) || matches[0][0].id === matches[1][0].id) {
    return { status: 'unavailable', reason: 'Select two distinct stored league teams to verify roster impact.' }
  }
  const teams = matches.map((rows) => rows[0])
  if (!Object.keys(league.starterSlots).length) {
    return { status: 'unavailable', reason: 'Saved NBA starter slots are unavailable.' }
  }
  const imported = !['af', 'allfantasy', 'native'].includes(league.platform.toLowerCase())
  const rosters = await prisma.roster.findMany({
    where: { leagueId: league.leagueId },
    select: { id: true, playerData: true, redraftRosterId: true },
  })
  const selected = teams.map((team) => rosters.filter((roster) => imported
    ? rosterSourceTeamId(roster.playerData) === team!.externalId
    : roster.id === team!.externalId))
  if (selected.some((matches) => matches.length !== 1)) {
    return { status: 'unavailable', reason: 'A selected team has no unique stored roster.' }
  }
  const rosterRows = await Promise.all(selected.map(async ([roster]) => {
    if (roster.redraftRosterId) {
      const rows = await prisma.redraftRosterPlayer.findMany({
        where: { rosterId: roster.redraftRosterId, droppedAt: null, sport: 'NBA' },
        select: { playerId: true },
      })
      return rows.map((row) => row.playerId)
    }
    return rawPlayerIds(roster.playerData)
  }))
  if (rosterRows.some((rows) => !rows?.length || rows.length > 60)) {
    return { status: 'unavailable', reason: 'A selected roster has incomplete or oversized player data.' }
  }
  const ids = [...new Set(rosterRows.flatMap((rows) => rows ?? []))]
  const identities = await prisma.playerIdentityMap.findMany({
    where: { sport: 'NBA', OR: [
      { id: { in: ids } }, { sleeperId: { in: ids } }, { rollingInsightsId: { in: ids } },
      { espnId: { in: ids } }, { fantraxId: { in: ids } },
    ] },
    select: { id: true, canonicalName: true, position: true, sleeperId: true, rollingInsightsId: true, espnId: true, fantraxId: true },
  })
  const byRawId = new Map<string, typeof identities>()
  for (const identity of identities) {
    for (const id of [identity.id, identity.sleeperId, identity.rollingInsightsId, identity.espnId, identity.fantraxId]) {
      if (id && ids.includes(id)) byRawId.set(id, [...(byRawId.get(id) ?? []), identity])
    }
  }
  if (ids.some((id) => byRawId.get(id)?.length !== 1)) {
    return { status: 'unavailable', reason: 'A roster player has no unique NBA identity.' }
  }
  const uniqueIdentities = [...new Map(identities.map((identity) => [identity.id, identity])).values()]
  const priced = await Promise.all(uniqueIdentities.map(async (identity) => {
    try {
      return priceNbaHistory(identity.canonicalName,
        await readNbaPlayerHistory({ name: identity.canonicalName, playerId: identity.id }), league.scoringRules)
    } catch { return null }
  }))
  const byCanonicalId = new Map(priced.filter((row): row is NbaPricedPlayer => row !== null).map((row) => [row.playerId, row]))
  if (uniqueIdentities.some((identity) => !identity.position || !byCanonicalId.has(identity.id))) {
    return { status: 'unavailable', reason: 'A roster player lacks a position or scored NBA history.' }
  }
  const toPlayer = (identity: typeof identities[number]): LineupPlayer => ({
    playerId: identity.id, name: identity.canonicalName, position: identity.position!,
    pointsPerGame: byCanonicalId.get(identity.id)!.pointsPerGame,
  })
  const lineup = rosterRows.map((rows) => rows!.map((id) => toPlayer(byRawId.get(id)![0])))
  if (lineup.some((players) => new Set(players.map((player) => player.playerId)).size !== players.length)) {
    return { status: 'unavailable', reason: 'A roster contains duplicate NBA player identities.' }
  }
  const traded = [...args.senderGives, ...args.receiverGives]
  const tradedIdentity = new Map(uniqueIdentities.map((identity) => [identity.id, identity]))
  const absent = traded.filter((player) => !tradedIdentity.has(player.playerId))
  if (absent.length) {
    const extra = await prisma.playerIdentityMap.findMany({
      where: { sport: 'NBA', id: { in: absent.map((player) => player.playerId) } },
      select: { id: true, canonicalName: true, position: true, sleeperId: true, rollingInsightsId: true, espnId: true, fantraxId: true },
    })
    for (const identity of extra) tradedIdentity.set(identity.id, identity)
  }
  if (traded.some((player) => !tradedIdentity.get(player.playerId)?.position)) {
    return { status: 'unavailable', reason: 'A traded player lacks a verified NBA position.' }
  }
  const outgoing = [args.senderGives, args.receiverGives]
  const incoming = [args.receiverGives, args.senderGives]
  const impacts: TeamImpact[] = []
  for (let side = 0; side < 2; side++) {
    const owned = new Set(lineup[side].map((player) => player.playerId))
    if (outgoing[side].some((player) => !owned.has(player.playerId)) ||
        incoming[side].some((player) => owned.has(player.playerId))) {
      return { status: 'unavailable', reason: 'Trade assets do not match the selected teams’ stored rosters.' }
    }
    const before = bestNbaLineup(lineup[side], league.starterSlots)
    const removed = new Set(outgoing[side].map((player) => player.playerId))
    const afterPlayers = lineup[side].filter((player) => !removed.has(player.playerId))
    afterPlayers.push(...incoming[side].map((player) => ({
      playerId: player.playerId, name: player.name,
      position: tradedIdentity.get(player.playerId)!.position!, pointsPerGame: player.pointsPerGame,
    })))
    const after = bestNbaLineup(afterPlayers, league.starterSlots)
    if (before === null || after === null) {
      return { status: 'unavailable', reason: 'The saved NBA starter slots cannot be optimized.' }
    }
    impacts.push({ teamId: teams[side]!.id, before, after, delta: round(after - before) })
  }
  return { status: 'verified', sender: impacts[0], receiver: impacts[1] }
}
