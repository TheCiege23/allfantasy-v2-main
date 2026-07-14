import 'server-only'

import type { LeagueToolAccessErrorCode } from '@/lib/ai-tools/league-tool-context-types'
import { leagueToolAccessUserMessage } from '@/lib/ai-tools/league-tool-access-messages'
import { assertLeagueMemberWithCode } from '@/lib/league/league-access'
import { prisma } from '@/lib/prisma'
import {
  getTrendingPlayers as fcSortByTrend,
  getCanonicalValuationSnapshot,
  type FantasyCalcPlayer,
  type FantasyCalcSettings,
} from '@/lib/player-valuations/canonicalPlayerValuations'
import { getPlayer } from '@/lib/data/players'
import { openaiChatText } from '@/lib/openai-client'
import { attachIntelligenceToChimmyPayload, buildAiToolPayload } from '@/lib/intelligence'
import { enrichChimmyWithPlayerSportsNorm } from '@/lib/sports-data-normalization'
import { resolveNormalizedLeagueContext } from '@/lib/league-context-engine'
import type { NormalizedLeagueContext } from '@/lib/league-context-engine/types'
import { normalizeToSupportedSport, SUPPORTED_SPORTS, type SupportedSport } from '@/lib/sport-scope'
import { loadLeagueForTrade, type LoadedTradeLeague } from '@/lib/trade-value-console/league-loader'
import { fantasyCalcSettingsFromLeague } from './fantasy-calc-settings'
import { matchesPositionFilter } from './position-filters'
import { chipsFromFantasyCalc, chipsFromMetaRates } from './reason-chips'
import type {
  ContextModeId,
  TimeWindowId,
  TrendingDashboardOutput,
  TrendingDashboardResult,
  TrendPlayerCard,
  TrendSportFilter,
  TrendTypeId,
} from './types'
import { attachTrendCardProjectionAndLeagueContext } from '@/lib/trending-players/trendCardEnrichment'

const DEFAULT_LIMIT = 8

function parseRosterPct(raw: string | null | undefined): number | null {
  if (raw == null || raw === '') return null
  const n = Number.parseFloat(String(raw).replace(/%/g, ''))
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null
}

function windowLabel(w: TimeWindowId): string {
  const labels: Record<TimeWindowId, string> = {
    today: 'Today',
    '24h': '24 hours',
    '3d': '3 days',
    '7d': '7 days',
    '14d': '14 days',
    '30d': '30 days',
    season: 'Season',
    dynasty_long: 'Dynasty / long term',
  }
  return labels[w] ?? w
}

/** Meta timeframe: PlayerMetaTrend.updatedAt */
function sinceFromWindow(w: TimeWindowId): Date | undefined {
  const d = new Date()
  const days =
    w === 'today' || w === '24h'
      ? 1
      : w === '3d'
        ? 3
        : w === '7d'
          ? 7
          : w === '14d'
            ? 14
            : w === '30d'
              ? 30
              : w === 'season'
                ? 120
                : w === 'dynasty_long'
                  ? 365
                  : 7
  d.setUTCDate(d.getUTCDate() - days)
  return d
}

function metaOrderField(t: TrendTypeId): 'trendScore' | 'addRate' | 'dropRate' | 'tradeInterest' | 'lineupStartRate' | 'injuryImpact' {
  switch (t) {
    case 'add':
      return 'addRate'
    case 'drop':
      return 'dropRate'
    case 'trade':
      return 'tradeInterest'
    case 'start':
    case 'sit':
    case 'usage':
      return 'lineupStartRate'
    case 'injury_replacement':
      return 'injuryImpact'
    default:
      return 'trendScore'
  }
}

async function enrichHeadshot(playerId: string): Promise<{ headshotUrl: string | null; logoUrl: string | null; injury: string | null }> {
  try {
    const row = await prisma.sportsPlayerRecord.findUnique({
      where: { id: playerId },
      select: { headshotUrl: true, headshotUrlLg: true, headshotUrlSm: true, logoUrl: true, injuryStatus: true },
    })
    if (!row) return { headshotUrl: null, logoUrl: null, injury: null }
    return {
      headshotUrl: row.headshotUrl ?? row.headshotUrlLg ?? row.headshotUrlSm ?? null,
      logoUrl: row.logoUrl ?? null,
      injury: row.injuryStatus ?? null,
    }
  } catch {
    return { headshotUrl: null, logoUrl: null, injury: null }
  }
}

async function cardFromFcPlayer(
  p: FantasyCalcPlayer,
  rank: number,
  trendType: TrendTypeId,
  includeEnrichment: boolean,
): Promise<TrendPlayerCard> {
  const playerId = `NFL:${p.player.sleeperId}`
  const enrich = includeEnrichment ? await enrichHeadshot(playerId) : { headshotUrl: null, logoUrl: null, injury: null }
  const conf = Math.min(
    95,
    Math.max(
      38,
      72 -
        Math.min(40, Math.abs(p.maybeMovingStandardDeviationPerc ?? 0) * 0.25) +
        (p.displayTrend ? 5 : 0),
    ),
  )
  const rookie = (p.player.maybeYoe ?? 99) <= 0
  return {
    rank,
    playerId,
    sport: 'NFL',
    name: p.player.name,
    position: p.player.position,
    team: p.player.maybeTeam ?? '—',
    headshotUrl: enrich.headshotUrl,
    logoUrl: enrich.logoUrl,
    trendScore: Math.round(p.combinedValue),
    trendDelta: Math.round(p.trend30Day),
    confidence: Math.round(conf),
    rosteredPct: parseRosterPct(p.maybeOwner),
    snippet:
      trendType === 'trade'
        ? `Trade frequency signal ${(p.maybeTradeFrequency ?? 0).toFixed(2)} · 30d value trend ${p.trend30Day > 0 ? '+' : ''}${Math.round(p.trend30Day)}`
        : `30d value trend ${p.trend30Day > 0 ? '+' : ''}${Math.round(p.trend30Day)} · rank #${p.overallRank}`,
    chips: chipsFromFantasyCalc(p, trendType),
    sources: enrich.injury ? ['Canonical market values', 'injury_layer'] : ['Canonical market values'],
    injuryStatus: enrich.injury,
    isRookie: rookie,
    dataFreshness: 'Canonical market values · 30d trend component',
  }
}

function filterFcPool(players: FantasyCalcPlayer[], position: string, rookiesOnly: boolean): FantasyCalcPlayer[] {
  let out = players
  if (position && position !== 'ALL') {
    out = out.filter((p) => matchesPositionFilter(p.player.position, position, 'NFL'))
  }
  if (rookiesOnly) {
    out = out.filter((p) => (p.player.maybeYoe ?? 99) <= 0)
  }
  return out
}

function sortFcForTrendType(players: FantasyCalcPlayer[], trendType: TrendTypeId, direction: 'up' | 'down'): FantasyCalcPlayer[] {
  const copy = [...players]
  if (trendType === 'trade') {
    copy.sort((a, b) => (b.maybeTradeFrequency ?? 0) - (a.maybeTradeFrequency ?? 0))
    return direction === 'up' ? copy : [...copy].reverse()
  }
  return fcSortByTrend(copy, direction === 'up' ? 'up' : 'down', copy.length)
}

async function buildNflFromFantasyCalc(args: {
  settings: FantasyCalcSettings
  position: string
  rookiesOnly: boolean
  trendType: TrendTypeId
  limit: number
  includeEnrichment: boolean
  dataGaps: string[]
}): Promise<{ risers: TrendPlayerCard[]; fallers: TrendPlayerCard[] }> {
  let players: FantasyCalcPlayer[] = []
  try {
    const cached = await getCanonicalValuationSnapshot(args.settings)
    players = cached.players
  } catch (e) {
    console.warn('[trending-players] Canonical valuation resolution failed', e)
    args.dataGaps.push('Canonical valuation data unavailable — NFL value trends skipped.')
    return { risers: [], fallers: [] }
  }
  if (players.length === 0) {
    args.dataGaps.push('Canonical valuation data is unavailable — NFL value trends skipped.')
    return { risers: [], fallers: [] }
  }
  const pool = filterFcPool(players, args.position, args.rookiesOnly)
  if (pool.length === 0) {
    args.dataGaps.push('No NFL players matched filters (position / rookies).')
    return { risers: [], fallers: [] }
  }
  const upPool = sortFcForTrendType(pool, args.trendType, 'up').slice(0, args.limit)
  const downPool = sortFcForTrendType(pool, args.trendType, 'down').slice(0, args.limit)
  const risers = await Promise.all(
    upPool.map((player, i) => cardFromFcPlayer(player, i + 1, args.trendType, args.includeEnrichment)),
  )
  const fallers = await Promise.all(
    downPool.map((player, i) => cardFromFcPlayer(player, i + 1, args.trendType, args.includeEnrichment)),
  )
  return { risers, fallers }
}

async function buildNflFromTrendingTable(args: {
  position: string
  rookiesOnly: boolean
  limit: number
  includeEnrichment: boolean
  dataGaps: string[]
}): Promise<{ risers: TrendPlayerCard[]; fallers: TrendPlayerCard[] }> {
  const [addLeaders, dropLeaders] = await Promise.all([
    prisma.trendingPlayer.findMany({
      where: { sport: 'nfl', expiresAt: { gt: new Date() } },
      orderBy: { addCount: 'desc' },
      take: args.limit * 2,
    }),
    prisma.trendingPlayer.findMany({
      where: { sport: 'nfl', expiresAt: { gt: new Date() } },
      orderBy: { dropCount: 'desc' },
      take: args.limit * 2,
    }),
  ])
  if (addLeaders.length === 0 && dropLeaders.length === 0) {
    args.dataGaps.push('No cached Sleeper trending rows (trending_players) — sync platform trends or use FantasyCalc mode.')
    return { risers: [], fallers: [] }
  }

  async function mapRow(r: (typeof addLeaders)[0], rank: number, direction: 'up' | 'down'): Promise<TrendPlayerCard | null> {
    const playerId = `NFL:${r.sleeperId}`
    const enrich = args.includeEnrichment ? await enrichHeadshot(playerId) : { headshotUrl: null, logoUrl: null, injury: null }
    const pos = r.position ?? '—'
    if (args.position !== 'ALL' && !matchesPositionFilter(pos, args.position, 'NFL')) return null
    return {
      rank,
      playerId,
      sport: 'NFL',
      name: r.playerName ?? r.sleeperId,
      position: pos,
      team: r.team ?? '—',
      headshotUrl: enrich.headshotUrl,
      logoUrl: enrich.logoUrl,
      trendScore: r.crowdScore,
      trendDelta: direction === 'up' ? r.addCount : -r.dropCount,
      confidence: Math.min(92, 55 + Math.min(35, Math.abs(r.netTrend))),
      rosteredPct: null,
      snippet:
        direction === 'up'
          ? `Platform adds ${r.addCount} · net ${r.netTrend} · signal ${r.crowdSignal}`
          : `Platform drops ${r.dropCount} · net ${r.netTrend} · signal ${r.crowdSignal}`,
      chips: direction === 'up' ? ['Waiver Surge'] : ['Volatile'],
      sources: ['trending_players', 'Sleeper crowd'],
      injuryStatus: enrich.injury,
      isRookie: null,
      dataFreshness: `Lookback ${r.lookbackHours}h · DB sync`,
    }
  }

  const risers: TrendPlayerCard[] = []
  const fallers: TrendPlayerCard[] = []
  let ri = 1
  for (const r of addLeaders) {
    if (risers.length >= args.limit) break
    const card = await mapRow(r, ri++, 'up')
    if (card) risers.push(card)
  }
  let fi = 1
  for (const r of dropLeaders) {
    if (fallers.length >= args.limit) break
    const card = await mapRow(r, fi++, 'down')
    if (card) fallers.push(card)
  }
  return { risers, fallers }
}

async function metaCardsForSport(args: {
  sport: SupportedSport
  trendType: TrendTypeId
  position: string
  rookiesOnly: boolean
  since: Date | undefined
  limit: number
  direction: 'up' | 'down'
  dataGaps: string[]
}): Promise<TrendPlayerCard[]> {
  const order = metaOrderField(args.trendType)
  const sportKey = args.sport
  const baseWhere: Record<string, unknown> = {
    sport: { in: [sportKey, sportKey.toLowerCase()] },
  }
  if (args.since) baseWhere.updatedAt = { gte: args.since }
  if (args.direction === 'up') {
    baseWhere.trendingDirection = { in: ['Rising', 'Hot', 'Stable'] }
  } else {
    baseWhere.trendingDirection = { in: ['Falling', 'Cold'] }
  }

  const descending = args.direction === 'up'
  let rows = await prisma.playerMetaTrend.findMany({
    where: baseWhere as any,
    orderBy: { [order]: descending ? 'desc' : 'asc' },
    take: Math.min(80, args.limit * 8),
  })
  if (rows.length === 0) {
    const fallbackWhere: Record<string, unknown> = {
      sport: { in: [sportKey, sportKey.toLowerCase()] },
    }
    if (args.since) fallbackWhere.updatedAt = { gte: args.since }
    rows = await prisma.playerMetaTrend.findMany({
      where: fallbackWhere as any,
      orderBy: { trendScore: descending ? 'desc' : 'asc' },
      take: Math.min(80, args.limit * 8),
    })
  }

  const out: TrendPlayerCard[] = []
  if (args.rookiesOnly) {
    args.dataGaps.push(
      `Rookie-only filter is unreliable for ${args.sport} meta trends — age/experience metadata isn't captured on sports_players rows, so rookie status can't be confirmed here.`,
    )
    return out
  }
  for (const row of rows) {
    if (out.length >= args.limit) break
    const rowSport = normalizeToSupportedSport(row.sport)
    const dbPlayer = await getPlayer(row.playerId).catch(() => null)
    const pos = dbPlayer?.position ?? '—'
    if (args.position !== 'ALL' && !matchesPositionFilter(pos, args.position, rowSport)) continue
    const enrich = await enrichHeadshot(row.playerId)
    const metricVal =
      order === 'addRate'
        ? row.addRate
        : order === 'dropRate'
          ? row.dropRate
          : order === 'tradeInterest'
            ? row.tradeInterest
            : order === 'lineupStartRate'
              ? row.lineupStartRate
              : order === 'injuryImpact'
                ? row.injuryImpact
                : row.trendScore
    const snippet = `Meta trend ${row.trendingDirection} · score ${row.trendScore.toFixed(1)} · ${String(order)} ${
      typeof metricVal === 'number' ? metricVal.toFixed(3) : String(metricVal)
    }`
    out.push({
      rank: out.length + 1,
      playerId: row.playerId,
      sport: rowSport,
      name: dbPlayer?.name ?? row.playerId,
      position: pos,
      team: dbPlayer?.team ?? '—',
      headshotUrl: enrich.headshotUrl,
      logoUrl: enrich.logoUrl,
      trendScore: Math.round(row.trendScore),
      trendDelta: Math.round((row.trendScore - (row.previousTrendScore ?? row.trendScore)) * 10) / 10,
      confidence: Math.min(94, Math.max(40, 50 + row.trendScore * 0.35)),
      rosteredPct: null,
      snippet,
      chips: chipsFromMetaRates({
        addRate: row.addRate,
        dropRate: row.dropRate,
        tradeInterest: row.tradeInterest,
        lineupStartRate: row.lineupStartRate,
        injuryImpact: row.injuryImpact,
        trendType: args.trendType,
      }),
      sources: ['player_meta_trends', 'platform_signals'],
      injuryStatus: enrich.injury,
      isRookie: null,
      dataFreshness: 'Player meta trend rollup',
    })
  }
  return out
}

async function runAiNarrative(payload: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await openaiChatText({
      messages: [
        {
          role: 'system',
          content:
            'You are Chimmy for AllFantasy. Summarize trending player context in 3-5 short sentences. Use ONLY the JSON facts provided. If data is missing, say what is missing. Never invent injuries, news, or player stats. No markdown.',
        },
        { role: 'user', content: JSON.stringify(payload).slice(0, 12000) },
      ],
      temperature: 0.2,
      maxTokens: 400,
      skipCache: true,
    })
    if (!res.ok) return null
    return res.text.trim() || null
  } catch {
    return null
  }
}

export async function runTrendingDashboard(input: {
  sportFilter: TrendSportFilter
  leagueId: string | null
  userId: string | null
  trendType: TrendTypeId
  position: string
  rookiesOnly: boolean
  timeWindow: TimeWindowId
  contextMode: ContextModeId
  limitPerSide?: number
  skipAi?: boolean
}): Promise<TrendingDashboardOutput> {
  const limit = Math.min(20, Math.max(4, input.limitPerSide ?? DEFAULT_LIMIT))
  const rookiesEffective = input.rookiesOnly || input.trendType === 'rookie'
  const dataGaps: string[] = []
  let leagueName: string | null = null
  let analysisScope: 'general' | 'league' = 'general'
  let leagueSnapshot: Record<string, unknown> | null = null
  let loadedLeague: LoadedTradeLeague | null = null

  if (input.leagueId && input.userId) {
    const access = await assertLeagueMemberWithCode(input.leagueId, input.userId)
    if (!access.ok) {
      const code = access.code
      const msg = leagueToolAccessUserMessage(code)
      return { ok: false, error: msg, code, userMessage: msg }
    }
    loadedLeague = await loadLeagueForTrade({
      leagueId: input.leagueId,
      userId: input.userId,
      membershipPreverified: true,
    })
    if (!loadedLeague) {
      const code: LeagueToolAccessErrorCode = 'LEAGUE_NOT_FOUND'
      const msg = leagueToolAccessUserMessage(code)
      return { ok: false, error: msg, code, userMessage: msg }
    }
    leagueName = loadedLeague.name ?? 'League'
    analysisScope = 'league'
    leagueSnapshot = {
      id: loadedLeague.id,
      name: loadedLeague.name,
      sport: loadedLeague.sport,
      isDynasty: loadedLeague.isDynasty,
      scoring: loadedLeague.scoring,
      leagueSize: loadedLeague.leagueSize,
      settings: loadedLeague.settings,
      waiverBudget: loadedLeague.waiverBudget,
      taxiSlots: loadedLeague.taxiSlots,
    }
  }

  const since = sinceFromWindow(input.timeWindow)
  let risers: TrendPlayerCard[] = []
  let fallers: TrendPlayerCard[] = []

  const sportsToRun: SupportedSport[] =
    input.sportFilter === 'ALL' ? [...SUPPORTED_SPORTS] : [normalizeToSupportedSport(input.sportFilter)]

  const fcSettings = fantasyCalcSettingsFromLeague(loadedLeague)

  let trendingLeagueContext: NormalizedLeagueContext | null = null
  if (input.userId && input.leagueId && !input.skipAi) {
    const tr = await resolveNormalizedLeagueContext({
      userId: input.userId,
      leagueId: input.leagueId,
    })
    if (tr.ok) trendingLeagueContext = tr.context
  }

  /** NFL branch: FantasyCalc + trending_players */
  const runNfl = async () => {
    if (input.trendType === 'add' || input.trendType === 'drop') {
      const t = await buildNflFromTrendingTable({
        position: input.position,
        rookiesOnly: rookiesEffective,
        limit,
        includeEnrichment: true,
        dataGaps,
      })
      if (t.risers.length + t.fallers.length === 0) {
        const fb = await buildNflFromFantasyCalc({
          settings: fcSettings,
          position: input.position,
          rookiesOnly: rookiesEffective,
          trendType: input.trendType,
          limit,
          includeEnrichment: true,
          dataGaps,
        })
        risers.push(...fb.risers)
        fallers.push(...fb.fallers)
      } else {
        risers.push(...t.risers)
        fallers.push(...t.fallers)
      }
    } else {
      const fb = await buildNflFromFantasyCalc({
        settings: fcSettings,
        position: input.position,
        rookiesOnly: rookiesEffective,
        trendType: input.trendType,
        limit,
        includeEnrichment: true,
        dataGaps,
      })
      risers.push(...fb.risers)
      fallers.push(...fb.fallers)
    }
  }

  const runMetaSport = async (sport: SupportedSport) => {
    const [up, down] = await Promise.all([
      metaCardsForSport({
        sport,
        trendType: input.trendType,
        position: input.position,
        rookiesOnly: rookiesEffective,
        since,
        limit,
        direction: 'up',
        dataGaps,
      }),
      metaCardsForSport({
        sport,
        trendType: input.trendType,
        position: input.position,
        rookiesOnly: rookiesEffective,
        since,
        limit,
        direction: 'down',
        dataGaps,
      }),
    ])
    risers.push(...up)
    fallers.push(...down)
  }

  if (input.sportFilter === 'ALL') {
    await runNfl()
    for (const s of SUPPORTED_SPORTS) {
      if (s === 'NFL') continue
      await runMetaSport(s)
    }
    risers.sort((a, b) => Math.abs(b.trendDelta) - Math.abs(a.trendDelta))
    fallers.sort((a, b) => Math.abs(b.trendDelta) - Math.abs(a.trendDelta))
    risers = risers.slice(0, limit).map((c, i) => ({ ...c, rank: i + 1 }))
    fallers = fallers.slice(0, limit).map((c, i) => ({ ...c, rank: i + 1 }))
  } else {
    const sp = normalizeToSupportedSport(input.sportFilter)
    if (sp === 'NFL') {
      await runNfl()
    } else {
      await runMetaSport(sp)
    }
  }

  if (risers.length === 0 && fallers.length === 0) {
    dataGaps.push('No trend rows returned — connect league imports or ensure player_meta_trends / FantasyCalc data is available.')
  }

  let projectionLayerReady = false
  // UI dashboard requests pass skipAi=true and do not require heavy projection/context enrichment.
  if (!input.skipAi && (risers.length > 0 || fallers.length > 0)) {
    const enriched = await attachTrendCardProjectionAndLeagueContext({
      risers,
      fallers,
      leagueId: input.leagueId,
      userId: input.userId,
      leagueScoring: trendingLeagueContext?.scoring ?? null,
      trendType: input.trendType,
      contextMode: input.contextMode,
    })
    risers = enriched.risers
    fallers = enriched.fallers
    projectionLayerReady = enriched.projectionLayerReady
    dataGaps.push(...enriched.dataGaps)
  }

  const allCards = [...risers, ...fallers]
  const hasSource = (needle: string) =>
    allCards.some((c) => c.sources.some((s) => s.toLowerCase().includes(needle)))
  const fantasyCalcReady = hasSource('fantasycalc')
  const sleeperTrendingReady = hasSource('trending_players') || hasSource('sleeper')
  const metaTrendsReady = hasSource('player_meta_trend') || hasSource('meta trend')
  const injuryNewsLayerReady = allCards.some(
    (c) =>
      Boolean(c.injuryStatus?.trim()) ||
      (c.structuredWhy ?? []).some((w) => /injur|news|designation/i.test(w)),
  )
  const leagueScoringApplied = trendingLeagueContext != null

  const degraded = dataGaps.length > 0
  let aiNarrative: string | null = null

  const chimmyBase: Record<string, unknown> = {
    tool: 'trending_players',
    leagueContextEngine: trendingLeagueContext,
    analysisScope,
    leagueId: input.leagueId,
    leagueName,
    leagueSnapshot,
    sportFilter: input.sportFilter,
    trendType: input.trendType,
    position: input.position,
    rookiesOnly: rookiesEffective,
    timeWindow: input.timeWindow,
    timeWindowLabel: windowLabel(input.timeWindow),
    contextMode: input.contextMode,
    fantasyCalcSettings: fcSettings,
    dataGaps,
    risers: risers.map((r) => ({
      playerId: r.playerId,
      sport: r.sport,
      name: r.name,
      trendDelta: r.trendDelta,
      snippet: r.snippet,
      chips: r.chips,
      sources: r.sources,
      structuredWhy: r.structuredWhy,
      projectedFantasyPoints: r.projectedFantasyPoints,
      actionRecommendation: r.actionRecommendation,
      leagueRelevance: r.leagueRelevance,
      integrationHints: r.integrationHints,
    })),
    fallers: fallers.map((r) => ({
      playerId: r.playerId,
      sport: r.sport,
      name: r.name,
      trendDelta: r.trendDelta,
      snippet: r.snippet,
      chips: r.chips,
      sources: r.sources,
      structuredWhy: r.structuredWhy,
      projectedFantasyPoints: r.projectedFantasyPoints,
      actionRecommendation: r.actionRecommendation,
      leagueRelevance: r.leagueRelevance,
      integrationHints: r.integrationHints,
    })),
    fetchedAt: new Date().toISOString(),
  }

  let chimmyPayload: Record<string, unknown> = chimmyBase
  let aiEnvelopeReady = false
  if (input.userId && !input.skipAi) {
    const trendEnvelope = await buildAiToolPayload({
      userId: input.userId,
      tool: 'trending_players',
      mode: analysisScope === 'league' ? 'league' : 'global',
      league:
        input.leagueId && loadedLeague
          ? {
              leagueId: input.leagueId,
              leagueName,
              sport: String(loadedLeague.sport),
            }
          : null,
      data: {},
    })
    chimmyPayload = attachIntelligenceToChimmyPayload(chimmyBase, trendEnvelope)
    aiEnvelopeReady = true

    try {
      const bySport = new Map<SupportedSport, string[]>()
      for (const r of [...risers, ...fallers].slice(0, 48)) {
        const sp = normalizeToSupportedSport(String(r.sport ?? loadedLeague?.sport ?? 'NFL'))
        const arr = bySport.get(sp) ?? []
        if (!arr.includes(r.name)) arr.push(r.name)
        bySport.set(sp, arr)
      }
      const groups = [...bySport.entries()].map(([sport, names]) => ({ sport, names: names.slice(0, 24) }))
      if (groups.length > 0) {
        chimmyPayload = await enrichChimmyWithPlayerSportsNorm({
          chimmyPayload,
          prisma,
          groups,
          leagueScoring: trendingLeagueContext?.scoring ?? null,
        })
      }
    } catch {
      /* non-fatal */
    }
  }

  if (!input.skipAi) {
    aiNarrative = await runAiNarrative(chimmyPayload)
  }

  const biggestGainer = risers[0] ?? null
  const biggestFaller = fallers[0] ?? null

  const result: TrendingDashboardResult = {
    ok: true,
    analysisScope,
    sportLabel: input.sportFilter === 'ALL' ? 'All sports' : input.sportFilter,
    leagueName,
    summary: {
      riserCount: risers.length,
      fallerCount: fallers.length,
      biggestGainer,
      biggestFaller,
    },
    risers,
    fallers,
    aiNarrative,
    chimmyPayload,
    dataGaps,
    degraded,
    fetchedAt: new Date().toISOString(),
    sourceFlags: {
      fantasyCalcReady,
      sleeperTrendingReady,
      metaTrendsReady,
      projectionLayerReady,
      injuryNewsLayerReady,
      leagueScoringApplied,
      aiEnvelopeReady,
    },
  }

  return result
}
