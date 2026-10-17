/**
 * PlayerCardAnalyticsService — aggregates AI insights, meta trends, matchup predictions, career projections for player cards.
 */

import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { openaiChatText } from '@/lib/openai-client'
import { getPlayerMetaTrendsForMeta } from '@/lib/global-meta-engine/MetaQueryService'
import { getPlayerAnalytics } from '@/lib/player-analytics'
import { normalizeSportForMeta } from '@/lib/global-meta-engine/SportMetaResolver'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { getTrendFeedItemForPlayer } from '@/lib/player-trend/TrendDetectionService'
import {
  crosswalkToRollingInsightsIds,
  type RiCrosswalkDb,
} from '@/lib/player-identity/rollingInsightsCrosswalk'
import { buildNameIndex, resolveVerifiedMatch } from '@/lib/player-match/verifiedNameMatch'
import type {
  PlayerCardAnalyticsPayload,
  PlayerCardMetaTrend,
  PlayerCardMatchupPrediction,
  PlayerCardCareerProjection,
} from './types'
import type { PlayerCardSeasonStat } from './types'

type NormalizedMetaTrend = {
  playerId: string
  trendScore: number
  addRate: number
  dropRate: number
  tradeRate: number
  draftRate: number
  trendingDirection: string
  updatedAt: Date | null
}

function normalizeName(name: string): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[.'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface GetPlayerCardInput {
  playerId?: string | null
  playerName: string
  position?: string | null
  team?: string | null
  sport?: string | null
  season?: string | null
}

function deriveOpponentTier(input: {
  expectedPointsPerGame?: number | null
  trendingDirection?: string | null
  volatility?: number | null
}): string | undefined {
  const ppg = input.expectedPointsPerGame
  const trend = String(input.trendingDirection ?? '').toLowerCase()
  const volatility = input.volatility ?? null
  if (ppg == null) return undefined

  const trendBoost = trend === 'hot' || trend === 'rising' || trend === 'up'
  const trendPenalty = trend === 'cold' || trend === 'falling' || trend === 'down'
  const highVolatility = volatility != null && volatility >= 65

  if (ppg >= 18 || (ppg >= 15 && trendBoost)) return 'favorable'
  if (ppg <= 9 || (ppg <= 11 && (trendPenalty || highVolatility))) return 'tough'
  return 'neutral'
}

function buildFallbackInsight(input: {
  playerName: string
  trendDirection?: string | null
  expectedPointsPerGame?: number | null
  breakoutProbability?: number | null
}): string {
  const trend = input.trendDirection ?? 'neutral'
  const ppg = input.expectedPointsPerGame
  const breakout = input.breakoutProbability
  const ppgCopy =
    ppg != null
      ? `Current outlook sits around ${ppg.toFixed(1)} points per game.`
      : 'Current production outlook is stable.'
  const breakoutCopy =
    breakout != null
      ? `Long-term profile shows roughly ${breakout.toFixed(0)}% breakout probability.`
      : 'Long-term projection is still developing.'
  return `${input.playerName} is currently trending ${trend}. ${ppgCopy} ${breakoutCopy}`
}

async function resolvePlayerId(args: {
  playerId?: string | null
  playerName: string
  sport: string
}): Promise<string | null> {
  const incoming = args.playerId?.trim()
  if (incoming) return incoming
  const row = await prisma.player.findFirst({
    where: {
      sport: args.sport,
      name: { equals: args.playerName, mode: 'insensitive' },
    },
    select: { id: true },
  })
  return row?.id ?? null
}

const SEASON_STATS_SELECT = {
  playerId: true,
  playerName: true,
  position: true,
  season: true,
  gamesPlayed: true,
  fantasyPoints: true,
  fantasyPointsPerGame: true,
  team: true,
  stats: true,
} as const

/**
 * The `player_season_stats` rows that belong to THIS player — or none.
 *
 * 🛑 THE CALLER'S ID IS NOT THE TABLE'S ID (2026-10-12). NFL rows are `source = 'rolling_insights'`
 * keyed on RI's own player number; the draft room and roster cards send a SLEEPER id. Both are bare
 * numbers for different people, so `{ playerId, sport }` answered with a stranger: Sleeper 9509 (Bijan
 * Robinson) read Malachi Fields' 7.72 PPG, Sleeper 6794 (Justin Jefferson) read DaRon Bland — 1,826 NFL
 * Sleeper ids hit another player's row and 0 hit their own. With no `source` filter the 168
 * `api_sports` rows (also bare numbers) were in play too. So for NFL the id crosses
 * `PlayerIdentityMap` (`crosswalkToRollingInsightsIds`, refusing a non-one-to-one mapping) and only
 * `rolling_insights` rows are read. Other sports' rows are `tsdb_…` ids, a namespace no league id
 * collides with, so their id lookup is unchanged.
 *
 * The NAME fallback refuses namesakes: one candidate per distinct player id, bound only through
 * `resolveVerifiedMatch` with position/team, and a lone candidate that contradicts them is refused
 * (`refuseContradictedSingle` — the table is a partial list, so "unique here" is not "unique").
 */
async function loadSeasonStatsRows(args: {
  incomingId: string | null
  name: string
  position: string | null
  team: string | null
  sport: string
}) {
  const sport = args.sport.toUpperCase()
  const nfl = sport === 'NFL'
  const sourceFilter = nfl ? { source: 'rolling_insights' } : {}

  let statsId: string | null = null
  if (args.incomingId) {
    if (nfl) {
      const crosswalk = await crosswalkToRollingInsightsIds(prisma as unknown as RiCrosswalkDb, {
        sport,
        lookups: [{ column: 'sleeperId', ids: [args.incomingId] }],
      }).catch(() => null)
      // The identity map says this id is not one person — a name cannot settle that either.
      if (crosswalk?.ambiguous.includes(args.incomingId)) return []
      statsId = crosswalk?.byId.get(args.incomingId)?.rollingInsightsId ?? null
    } else {
      statsId = args.incomingId
    }
  }

  if (statsId) {
    const rows = await prisma.playerSeasonStats
      .findMany({
        where: { sport, playerId: statsId, ...sourceFilter },
        orderBy: { season: 'desc' },
        take: 6,
        select: SEASON_STATS_SELECT,
      })
      .catch(() => [])
    // A mapped NFL identity with no rows has no stats; a name would only find the same RI id.
    if (rows.length > 0 || nfl) return rows
  }

  if (!args.name) return []
  const named = await prisma.playerSeasonStats
    .findMany({
      where: { sport, ...sourceFilter, playerName: { equals: args.name, mode: 'insensitive' as const } },
      orderBy: { season: 'desc' },
      select: SEASON_STATS_SELECT,
    })
    .catch(() => [])
  // One candidate per distinct player, described by his newest row (rows are season-desc).
  const newestByPlayer = new Map<string, (typeof named)[number]>()
  for (const row of named) if (!newestByPlayer.has(row.playerId)) newestByPlayer.set(row.playerId, row)
  const index = buildNameIndex(
    [...newestByPlayer.values()].map((row) => ({
      playerId: row.playerId,
      name: row.playerName,
      position: row.position,
      team: row.team,
    })),
  )
  const verdict = resolveVerifiedMatch(
    index,
    { name: args.name, position: args.position, team: args.team },
    { refuseContradictedSingle: true },
  )
  if (!verdict.match) return []
  const chosen = verdict.match.playerId
  return named.filter((row) => row.playerId === chosen).slice(0, 6)
}

function normalizeMetaTrendRow(raw: {
  playerId: string
  trendScore: number
  addRate: number
  dropRate: number
  tradeRate: number
  draftRate: number
  trendingDirection: string
  updatedAt: Date
}): NormalizedMetaTrend {
  return {
    playerId: raw.playerId,
    trendScore: raw.trendScore ?? 0,
    addRate: raw.addRate ?? 0,
    dropRate: raw.dropRate ?? 0,
    tradeRate: raw.tradeRate ?? 0,
    draftRate: raw.draftRate ?? 0,
    trendingDirection: raw.trendingDirection ?? 'neutral',
    updatedAt: raw.updatedAt ?? null,
  }
}

/**
 * Build full player card payload: AI insights, meta trends, matchup prediction, career projection.
 */
export async function getPlayerCardAnalytics(
  input: GetPlayerCardInput
): Promise<PlayerCardAnalyticsPayload> {
  const sport = normalizeToSupportedSport(input.sport)
  const metaSport = normalizeSportForMeta(sport)
  const name = input.playerName?.trim() ?? ''
  const playerId = await resolvePlayerId({
    playerId: input.playerId,
    playerName: name,
    sport,
  })

  const [analytics, careerRow, trendFeedItem] = await Promise.all([
    getPlayerAnalytics(name, input.season ?? undefined),
    playerId
      ? prisma.playerCareerProjection.findFirst({
          where: { sport, playerId },
          orderBy: { season: 'desc' },
        })
      : Promise.resolve(null),
    playerId ? getTrendFeedItemForPlayer(playerId, sport).catch(() => null) : Promise.resolve(null),
  ])

  // Fetch historical season stats from DB (multi-sport, DB-first).
  // Used for: non-NFL analytics fallback, season history display in player card.
  const rawSeasonStats = await loadSeasonStatsRows({
    incomingId: input.playerId?.trim() || null,
    name,
    position: input.position ?? null,
    team: input.team ?? null,
    sport,
  })

  const seasonHistory: PlayerCardSeasonStat[] = rawSeasonStats.map((r) => ({
    season: r.season,
    gamesPlayed: r.gamesPlayed ?? null,
    fantasyPoints: r.fantasyPoints ?? null,
    fantasyPointsPerGame: r.fantasyPointsPerGame ?? null,
    team: r.team ?? null,
    stats: (r.stats as Record<string, unknown>) ?? {},
  }))

  // For non-NFL sports, playerAnalyticsSnapshot is NFL-only — use PlayerSeasonStats as fallback context.
  const fallbackStats = !analytics && seasonHistory.length > 0 ? seasonHistory[0] : null

  let metaForPlayer: NormalizedMetaTrend | null = null
  if (playerId != null) {
    const dbMetaRow = await prisma.playerMetaTrend
      .findUnique({
        where: {
          uniq_player_meta_trend_player_sport: {
            playerId,
            sport: metaSport,
          },
        },
      })
      .catch(() => null)
    if (dbMetaRow) {
      metaForPlayer = normalizeMetaTrendRow({
        playerId: dbMetaRow.playerId,
        trendScore: dbMetaRow.trendScore,
        addRate: dbMetaRow.addRate,
        dropRate: dbMetaRow.dropRate,
        tradeRate: dbMetaRow.tradeInterest,
        draftRate: dbMetaRow.draftFrequency,
        trendingDirection: dbMetaRow.trendingDirection,
        updatedAt: dbMetaRow.updatedAt,
      })
    }
  }

  const normName = normalizeName(name)
  if (!metaForPlayer) {
    const metaTrendsList = await getPlayerMetaTrendsForMeta({ sport: metaSport, limit: 500 })
    const fromList = metaTrendsList.find(
      (t) => normalizeName(t.playerId) === normName || t.playerId === playerId
    )
    if (fromList) {
      metaForPlayer = normalizeMetaTrendRow({
        playerId: fromList.playerId,
        trendScore: fromList.trendScore,
        addRate: fromList.addRate,
        dropRate: fromList.dropRate,
        tradeRate: fromList.tradeRate,
        draftRate: fromList.draftRate,
        trendingDirection: fromList.trendingDirection,
        updatedAt: fromList.updatedAt,
      })
    }
  }

  const metaTrends: PlayerCardMetaTrend | null = metaForPlayer
    ? {
        trendScore: metaForPlayer.trendScore ?? 0,
        addRate: metaForPlayer.addRate ?? 0,
        dropRate: metaForPlayer.dropRate ?? 0,
        tradeRate: metaForPlayer.tradeRate ?? 0,
        draftRate: metaForPlayer.draftRate ?? 0,
        trendingDirection: metaForPlayer.trendingDirection ?? 'neutral',
        updatedAt: metaForPlayer.updatedAt?.toISOString?.() ?? '',
      }
    : null

  const opponentTier = deriveOpponentTier({
    expectedPointsPerGame: analytics?.expectedFantasyPointsPerGame ?? fallbackStats?.fantasyPointsPerGame ?? null,
    trendingDirection: metaForPlayer?.trendingDirection ?? trendFeedItem?.direction ?? null,
    volatility: analytics?.weeklyVolatility ?? careerRow?.volatilityScore ?? null,
  })

  const trendLabel =
    metaForPlayer?.trendingDirection ??
    trendFeedItem?.direction ??
    null

  const matchupPrediction: PlayerCardMatchupPrediction | null = analytics
    ? {
        expectedPoints: analytics.expectedFantasyPoints ?? null,
        expectedPointsPerGame: analytics.expectedFantasyPointsPerGame ?? null,
        opponentTier,
        outlook:
          analytics.expectedFantasyPointsPerGame != null
            ? `Expected ${analytics.expectedFantasyPointsPerGame.toFixed(1)} PPG (${opponentTier ?? 'neutral'} matchup tier).`
            : undefined,
      }
    : fallbackStats?.fantasyPointsPerGame != null
      ? {
          expectedPoints: fallbackStats.fantasyPoints ?? null,
          expectedPointsPerGame: fallbackStats.fantasyPointsPerGame,
          opponentTier,
          outlook: `${fallbackStats.season} season: ${fallbackStats.fantasyPointsPerGame.toFixed(1)} PPG across ${fallbackStats.gamesPlayed ?? '?'} games.`,
        }
      : null

  const careerProjection: PlayerCardCareerProjection | null = careerRow
    ? {
        projectedPointsYear1: careerRow.projectedPointsYear1,
        projectedPointsYear2: careerRow.projectedPointsYear2,
        projectedPointsYear3: careerRow.projectedPointsYear3,
        projectedPointsYear4: careerRow.projectedPointsYear4,
        projectedPointsYear5: careerRow.projectedPointsYear5,
        breakoutProbability: careerRow.breakoutProbability,
        declineProbability: careerRow.declineProbability,
        volatilityScore: careerRow.volatilityScore,
        season: careerRow.season,
      }
    : null

  const contextParts: string[] = []
  if (analytics) {
    contextParts.push(
      `Position: ${analytics.position}. Team: ${analytics.currentTeam ?? 'FA'}.`
    )
    if (analytics.fantasyPointsPerGame != null) {
      contextParts.push(`FP/G: ${analytics.fantasyPointsPerGame.toFixed(1)}.`)
    }
    if (analytics.expectedFantasyPointsPerGame != null) {
      contextParts.push(`Expected FP/G: ${analytics.expectedFantasyPointsPerGame.toFixed(1)}.`)
    }
    if (analytics.draft?.currentAdp != null) {
      contextParts.push(`ADP: ${analytics.draft.currentAdp.toFixed(1)}.`)
    }
  }
  if (!analytics && fallbackStats) {
    contextParts.push(`Sport: ${sport}. Team: ${fallbackStats.team ?? 'FA'}. Season: ${fallbackStats.season}.`)
    if (fallbackStats.fantasyPointsPerGame != null) {
      contextParts.push(`FP/G: ${fallbackStats.fantasyPointsPerGame.toFixed(1)} over ${fallbackStats.gamesPlayed ?? '?'} games.`)
    }
  }
  if (metaForPlayer) {
    contextParts.push(
      `Trend: ${metaForPlayer.trendingDirection}. Trend score: ${(metaForPlayer.trendScore ?? 0).toFixed(1)}. Add rate: ${((metaForPlayer.addRate ?? 0) * 100).toFixed(0)}%.`
    )
  }
  if (trendFeedItem) {
    contextParts.push(
      `Recent deterministic trend classification: ${trendFeedItem.trendType} (${trendFeedItem.direction}), score ${trendFeedItem.trendScore.toFixed(1)}.`
    )
  }
  if (careerRow) {
    contextParts.push(
      `Career projection: Y1 ${careerRow.projectedPointsYear1} pts, breakout prob ${careerRow.breakoutProbability.toFixed(0)}%, decline ${careerRow.declineProbability.toFixed(0)}%.`
    )
  }

  // ── AiResult cache gate ────────────────────────────────────────────────────
  // Build deterministic key from the inputs that determine the AI output.
  const aiCacheInput = JSON.stringify({ name: name.toLowerCase(), sport, season: input.season ?? null })
  const inputHash = crypto.createHash('sha256').update(aiCacheInput).digest('hex')
  const aiResultKey = `player-card-analytics:${inputHash}`
  /** 12-hour TTL — stale enough to reduce OpenAI calls, fresh enough to reflect news changes. */
  const AI_CACHE_TTL_MS = 12 * 60 * 60 * 1000
  const aiCacheNow = new Date()

  let aiInsights: string | null = null

  // Try cache first.
  const cachedAiResult = await prisma.aiResult.findUnique({
    where: { resultKey: aiResultKey },
    select: { resultText: true, expiresAt: true },
  }).catch(() => null)

  if (cachedAiResult && cachedAiResult.resultText && (!cachedAiResult.expiresAt || cachedAiResult.expiresAt > aiCacheNow)) {
    console.log(`[player-card-analytics] AiResult cache hit { key: '${aiResultKey.slice(0, 48)}...' }`)
    aiInsights = cachedAiResult.resultText
  } else if (contextParts.length > 0) {
    try {
      const res = await openaiChatText({
        messages: [
          {
            role: 'system',
            content:
              'You are a fantasy sports analyst. In 2-3 short sentences, give actionable insight about this player for a player card. Be concise. No bullet lists.',
          },
          {
            role: 'user',
            content: `Player: ${name}. ${contextParts.join(' ')}`,
          },
        ],
        temperature: 0.5,
        maxTokens: 180,
      })
      if (res.ok && res.text?.trim()) {
        aiInsights = res.text.trim()
        // Write result to AiResult cache (fire-and-forget).
        const aiExpiresAt = new Date(Date.now() + AI_CACHE_TTL_MS)
        prisma.aiResult.upsert({
          where: { resultKey: aiResultKey },
          update: { resultText: aiInsights, syncedAt: aiCacheNow, expiresAt: aiExpiresAt, status: 'ready', updatedAt: aiCacheNow },
          create: {
            resultKey: aiResultKey,
            inputHash,
            feature: 'player-card-analytics',
            scopeType: 'player',
            scopeId: playerId ?? name,
            provider: 'openai',
            status: 'ready',
            inputJson: { name, sport, season: input.season ?? null, contextParts },
            resultText: aiInsights,
            syncedAt: aiCacheNow,
            expiresAt: aiExpiresAt,
          },
        }).catch((e) => console.warn('[player-card-analytics] AiResult write failed:', e instanceof Error ? e.message : e))
        console.log(`[player-card-analytics] AiResult cache miss — wrote new result { key: '${aiResultKey.slice(0, 48)}...' }`)
      }
    } catch {
      aiInsights = null
    }
  }
  if (!aiInsights) {
    aiInsights = buildFallbackInsight({
      playerName: name || 'This player',
      trendDirection: trendLabel,
      expectedPointsPerGame: analytics?.expectedFantasyPointsPerGame ?? null,
      breakoutProbability: careerRow?.breakoutProbability ?? null,
    })
  }

  return {
    playerId,
    playerName: name || 'Unknown',
    position: analytics?.position ?? input.position ?? null,
    team: analytics?.currentTeam ?? input.team ?? null,
    sport,
    aiInsights,
    metaTrends,
    matchupPrediction,
    careerProjection,
    seasonHistory: seasonHistory.length > 0 ? seasonHistory : null,
  }
}
