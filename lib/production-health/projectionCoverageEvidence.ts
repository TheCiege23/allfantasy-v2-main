import 'server-only'

import type { LeagueSport } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { extractSeasonAggregate } from '@/lib/af-projections/core'
import type { LeagueIdColumn } from '@/lib/waivers/seasonRatePool'
import { normalizeSoccerGameStats } from '@/lib/scoring-runtime/soccerStatNormalization'
import { hasCollegeBoxParticipation } from '@/lib/workers/providers/collegeFinalBoxes'

type Identity = 'linked' | 'ambiguous' | 'missing' | 'unsupported'
export type ProjectionEvidence = { name: string | null; identity: Identity; games: number; hasSnapshot: boolean }

const SEASON_SOURCES = ['rolling_insights', 'cfbd', 'af_verified_college_boxes']
const FINAL_STATUSES = ['final', 'completed', 'ft', 'finished', 'closed', 'aet', 'pen']

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export async function loadProjectionEvidence(args: {
  sport: LeagueSport
  season: number
  namespace: LeagueIdColumn | null
  ids: string[]
  knownKeys: ReadonlyMap<string, string>
  now: Date
}): Promise<Map<string, ProjectionEvidence>> {
  const { sport, season, namespace, ids, knownKeys, now } = args
  const identities = namespace ? await prisma.playerIdentityMap.findMany({
    where: { sport, [namespace]: { in: ids } },
    select: { id: true, cfbdId: true, sleeperId: true, canonicalName: true, rollingInsightsId: true, espnId: true,
      fantraxId: true, mflId: true, fleaflickerId: true, sleeperNbaId: true },
  }) : []
  const byRoster = new Map<string, typeof identities>()
  for (const row of identities) {
    const key = namespace ? row[namespace] : null
    if (typeof key === 'string') byRoster.set(key, [...(byRoster.get(key) ?? []), row])
  }
  const resolveProjectionKeys = (id: string) => {
    const keys = byRoster.get(id)?.map(row => sport === 'NCAAF' ? row.cfbdId ?? row.id : row.id) ?? []
    return [...new Set(keys)]
  }
  const missing = ids.filter(id => !knownKeys.has(id) && resolveProjectionKeys(id).length === 1)
  const keys = [...new Set(missing.flatMap(id => [
    ...resolveProjectionKeys(id),
    ...(sport === 'NFL' ? byRoster.get(id)?.flatMap(row => row.sleeperId ? [row.sleeperId] : []) ?? [] : []),
  ]))]
  const [lines, snapshots] = keys.length ? await Promise.all([
    prisma.fantasyStatLine.findMany({
      where: { sport, season: String(season), week: 0, source: { in: SEASON_SOURCES }, playerId: { in: keys } },
      select: { playerId: true, stats: true },
    }),
    prisma.aFProjectionSnapshot.findMany({
      where: { sport, season, week: null, eventId: null, playerId: { in: keys } },
      select: { playerId: true },
    }),
  ]) : [[], []]
  const games = new Map<string, number>()
  const projected = new Set(snapshots.map(row => row.playerId))
  for (const { playerId, stats } of lines) {
    const aggregate = extractSeasonAggregate(stats)
    if (!aggregate || !Object.keys(aggregate.components).some(key => key !== 'games_played')) continue
    games.set(playerId, Math.max(games.get(playerId) ?? 0, aggregate.gamesPlayed))
  }

  // Soccer and college basketball can build rates directly from boxes without a season stat line.
  const boxIds = keys.filter(id => (games.get(id) ?? 0) < 2)
  if (boxIds.length && (sport === 'SOCCER' || sport === 'NCAAB' || sport === 'NCAAF')) {
    const boxes = await prisma.playerGameStat.findMany({
      where: { sportType: sport, season, gameDate: { lte: now }, playerId: { in: boxIds }, source: 'rolling_insights_live' },
      select: { playerId: true, gameId: true, providerGameId: true, normalizedStatMap: true },
    })
    const gameIds = [...new Set(boxes.map(row => row.providerGameId ?? row.gameId))]
    const finals = gameIds.length ? await prisma.sportsGame.findMany({
      where: { sport, season, source: 'rolling_insights', externalId: { in: gameIds },
        status: { in: FINAL_STATUSES, mode: 'insensitive' }, startTime: { lte: now } },
      select: { externalId: true },
    }) : []
    const finishedIds = new Set(finals.map(row => row.externalId))
    const byPlayer = new Map<string, Set<string>>()
    for (const row of boxes) {
      const box = object(row.normalizedStatMap)
      const gameId = row.providerGameId ?? row.gameId
      if (box.gameFinal !== true && (box.gameFinal === false || !finishedIds.has(gameId))) continue
      if (sport !== 'SOCCER' && box.seasonType !== 'regular') continue
      const appeared = sport === 'SOCCER' ? normalizeSoccerGameStats(box).stats.appearance === 1
        : hasCollegeBoxParticipation(sport, object(box.stats) as Record<string, number>)
      if (!appeared) continue
      const ids = byPlayer.get(row.playerId) ?? new Set()
      ids.add(gameId)
      byPlayer.set(row.playerId, ids)
    }
    for (const [id, ids] of byPlayer) games.set(id, Math.max(games.get(id) ?? 0, ids.size))
  }

  return new Map(ids.map(id => {
    const linked = byRoster.get(id) ?? []
    const keys = resolveProjectionKeys(id)
    if (sport === 'NFL' && keys.length === 1) keys.push(...linked.flatMap(row => row.sleeperId ? [row.sleeperId] : []))
    const identity: Identity = knownKeys.has(id) ? 'linked'
      : !namespace ? 'unsupported' : keys.length === 0 ? 'missing'
        : resolveProjectionKeys(id).length === 1 ? 'linked' : 'ambiguous'
    return [id, {
      identity, name: new Set(linked.map(row => row.canonicalName)).size === 1 ? linked[0]?.canonicalName ?? null : null,
      games: identity === 'linked' ? Math.max(0, ...keys.map(key => games.get(key) ?? 0)) : 0,
      hasSnapshot: identity === 'linked' && keys.some(key => projected.has(key)),
    }]
  }))
}
