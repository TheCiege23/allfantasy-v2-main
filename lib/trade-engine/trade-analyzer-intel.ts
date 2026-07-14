import { prisma } from '@/lib/prisma'
import { fetchFantasyCalcValues, findPlayerByName } from '@/lib/player-valuations/canonicalPlayerValuations'
import { fetchNewsContext, fetchRollingInsights } from '@/lib/upstream-apis'
import type { TradeDecisionContextV1 } from './trade-decision-context'
import {
  runNewsImpactEngine,
  formatNewsImpactForPrompt,
  type RawNewsItem,
  type NewsImpactResult,
} from './news-impact-engine'
import { computeTeamManagerContext } from './team-manager-context-engine'
import { readCache, writeCache } from '@/lib/enrichment-cache'

type PrismaLike = typeof prisma

type RookieClassRecord = Awaited<ReturnType<PrismaLike['rookieClass']['findFirst']>>
type RookieRankingRecord = Awaited<ReturnType<PrismaLike['rookieRanking']['findMany']>>
type SportsDataCacheRecord = Awaited<ReturnType<PrismaLike['sportsDataCache']['findUnique']>>

export interface TradeAnalyzerIntelDeps {
  fetchNewsContext: typeof fetchNewsContext
  fetchRollingInsights: typeof fetchRollingInsights
  fetchFantasyCalcValues: typeof fetchFantasyCalcValues
  findPlayerByName: typeof findPlayerByName
  findLatestRookieClass: () => Promise<RookieClassRecord>
  findTopRookieRankings: () => Promise<RookieRankingRecord>
  findKtcCache: () => Promise<SportsDataCacheRecord>
}

const defaultDeps: TradeAnalyzerIntelDeps = {
  fetchNewsContext,
  fetchRollingInsights,
  fetchFantasyCalcValues,
  findPlayerByName,
  findLatestRookieClass: () =>
    prisma.rookieClass.findFirst({
      orderBy: { year: 'desc' },
    }),
  findTopRookieRankings: () =>
    prisma.rookieRanking.findMany({
      orderBy: [{ year: 'desc' }, { rank: 'asc' }],
      take: 20,
    }),
  findKtcCache: () =>
    prisma.sportsDataCache.findUnique({
      where: { cacheKey: 'ktc-dynasty-rankings' },
    }),
}

export interface TradeHubIntelInput {
  playerNames: string[]
  teamAbbrevs?: string[]
  numTeams?: number
  isSuperflex?: boolean
  leagueStrategySnapshot?: LeagueStrategySnapshot
  leagueContextSummary?: string[]
}

export type TradeIntelEntityType = 'player' | 'pick' | 'team' | 'league'
export type TradeIntelSourceType =
  | 'news'
  | 'injury'
  | 'market'
  | 'stats'
  | 'roster'
  | 'league'
  | 'waiver'
  | 'ranking'
  | 'internet'

export interface TradeIntelSignal {
  entityType: TradeIntelEntityType
  entityKey: string
  source: string
  sourceType: TradeIntelSourceType
  headline: string
  summary: string
  confidence: number
  freshnessScore: number
  relevanceScore: number
  riskScore?: number
  horizon: 'short' | 'medium' | 'long'
  data: Record<string, unknown>
}

export interface LeagueStrategySnapshot {
  competitiveWindow: 'contender' | 'fringe' | 'retooling' | 'rebuilding'
  positionalStrengths: string[]
  positionalWeaknesses: string[]
  draftCapitalGrade: string
  ageCurveSummary: string
  leagueContextSummary: string
  recommendedStrategy: string[]
  risks: string[]
}
export interface TradeIntelBlockMeta {
  normalizedSignalCount: number | null
  sourceWeighting: string[]
  newsItems: number
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function toIsoDate(value?: string | null): string {
  if (!value) return 'unknown'
  return value.slice(0, 10)
}

function computeFreshnessScore(dateValue?: string | null): number {
  if (!dateValue) return 0.35
  const parsed = Date.parse(dateValue)
  if (!Number.isFinite(parsed)) return 0.35
  const ageHours = Math.max(0, (Date.now() - parsed) / 3_600_000)
  if (ageHours <= 6) return 0.98
  if (ageHours <= 24) return 0.9
  if (ageHours <= 72) return 0.78
  if (ageHours <= 168) return 0.62
  return 0.42
}

function likelyInjuryHeadline(headline: string): boolean {
  const h = headline.toLowerCase()
  return (
    h.includes('injur') ||
    h.includes('out') ||
    h.includes('questionable') ||
    h.includes('doubtful') ||
    h.includes('ir') ||
    h.includes('inactive')
  )
}

function mentionScore(haystack: string, keys: string[]): number {
  const low = haystack.toLowerCase()
  const normalizedKeys = keys.map((k) => k.toLowerCase())
  const hits = normalizedKeys.filter((k) => k && low.includes(k)).length
  if (!normalizedKeys.length) return 0.5
  return clampScore(hits / Math.max(1, Math.min(normalizedKeys.length, 4)))
}

function weightedSignalScore(signal: TradeIntelSignal): number {
  const riskAdjustment = signal.riskScore ? clampScore(1 - signal.riskScore * 0.3) : 1
  return (
    signal.confidence * 0.45 +
    signal.freshnessScore * 0.3 +
    signal.relevanceScore * 0.25
  ) * riskAdjustment
}

function gradeDraftCapital(pickCount: number): string {
  if (pickCount >= 6) return 'A'
  if (pickCount >= 4) return 'B'
  if (pickCount >= 2) return 'C'
  return 'D'
}

function formatSignalLine(signal: TradeIntelSignal): string {
  const weighted = weightedSignalScore(signal)
  return `- [${signal.sourceType}] ${signal.headline} | entity=${signal.entityKey} | weighted=${weighted.toFixed(
    2,
  )} | conf=${signal.confidence.toFixed(2)} | fresh=${signal.freshnessScore.toFixed(
    2,
  )} | rel=${signal.relevanceScore.toFixed(2)}`
}
export function parseTradeIntelBlockMeta(externalIntel: string): TradeIntelBlockMeta {
  if (!externalIntel) {
    return { normalizedSignalCount: null, sourceWeighting: [], newsItems: 0 }
  }

  const normalizedMatch = externalIntel.match(/Normalized TradeIntelSignal count:\s*(\d+)/i)
  const newsMatch = externalIntel.match(/News:\s*(\d+)\s*items/i)
  const weightingMatch = externalIntel.match(/Source weighting:\s*(.+)/i)

  const sourceWeighting = weightingMatch?.[1]
    ? weightingMatch[1]
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
    : []

  return {
    normalizedSignalCount: normalizedMatch ? Number(normalizedMatch[1]) : null,
    sourceWeighting,
    newsItems: newsMatch ? Number(newsMatch[1]) : 0,
  }
}

function computeLeagueStrategySnapshot(ctx: TradeDecisionContextV1): LeagueStrategySnapshot {
  const rosterAges = [
    ...ctx.sideA.assets.map((a) => a.age).filter((a): a is number => typeof a === 'number'),
  ]
  const avgAge = rosterAges.length
    ? rosterAges.reduce((sum, age) => sum + age, 0) / rosterAges.length
    : null

  const tierToWindow: Record<string, LeagueStrategySnapshot['competitiveWindow']> = {
    champion: 'contender',
    contender: 'contender',
    middle: 'fringe',
    rebuild: 'rebuilding',
  }

  const competitiveWindow = tierToWindow[ctx.sideA.contenderTier] ?? 'fringe'
  const draftCapitalGrade = gradeDraftCapital(ctx.sideA.rosterComposition.pickCount)
  const ageCurveSummary =
    avgAge == null
      ? 'Age curve unavailable'
      : avgAge <= 24.5
        ? `Young core (avg age ${avgAge.toFixed(1)})`
        : avgAge <= 27.5
          ? `Balanced age profile (avg age ${avgAge.toFixed(1)})`
          : `Aging core pressure (avg age ${avgAge.toFixed(1)})`

  const strategy: string[] = []
  if (competitiveWindow === 'contender') strategy.push('Prioritize weekly lineup delta and playoff leverage')
  if (competitiveWindow === 'rebuilding') strategy.push('Prioritize insulated value, youth, and future picks')
  if (ctx.leagueConfig.isSF) strategy.push('Protect QB insulation in Superflex markets')
  if (ctx.leagueConfig.isTEP) strategy.push('Apply TE premium replacement-value boost before final verdict')

  const risks = [
    ...(ctx.dataQuality.warnings || []).slice(0, 2),
    ...(ctx.missingData.tradeHistoryInsufficient ? ['Limited trade-history confidence'] : []),
    ...(ctx.missingData.injuryDataStale ? ['Injury data may be stale'] : []),
  ]

  return {
    competitiveWindow,
    positionalStrengths: ctx.sideA.surplus,
    positionalWeaknesses: ctx.sideA.needs,
    draftCapitalGrade,
    ageCurveSummary,
    leagueContextSummary: `${ctx.leagueConfig.numTeams}-team ${ctx.leagueConfig.scoringType} | ${ctx.leagueConfig.isSF ? 'SF' : '1QB'}${ctx.leagueConfig.isTEP ? ' | TEP' : ''}`,
    recommendedStrategy: strategy,
    risks,
  }
}

/**
 * Shared external intelligence block used across Trade Hub tabs/routes.
 */
export async function buildTradeHubIntelBlock(
  input: TradeHubIntelInput,
  deps: TradeAnalyzerIntelDeps = defaultDeps,
): Promise<string> {
  const playerNames = [...new Set(input.playerNames.map((p) => p.trim()).filter(Boolean))].slice(0, 30)
  const teamAbbrevs = [...new Set((input.teamAbbrevs || []).filter(Boolean))].slice(0, 12)

  const normalizedNumTeams: 10 | 12 | 14 | 16 =
    [10, 12, 14, 16].includes(input.numTeams || 12)
      ? (input.numTeams as 10 | 12 | 14 | 16)
      : 12

  const [news, rolling, fantasyCalc, rookieClass, rookieRanks, ktcCache] = await Promise.all([
    deps
      .fetchNewsContext(
        { prisma, newsApiKey: process.env.NEWS_API_KEY || process.env.NEWSAPI_KEY },
        {
          playerNames,
          teamAbbrevs,
          sport: 'NFL',
          hoursBack: 120,
          limit: 25,
        },
      )
      .catch(() => null),
    deps
      .fetchRollingInsights(
        { prisma },
        {
          playerNames,
          teamAbbrevs,
          sport: 'NFL',
          includeStats: true,
        },
      )
      .catch(() => null),
    deps
      .fetchFantasyCalcValues({
        isDynasty: true,
        numQbs: input.isSuperflex ? 2 : 1,
        numTeams: normalizedNumTeams,
        ppr: 1,
      })
      .catch(() => []),
    deps.findLatestRookieClass().catch(() => null),
    deps.findTopRookieRankings().catch(() => []),
    deps.findKtcCache().catch(() => null),
  ])

  const signals: TradeIntelSignal[] = []

  for (const item of news?.items || []) {
    const relevanceByMention = mentionScore(item.title, [...playerNames, ...teamAbbrevs])
    const freshness = computeFreshnessScore(item.publishedAt)
    const injury = likelyInjuryHeadline(item.title)
    const sourceType: TradeIntelSourceType = injury ? 'injury' : 'news'
    signals.push({
      entityType: item.team ? 'team' : 'league',
      entityKey: item.team || 'league_news',
      source: item.source || 'news',
      sourceType,
      headline: item.title,
      summary: `${item.source || 'news'} ${toIsoDate(item.publishedAt)} (${item.relevance || 'general'})`,
      confidence: clampScore(item.relevance === 'direct' ? 0.85 : 0.68),
      freshnessScore: freshness,
      relevanceScore: clampScore(0.45 + relevanceByMention * 0.55),
      riskScore: injury ? 0.55 : undefined,
      horizon: injury ? 'short' : 'medium',
      data: {
        publishedAt: item.publishedAt,
        url: item.url,
        relevance: item.relevance,
        isInjury: item.isInjury,
      },
    })
  }

  for (const player of rolling?.players || []) {
    const sourceType: TradeIntelSourceType =
      player.status && player.status.toLowerCase() !== 'active' ? 'injury' : 'stats'
    signals.push({
      entityType: 'player',
      entityKey: player.name,
      source: rolling?.source || 'rolling_insights',
      sourceType,
      headline: `${player.name} usage + production signal`,
      summary: `status=${player.status || 'unknown'} fpg=${player.fantasyPointsPerGame ?? 'n/a'} games=${player.gamesPlayed ?? 'n/a'}`,
      confidence: 0.72,
      freshnessScore: computeFreshnessScore(rolling?.fetchedAt),
      relevanceScore: mentionScore(player.name, playerNames),
      horizon: 'short',
      data: {
        team: player.team,
        position: player.position,
        fantasyPointsPerGame: player.fantasyPointsPerGame,
        gamesPlayed: player.gamesPlayed,
        status: player.status,
      },
    })
  }

  const fcMatchRows = playerNames
    .map((n) => ({ name: n, v: deps.findPlayerByName(fantasyCalc, n) }))
    .filter((r) => r.v)

  const fcLines = fcMatchRows
    .slice(0, 14)
    .map(
      (r) =>
        `- ${r.name}: value=${r.v!.value}, rank=#${r.v!.overallRank}, posRank=${r.v!.positionRank}, trend30d=${r.v!.trend30Day}`,
    )

  for (const row of fcMatchRows) {
    signals.push({
      entityType: 'player',
      entityKey: row.name,
      source: 'FantasyCalc',
      sourceType: 'market',
      headline: `${row.name} market valuation`,
      summary: `value=${row.v!.value}, overallRank=${row.v!.overallRank}, trend30d=${row.v!.trend30Day}`,
      confidence: 0.82,
      freshnessScore: computeFreshnessScore(new Date().toISOString()),
      relevanceScore: 0.9,
      horizon: 'medium',
      data: {
        value: row.v!.value,
        overallRank: row.v!.overallRank,
        positionRank: row.v!.positionRank,
        trend30Day: row.v!.trend30Day,
      },
    })
  }

  const ktcRows = Array.isArray((ktcCache as any)?.data)
    ? ((ktcCache as any).data as Array<{ name?: string; value?: number; rank?: number }>)
    : []

  const ktcLines = playerNames
    .map((n) => {
      const row = ktcRows.find((r) => (r.name || '').toLowerCase() === n.toLowerCase())
      return row ? `- ${n}: ktcValue=${row.value ?? 'n/a'}, ktcRank=#${row.rank ?? 'n/a'}` : null
    })
    .filter((v): v is string => Boolean(v))
    .slice(0, 14)

  for (const row of ktcRows) {
    if (!row.name || !playerNames.some((n) => n.toLowerCase() === row.name!.toLowerCase())) continue
    signals.push({
      entityType: 'player',
      entityKey: row.name,
      source: 'KTC cache',
      sourceType: 'market',
      headline: `${row.name} KTC value`,
      summary: `ktcValue=${row.value ?? 'n/a'} ktcRank=${row.rank ?? 'n/a'}`,
      confidence: 0.7,
      freshnessScore: computeFreshnessScore((ktcCache as any)?.updatedAt ?? (ktcCache as any)?.createdAt),
      relevanceScore: 0.86,
      horizon: 'medium',
      data: {
        rank: row.rank,
        value: row.value,
      },
    })
  }

  const newsLines = (news?.items || [])
    .slice(0, 10)
    .map(
      (n) =>
        `- [${n.relevance}] ${n.title} (${n.source}, ${n.publishedAt?.slice(0, 10) || 'unknown'})`,
    )

  const rollingLines = (rolling?.players || [])
    .slice(0, 10)
    .map(
      (p) =>
        `- ${p.name} (${p.position || '?'}/${p.team || '?'}): status=${p.status || 'unknown'}, fpg=${p.fantasyPointsPerGame ?? 'n/a'}, games=${p.gamesPlayed ?? 'n/a'}`,
    )

  const rookieLines = rookieRanks
    .slice(0, 10)
    .map(
      (r) =>
        `- ${r.year} #${r.rank}: ${r.name} (${r.position})${r.dynastyValue ? ` value=${r.dynastyValue}` : ''}`,
    )

  for (const rank of rookieRanks.slice(0, 12)) {
    signals.push({
      entityType: 'pick',
      entityKey: `${rank.year}-rookie-${rank.rank}`,
      source: 'RookieRankings',
      sourceType: 'ranking',
      headline: `${rank.year} rookie #${rank.rank} ${rank.name}`,
      summary: `${rank.position}${rank.dynastyValue ? ` value=${rank.dynastyValue}` : ''}`,
      confidence: 0.74,
      freshnessScore: computeFreshnessScore(rank.updatedAt.toISOString()),
      relevanceScore: 0.55,
      horizon: 'long',
      data: {
        name: rank.name,
        position: rank.position,
        team: rank.team,
        dynastyValue: rank.dynastyValue,
      },
    })
  }

  const sortedSignals = [...signals].sort((a, b) => weightedSignalScore(b) - weightedSignalScore(a))
  const sourceWeightSummary = Object.entries(
    sortedSignals.reduce<Record<string, { count: number; weighted: number }>>((acc, signal) => {
      if (!acc[signal.sourceType]) acc[signal.sourceType] = { count: 0, weighted: 0 }
      acc[signal.sourceType].count += 1
      acc[signal.sourceType].weighted += weightedSignalScore(signal)
      return acc
    }, {}),
  )
    .map(([sourceType, values]) => ({
      sourceType,
      count: values.count,
      avgWeight: values.weighted / Math.max(1, values.count),
    }))
    .sort((a, b) => b.avgWeight - a.avgWeight)

  const parts: string[] = []
  parts.push('--- EXTERNAL TRADE INTELLIGENCE LAYER ---')
  parts.push(
    `News: ${news?.items.length || 0} items | sources=${news?.sources.join(', ') || 'none'} | fetched=${news?.fetchedAt || 'n/a'}`,
  )
  if (newsLines.length) parts.push(newsLines.join('\n'))

  parts.push(
    `Rolling Insights: players=${rolling?.players.length || 0}, teams=${rolling?.teams.length || 0}, source=${rolling?.source || 'n/a'}, fetched=${rolling?.fetchedAt || 'n/a'}`,
  )
  if (rollingLines.length) parts.push(rollingLines.join('\n'))

  parts.push(`FantasyCalc matches: ${fcLines.length}/${playerNames.length}`)
  if (fcLines.length) parts.push(fcLines.join('\n'))

  parts.push(`KTC matches: ${ktcLines.length}/${playerNames.length}`)
  if (ktcLines.length) parts.push(ktcLines.join('\n'))

  if (rookieClass) {
    parts.push(
      `Rookie Class ${rookieClass.year}: strength=${rookieClass.strength.toFixed(2)}, QB=${rookieClass.qbDepth.toFixed(2)}, RB=${rookieClass.rbDepth.toFixed(2)}, WR=${rookieClass.wrDepth.toFixed(2)}, TE=${rookieClass.teDepth.toFixed(2)}`,
    )
  }

  if (rookieLines.length) {
    parts.push('Top Rookie Rankings:')
    parts.push(rookieLines.join('\n'))
  }

  if (input.leagueContextSummary?.length) {
    parts.push('League Context:')
    parts.push(input.leagueContextSummary.map((line) => `- ${line}`).join('\n'))
  }

  if (input.leagueStrategySnapshot) {
    const snap = input.leagueStrategySnapshot
    parts.push('League Strategy Snapshot:')
    parts.push(
      `- window=${snap.competitiveWindow} | draftCapital=${snap.draftCapitalGrade} | ageCurve=${snap.ageCurveSummary}`,
    )
    if (snap.positionalStrengths.length) parts.push(`- strengths=${snap.positionalStrengths.join(', ')}`)
    if (snap.positionalWeaknesses.length) parts.push(`- weaknesses=${snap.positionalWeaknesses.join(', ')}`)
    if (snap.recommendedStrategy.length) parts.push(`- strategy=${snap.recommendedStrategy.join(' | ')}`)
    if (snap.risks.length) parts.push(`- risks=${snap.risks.join(' | ')}`)
  }

  parts.push(`Normalized TradeIntelSignal count: ${sortedSignals.length}`)
  if (sourceWeightSummary.length) {
    parts.push(
      `Source weighting: ${sourceWeightSummary
        .map((s) => `${s.sourceType} avg=${s.avgWeight.toFixed(2)} (n=${s.count})`)
        .join(', ')}`,
    )
  }
  if (sortedSignals.length) {
    parts.push('Top normalized signals:')
    parts.push(sortedSignals.slice(0, 20).map(formatSignalLine).join('\n'))
  }

  // --- News Impact Engine: score, categorize, time-decay, value-adjust ---
  const newsImpactResult = await computeNewsImpact(news?.items || [], playerNames)
  if (newsImpactResult && newsImpactResult.items.length > 0) {
    parts.push('')
    parts.push(formatNewsImpactForPrompt(newsImpactResult))
  }

  parts.push(
    'Interpretation rules: prioritize weighted signals (confidence + freshness + relevance), reconcile market (FantasyCalc/KTC) with injuries/news, and adapt recommendation to competitive window plus positional needs.',
  )
  parts.push(
    'Signal reconciliation: if market and news conflict, reduce conviction and surface risk; if multi-source agreement exists, raise confidence and specificity.',
  )
  parts.push('--- END EXTERNAL TRADE INTELLIGENCE LAYER ---')

  return parts.join('\n')
}

/**
 * Runs the news impact engine with caching (20-min TTL).
 * Converts upstream NewsContextItems → RawNewsItems, scores & decays them.
 */
async function computeNewsImpact(
  newsItems: Array<{
    id: string
    title: string
    source: string
    url: string | null
    publishedAt: string
    isInjury: boolean
    injuryStatus?: string | null
    playerName?: string | null
    team: string | null
  }>,
  playerNames: string[],
): Promise<NewsImpactResult | null> {
  if (!newsItems.length) return null

  // Cache key includes sorted player names + item IDs hash for precision
  const itemIdHash = newsItems.map(i => i.id).sort().join(',').slice(0, 200)
  const cacheParams = { playerNames: [...playerNames].sort(), itemIdHash }
  const cached = await readCache<NewsImpactResult>(prisma, 'news_intelligence', cacheParams).catch(() => null)
  if (cached) return cached.data

  // Convert upstream format → RawNewsItem
  const rawItems: RawNewsItem[] = newsItems.map((item) => ({
    id: item.id,
    title: item.title,
    source: item.source,
    url: item.url,
    publishedAt: item.publishedAt,
    playerName: item.playerName ?? null,
    team: item.team,
    isInjury: item.isInjury,
    injuryStatus: item.injuryStatus,
  }))

  const result = runNewsImpactEngine(rawItems)

  // Write to cache (20-min TTL)
  await writeCache(prisma, 'news_intelligence', cacheParams, result, 'news_impact_engine').catch(() => {})

  return result
}

function toPlayerNames(ctx: TradeDecisionContextV1): string[] {
  return [
    ...ctx.sideA.assets.filter((a) => a.type === 'PLAYER').map((a) => a.name),
    ...ctx.sideB.assets.filter((a) => a.type === 'PLAYER').map((a) => a.name),
  ]
}

function toTeamAbbrevs(ctx: TradeDecisionContextV1): string[] {
  return [
    ...new Set([
      ...ctx.sideA.assets.map((a) => a.team).filter((t): t is string => Boolean(t)),
      ...ctx.sideB.assets.map((a) => a.team).filter((t): t is string => Boolean(t)),
    ]),
  ]
}

export async function buildTradeAnalyzerIntelPrompt(
  ctx: TradeDecisionContextV1,
  deps: TradeAnalyzerIntelDeps = defaultDeps,
): Promise<string> {
  const leagueStrategySnapshot = computeLeagueStrategySnapshot(ctx)
  const leagueContextSummary = [
    `${ctx.leagueConfig.name} (${ctx.leagueConfig.platform || 'platform-unknown'})`,
    `${ctx.leagueConfig.numTeams} teams | ${ctx.leagueConfig.isSF ? 'Superflex' : '1QB'}${ctx.leagueConfig.isTEP ? ' | TE Premium' : ''}`,
    `Roster: ${ctx.leagueConfig.starterSlots} starters, ${ctx.leagueConfig.benchSlots} bench, ${ctx.leagueConfig.taxiSlots} taxi`,
    `Trade balance: favoredSide=${ctx.valueDelta.favoredSide} diff=${ctx.valueDelta.absoluteDiff.toFixed(0)} (${ctx.valueDelta.percentageDiff.toFixed(1)}%)`,
  ]

  const intelBlock = await buildTradeHubIntelBlock(
    {
      playerNames: toPlayerNames(ctx),
      teamAbbrevs: toTeamAbbrevs(ctx),
      numTeams: ctx.leagueConfig.numTeams,
      isSuperflex: ctx.leagueConfig.isSF,
      leagueStrategySnapshot,
      leagueContextSummary,
    },
    deps,
  )

  // Append team & manager context intelligence
  let teamManagerBlock = ''
  try {
    const tmCtx = computeTeamManagerContext(ctx)
    teamManagerBlock = tmCtx.promptBlock
  } catch (err) {
    console.warn('[trade-intel] Team/manager context engine failed:', (err as any)?.message || err)
  }

  return teamManagerBlock
    ? `${intelBlock}\n\n${teamManagerBlock}`
    : intelBlock
}


