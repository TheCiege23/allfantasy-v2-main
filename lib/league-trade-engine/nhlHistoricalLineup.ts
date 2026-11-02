import 'server-only'
import { prisma } from '@/lib/prisma'
import { buildTradeLeagueContext } from '@/lib/trades/loadTradeLeagueContext'
import { bestHockeyLineupAssignment, validHockeyPosition } from '@/lib/trades/hockeyLineupImpact'
import { NHL_GOALIE_STAT_KEYS, NHL_SKATER_STAT_KEYS } from '@/lib/nhl-scoring/NhlScoringPresets'
import { normalizeGameStatus } from '@/lib/sports/gameStatus'
import type { TradeAssetInput } from './types'

export type NhlHistoricalLineupCoverage = {
  rosterId: string; rosterPlayers: number; linkedPlayers: number; scoredPlayers: number
  missingIdentity: number; missingPosition: number; missingScoredHistory: number
  status: 'verified' | 'blocked'; reason: string | null
  before: number | null; after: number | null; delta: number | null
}
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const playerIds = (value: unknown): string[] => Array.isArray(object(value).players)
  ? (object(value).players as unknown[]).filter((id): id is string => typeof id === 'string' && !!id) : []

/** Missing weighted fields are unknown. Only observed stats and same-game sums can score. */
export function scoreNhlHistoricalBox(value: unknown, rules: Record<string, number>, goalie: boolean): number | null {
  const outer = object(value), stats = { ...object(outer.stats) }
  const number = (name: string): number | null => {
    const value = stats[name]
    if (typeof value === 'boolean') return Number(value)
    if (typeof value === 'number' && Number.isFinite(value)) return value
    return typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null
  }
  for (const [target, source] of Object.entries({ goalie_wins: 'win', goals_against: 'goals_allowed',
    blocked_shots: 'blocks', faceoff_wins: 'faceoffs_won', faceoff_losses: 'faceoffs_lost' })) {
    if (stats[target] == null && number(source) !== null) stats[target] = number(source)
  }
  for (const [target, goals, assists] of [
    ['power_play_points', 'power_play_goals', 'power_play_assists'],
    ['short_handed_points', 'short_handed_goals', 'short_handed_assists'],
  ]) if (stats[target] == null && number(goals!) !== null && number(assists!) !== null)
    stats[target!] = number(goals!)! + number(assists!)!
  if (stats.hat_trick_bonus == null && number('goals') !== null)
    stats.hat_trick_bonus = number('goals')! >= 3 ? 1 : 0
  const irrelevant = new Set<string>(goalie ? NHL_SKATER_STAT_KEYS : NHL_GOALIE_STAT_KEYS)
  let total = 0, active = 0
  for (const [name, weight] of Object.entries(rules)) {
    if (irrelevant.has(name) || weight === 0) continue
    const amount = number(name)
    if (!Number.isFinite(weight) || amount === null) return null
    total += amount * weight
    active++
  }
  return active ? Math.round(total * 100) / 100 : null
}

/** NHL actuals only: these samples never become market values, forecasts or playoff evidence. */
export async function loadNhlHistoricalLineups(input: { leagueId: string;
  participantRosterIds: string[]; assets: TradeAssetInput[]; capturedAt: string }):
  Promise<NhlHistoricalLineupCoverage[] | null> {
  const league = await prisma.league.findUnique({ where: { id: input.leagueId } })
  if (!league || league.sport !== 'NHL') return null
  const context = buildTradeLeagueContext(league, [], '')
  const participants = [...new Set(input.participantRosterIds)]
  const rosters = await prisma.roster.findMany({ where: { leagueId: league.id, id: { in: participants } },
    select: { id: true, playerData: true } })
  const rosterById = new Map(rosters.map((row) => [row.id, playerIds(row.playerData)]))
  const initial: NhlHistoricalLineupCoverage[] = participants.map((rosterId) => ({ rosterId,
    rosterPlayers: rosterById.get(rosterId)?.length ?? 0, linkedPlayers: 0, scoredPlayers: 0,
    missingIdentity: 0, missingPosition: 0, missingScoredHistory: 0, status: 'blocked',
    reason: null, before: null, after: null, delta: null }))
  const blocked = (reason: string) => initial.map((row) => ({ ...row, reason }))
  const capturedAt = new Date(input.capturedAt)
  if (!Number.isFinite(capturedAt.getTime()) || participants.length < 2 || participants.length > 128 ||
    participants.length !== input.participantRosterIds.length || rosters.length !== participants.length)
    return blocked('Trade participants or captured timestamp are invalid.')
  if (context.scoringMode !== 'points' || !Object.values(context.scoringRules).some((weight) => weight !== 0) ||
    context.scoringRuleDetails.some((rule) => rule.positions.length) || !Object.keys(context.starterSlots).length)
    return blocked('Supported saved NHL points rules and starter slots are required.')
  if (rosters.some((row) => !rosterById.get(row.id)?.length || rosterById.get(row.id)!.length > 250))
    return blocked('Stored roster is empty or exceeds 250 players.')
  if (input.assets.some((asset) => !participants.includes(asset.fromRosterId) ||
    !participants.includes(asset.toRosterId) || asset.fromRosterId === asset.toRosterId))
    return blocked('Trade movements must stay within distinct participating rosters.')
  const rawIds = [...new Set([...rosterById.values()].flat())]
  // Provider namespaces stay separate: an ESPN number is never matched to an RI number.
  const identities: Array<{ id: string; position: string | null; fantraxId: string | null;
    espnId: string | null; sleeperId: string | null }> = []
  for (let start = 0; start < rawIds.length; start += 250) {
    const batch = rawIds.slice(start, start + 250)
    const provider = league.platform === 'fantrax' ? { fantraxId: { in: batch } }
      : league.platform === 'espn' ? { espnId: { in: batch } }
        : league.platform === 'sleeper' ? { sleeperId: { in: batch } } : null
    identities.push(...await prisma.playerIdentityMap.findMany({ where: { sport: 'NHL',
      OR: [{ id: { in: batch } }, ...(provider ? [provider] : [])] },
    select: { id: true, position: true, fantraxId: true, espnId: true, sleeperId: true } }))
  }
  const byRaw = new Map<string, typeof identities>()
  for (const identity of new Map(identities.map((row) => [row.id, row])).values()) {
    const providerId = league.platform === 'fantrax' ? identity.fantraxId
      : league.platform === 'espn' ? identity.espnId : league.platform === 'sleeper' ? identity.sleeperId : null
    for (const id of new Set([identity.id, providerId])) if (id && rawIds.includes(id))
      byRaw.set(id, [...(byRaw.get(id) ?? []), identity])
  }
  const owned = new Map<string, typeof identities>()
  const transferred = new Set<string>()
  for (const asset of input.assets.filter((asset) => asset.itemType === 'player')) {
    const matches = byRaw.get(asset.itemReference ?? '')
    if (matches?.length !== 1 || transferred.has(matches[0]!.id))
      return blocked('A transferred player is missing, ambiguous or repeated.')
    transferred.add(matches[0]!.id)
  }
  const owners = new Map<string, Set<string>>()
  for (const row of initial) {
    const linked = [] as typeof identities
    for (const raw of rosterById.get(row.rosterId)!) {
      const matches = byRaw.get(raw) ?? []
      if (matches.length !== 1 || linked.some((item) => item.id === matches[0]!.id)) { row.missingIdentity++; continue }
      const identity = matches[0]!
      linked.push(identity)
      if (!validHockeyPosition(identity.position)) row.missingPosition++
      const set = owners.get(identity.id) ?? new Set<string>()
      set.add(row.rosterId); owners.set(identity.id, set)
    }
    owned.set(row.rosterId, linked); row.linkedPlayers = linked.length
  }
  const ids = [...owners.keys()], games = [] as Array<{ playerId: string; gameId: string;
    providerGameId: string | null; season: number; normalizedStatMap: unknown }>
  // Bounded queries; no provider request is reachable from a trade evaluation.
  for (let start = 0; start < ids.length; start += 100) games.push(...await prisma.playerGameStat.findMany({
    where: { sportType: 'NHL', playerId: { in: ids.slice(start, start + 100) },
      source: 'rolling_insights_live', season: { gte: league.season - 2, lte: league.season }, gameDate: { lte: capturedAt },
      fetchedAt: { lte: capturedAt }, updatedAt: { lte: capturedAt } },
    select: { playerId: true, gameId: true, providerGameId: true, season: true, normalizedStatMap: true },
  }))
  const gameIds = [...new Set(games.flatMap((game) => game.providerGameId ? [game.providerGameId] : []))]
  const finalGames = new Set<string>()
  for (let start = 0; start < gameIds.length; start += 250) {
    const rows = await prisma.sportsGame.findMany({ where: { sport: 'NHL', source: 'rolling_insights',
      externalId: { in: gameIds.slice(start, start + 250) } }, select: { externalId: true, status: true } })
    for (const row of rows) if (normalizeGameStatus(row.status) === 'final') finalGames.add(row.externalId)
  }
  const byId = new Map(identities.map((row) => [row.id, row]))
  const totals = new Map<string, Map<number, { total: number; count: number }>>()
  const seen = new Set<string>()
  for (const game of games) {
    const identity = byId.get(game.playerId), key = `${game.playerId}:${game.gameId}`
    if (!identity || seen.has(key) || !game.providerGameId || !finalGames.has(game.providerGameId) ||
      object(game.normalizedStatMap).seasonType !== 'regular') continue
    seen.add(key)
    const points = scoreNhlHistoricalBox(game.normalizedStatMap, context.scoringRules, identity.position?.trim().toUpperCase() === 'G')
    if (points === null) continue
    const seasons = totals.get(identity.id) ?? new Map<number, { total: number; count: number }>()
    const season = seasons.get(game.season) ?? { total: 0, count: 0 }
    season.total += points; season.count++; seasons.set(game.season, season); totals.set(identity.id, seasons)
  }
  const priced = new Map<string, number>()
  for (const [id, seasons] of totals) {
    const chosen = [...seasons].filter(([year, row]) => row.count >= (year === league.season ? 5 : 10))
      .sort(([a], [b]) => b - a)[0]
    if (chosen) priced.set(id, Math.round(chosen[1].total * 100 / chosen[1].count) / 100)
  }
  return initial.map((row) => {
    const players = owned.get(row.rosterId)!
    row.scoredPlayers = players.filter((player) => priced.has(player.id)).length
    row.missingScoredHistory = players.length - row.scoredPlayers
    row.reason = row.missingIdentity ? 'One or more roster identities are missing or ambiguous.'
      : row.missingPosition ? 'One or more NHL positions are unsupported.'
        : players.some((player) => owners.get(player.id)!.size > 1) ? 'A player is owned by multiple participating rosters.'
          : row.missingScoredHistory ? 'One or more players lack sufficient complete scored game history.' : null
    if (row.reason) return row
    const after = new Map(players.map((player) => [player.id, player]))
    for (const asset of input.assets.filter((asset) => asset.itemType === 'player')) {
      const identity = byRaw.get(asset.itemReference ?? '')
      if (identity?.length !== 1 || !owned.get(asset.fromRosterId)!.some((player) => player.id === identity[0]!.id))
        return { ...row, reason: 'Trade movement does not match a uniquely owned player.' }
      if (asset.fromRosterId === row.rosterId && !after.delete(identity[0]!.id))
        return { ...row, reason: 'A player is transferred more than once.' }
      if (asset.toRosterId === row.rosterId) {
        if (after.has(identity[0]!.id) || !priced.has(identity[0]!.id) || !validHockeyPosition(identity[0]!.position))
          return { ...row, reason: 'Incoming player lacks unique complete lineup evidence.' }
        after.set(identity[0]!.id, identity[0]!)
      }
    }
    const lineup = (rows: typeof identities) => bestHockeyLineupAssignment(rows.map((player) =>
      ({ playerId: player.id, position: player.position!, pointsPerGame: priced.get(player.id)! })), context.starterSlots)
    const before = lineup(players), next = lineup([...after.values()])
    if (!before || !next || before.filledSlots !== before.slotCount || next.filledSlots !== next.slotCount)
      return { ...row, reason: 'Saved starter slots cannot all be filled before and after the trade.' }
    return { ...row, status: 'verified' as const, before: before.points, after: next.points,
      delta: Math.round((next.points - before.points) * 100) / 100 }
  })
}
