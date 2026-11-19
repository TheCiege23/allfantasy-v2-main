import 'server-only'

import { prisma } from '@/lib/prisma'
import { leagueIdColumn, resolveRosterIdsToKeys, type LeagueIdColumn } from '@/lib/waivers/seasonRatePool'
import { attributeTrade, computeCompletedTradeValue, tierBaselines, type CompletedTradeGather } from './completedTradeObservations'
import { seasonLeagueRow } from './formatMarkets'
import { isCentred } from './sinceSeasonArg'

export type SportDeal = { key: string; given: string[]; received: string[] }
type RawDeal = SportDeal & { column: LeagueIdColumn }
export type SportMarketAdjustment = { percent: number; trades: number }

/** Price each complete package on one sport, season and league format's AF chart. */
export function sportMarketAdjustments(deals: readonly SportDeal[], chart: ReadonlyMap<string, number>) {
  const byPlayer: CompletedTradeGather['byPlayer'] = new Map()
  const seen = new Set<string>()
  for (const deal of deals) {
    if (seen.has(deal.key) || !deal.given.length || !deal.received.length) continue
    const ids = [...deal.given, ...deal.received]
    if (new Set(ids).size !== ids.length || ids.some((id) => !(Number(chart.get(id)) > 0))) continue
    seen.add(deal.key)
    const result = attributeTrade({
      playersGiven: deal.given, playersReceived: deal.received, picksGiven: [], picksReceived: [],
    }, chart, { allowPicks: false })
    if (result.kind !== 'ok') continue
    for (const record of result.records) {
      const entry = byPlayer.get(record.id) ?? { name: null, position: null, baseValue: record.own, observations: [] }
      entry.observations.push({ playerId: record.id, transactionId: deal.key, observedValue: record.observedValue, season: 0, tradeDate: null })
      byPlayer.set(record.id, entry)
    }
  }
  const baseline = tierBaselines({ byPlayer, skipped: {}, tradesConsidered: deals.length, tradesUsed: seen.size })
  const out = new Map<string, SportMarketAdjustment>()
  for (const [playerId, row] of byPlayer) {
    const value = computeCompletedTradeValue({ playerId, playerName: null, ...row, tierBaselineRatio: baseline(row.baseValue) })
    if (value.published) out.set(playerId, { percent: value.adjustmentPercent, trades: value.sampleSize })
  }
  const sorted = [...out.values()].map((v) => v.percent).sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 1 ? sorted[mid] : sorted.length ? (sorted[mid - 1]! + sorted[mid]!) / 2 : null
  return isCentred(median) ? out : new Map<string, SportMarketAdjustment>()
}

function ids(raw: unknown): string[] | null {
  return Array.isArray(raw) && raw.every((id) => typeof id === 'string' && id.trim()) ? raw : null
}

function packageKey(given: string[], received: string[]): string {
  return JSON.stringify([JSON.stringify([...given].sort()), JSON.stringify([...received].sort())].sort())
}

async function readDeals(sport: string, season: number, leagueType: string): Promise<SportDeal[]> {
  const leagues = await prisma.league.findMany({
    where: { sport: sport as import('@prisma/client').LeagueSport, season },
    select: { id: true, platformLeagueId: true, platform: true, leagueType: true },
  })
  const actualLeagues = leagues.filter((l) => !l.platform?.includes('test'))
  const current = actualLeagues.filter((l) => l.leagueType?.toLowerCase() === leagueType)
  const bySource = new Set(current.map((l) => JSON.stringify([l.platform?.toLowerCase(), l.platformLeagueId])))
  const leagueIds = current.map((l) => l.id)
  const sleeperIds = actualLeagues.filter((l) => l.platform === 'sleeper').map((l) => l.id)
  if (!leagueIds.length && !sleeperIds.length) return []
  // Generic trades lack a season FK. Bound them by the start-year convention
  // instead of letting an old trade follow a renewed league into another year.
  const month = sport === 'MLB' ? 0 : 6
  const start = new Date(Date.UTC(season, month, 1))
  const end = new Date(Date.UTC(season + 1, month, 1))
  const [imports, generic, redraft, facts, history] = await Promise.all([
    prisma.leagueTrade.findMany({
      where: { sport: sport.toLowerCase(), season, history: { sleeperLeagueId: { in: current.flatMap((l) => l.platformLeagueId ?? []) } } },
      select: { transactionId: true, platform: true, history: { select: { sleeperLeagueId: true } }, playersGiven: true, playersReceived: true,
        picksGiven: true, picksReceived: true, budgetGiven: true, budgetReceived: true },
    }),
    prisma.afLeagueTrade.findMany({
      where: { leagueId: { in: leagueIds }, status: 'processed', processedAt: { gte: start, lt: end } },
      select: { id: true, proposerRosterId: true, receiverRosterId: true, league: { select: { platform: true } },
        items: { select: { itemType: true, itemReference: true, fromRosterId: true, toRosterId: true } } },
    }),
    prisma.redraftTradeProposal.findMany({
      where: { leagueId: { in: leagueIds }, season: { season }, status: { in: ['accepted', 'processed'] }, processedAt: { not: null }, additionalRosterIds: { isEmpty: true },
        executionSnapshot: { is: { reversal: null } } },
      select: { id: true, proposerRosterId: true, receiverRosterId: true, league: { select: { platform: true } },
        assets: { select: { assetType: true, playerId: true, fromRosterId: true, toRosterId: true } } },
    }),
    prisma.transactionFact.findMany({ where: { sport, season: { gte: season - 2, lte: season }, type: 'trade', leagueId: { in: sleeperIds }, OR: ['sleeper_transactions', 'sleeper_historical_transaction_sync'].map((source) => ({ payload: { path: ['source'], equals: source } })) },
      select: { leagueId: true, season: true, payload: true } }),
    prisma.leagueDynastySeason.findMany({ where: { leagueId: { in: sleeperIds }, provider: 'sleeper', season: { gte: season - 2, lt: season } },
      select: { leagueId: true, season: true, platformLeagueId: true, metadata: true } }),
  ])
  const native = [...generic, ...redraft.map((r) => ({ ...r, items: r.assets.map((a) => ({
    itemType: a.assetType, itemReference: a.playerId, fromRosterId: a.fromRosterId, toRosterId: a.toRosterId,
  })) }))]
  const archive = new Map(history.map((h) => [h.leagueId + ':' + h.season, h]))
  const sources = new Map(leagues.map((l) => [l.id, l]))
  const proven = new Map<string, boolean>()
  const factDeals = new Map<string, RawDeal>()
  for (const fact of facts) {
    const f = fact.payload
    if (!f || typeof f !== 'object' || Array.isArray(f) || !Array.isArray(f.rosterIds) || typeof f.sleeperTransactionId !== 'string') continue
    const source = sources.get(fact.leagueId)
    if (source?.platform !== 'sleeper' || (fact.season === season && source.leagueType?.toLowerCase() !== leagueType)) continue
    const past = archive.get(fact.leagueId + ':' + fact.season)
    if (fact.season !== season && (!past || seasonLeagueRow({
      id: fact.leagueId, platformLeagueId: past.platformLeagueId, leagueType: null, settings: null,
    }, past.platformLeagueId, past.metadata)?.leagueType !== leagueType)) continue
    const key = JSON.stringify(['sleeper', past?.platformLeagueId ?? source.platformLeagueId, f.sleeperTransactionId])
    const isHistory = f.source === 'sleeper_historical_transaction_sync'
    if (isHistory ? f.status !== 'complete' || !('faabNet' in f) || !Array.isArray(f.draftPicks) : f.faabIn == null || f.faabOut == null) continue
    const clean = isHistory ? f.faabNet == null || f.faabNet === 0 : f.faabIn === 0 && f.faabOut === 0
    const playersOnly = isHistory ? (f.draftPicks as unknown[]).length === 0 : f.picks === 0
    const given = ids(isHistory ? f.drops : f.playersOutIds), received = ids(isHistory ? f.adds : f.playersInIds)
    const column = leagueIdColumn(source.platform, sport)
    if (column && given?.length && received?.length && playersOnly && (isHistory || (f.playersIn === received.length && f.playersOut === given.length))) {
      const previous = factDeals.get(key)
      if (previous && packageKey(previous.given, previous.received) !== packageKey(given, received)) proven.set(key, false)
      factDeals.set(key, { key, column, given, received })
    }
    proven.set(key, proven.get(key) !== false && f.rosterIds.length === 2 && clean && playersOnly)
  }
  const groups = new Map<string, typeof imports>()
  for (const t of imports) {
    if (!bySource.has(JSON.stringify([t.platform, t.history.sleeperLeagueId]))) continue
    if (t.platform === 'fantrax' && !t.transactionId.startsWith('fantrax-csv:')) continue
    const key = JSON.stringify([t.platform, t.history.sleeperLeagueId, t.transactionId])
    const group = groups.get(key) ?? []
    group.push(t)
    groups.set(key, group)
  }
  const raw: RawDeal[] = [...factDeals.values()].filter((t) => proven.get(t.key) === true)
  for (const [key, group] of groups) {
    const t = group[0]!
    const column = leagueIdColumn(t.platform, sport)
    const given = ids(t.playersGiven), received = ids(t.playersReceived)
    if (!column || !given?.length || !received?.length) continue
    if (group.some((row) => ids(row.picksGiven)?.length !== 0 || ids(row.picksReceived)?.length !== 0 ||
      (row.budgetGiven ?? 0) !== 0 || (row.budgetReceived ?? 0) !== 0)) continue
    if (group.some(row => row.budgetGiven == null || row.budgetReceived == null) && proven.get(key) !== true) continue
    const same = (a: string[], b: unknown) => JSON.stringify([...a].sort()) === JSON.stringify(ids(b)?.sort())
    if (!group.every((r) => (same(given, r.playersGiven) && same(received, r.playersReceived)) ||
      (same(given, r.playersReceived) && same(received, r.playersGiven)))) continue
    if (proven.get(key) === false) continue
    if (!group.some((r) => same(given, r.playersReceived) && same(received, r.playersGiven)) && !proven.has(key)) continue
    raw.push({ key, column, given, received })
  }
  for (const t of native) {
    const column = leagueIdColumn(t.league.platform, sport)
    if (!column || t.items.some((i) => i.itemType !== 'player' || !i.itemReference ||
      !((i.fromRosterId === t.proposerRosterId && i.toRosterId === t.receiverRosterId) ||
        (i.fromRosterId === t.receiverRosterId && i.toRosterId === t.proposerRosterId)))) continue
    raw.push({ key: 'af:' + t.id, column,
      given: t.items.filter((i) => i.fromRosterId === t.proposerRosterId).map((i) => i.itemReference!),
      received: t.items.filter((i) => i.fromRosterId === t.receiverRosterId).map((i) => i.itemReference!) })
  }
  const deals: SportDeal[] = []
  for (const column of new Set(raw.map((r) => r.column))) {
    const subset = raw.filter((r) => r.column === column)
    const links = await resolveRosterIdsToKeys(prisma, sport, column, subset.flatMap((r) => [...r.given, ...r.received]))
    for (const row of subset) {
      if ([...row.given, ...row.received].every((id) => links.has(id))) deals.push({
        key: row.key, given: row.given.map((id) => links.get(id)!), received: row.received.map((id) => links.get(id)!),
      })
    }
  }
  const unique = new Map<string, SportDeal>()
  const conflicts = new Set<string>()
  for (const deal of deals) {
    const previous = unique.get(deal.key)
    if (previous && packageKey(previous.given, previous.received) !== packageKey(deal.given, deal.received)) conflicts.add(deal.key)
    unique.set(deal.key, deal)
  }
  for (const key of conflicts) unique.delete(key)
  return [...unique.values()]
}

// Cache the common evidence, never a league's scored chart or a failed database read.
const cache = new Map<string, { until: number; load: Promise<SportDeal[]> }>()
export function loadCompletedSportDeals(sport: string, season: number, format: string | null) {
  if (!format) return Promise.resolve([])
  const key = JSON.stringify([sport, season, format.toLowerCase()])
  const now = Date.now()
  for (const [k, entry] of cache) if (entry.until <= now) cache.delete(k)
  const existing = cache.get(key)
  if (existing) return existing.load
  const load = readDeals(sport, season, format).catch((error) => {
    if (cache.get(key)?.load === load) cache.delete(key)
    throw error
  })
  cache.set(key, { until: now + 300_000, load })
  return load
}
