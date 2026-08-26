/**
 * Player Outlook Service — Orchestrator
 *
 * Single entry point: cache check → parallel data gather → bundle →
 * deterministic score → optional AI narrative → cache write → return.
 */

import { prisma } from '@/lib/prisma'
import { readCache, writeCache } from '@/lib/enrichment-cache'
import { findPlayerByName } from '@/lib/fantasycalc'
import { getFantasyCalcValuesDbFirst } from '@/lib/fantasycalc-db'
import { getPlayerAnalytics } from '@/lib/player-analytics'
import {
  getAgeCurve,
  getVolatilityProfile,
} from '@/lib/trade-engine/sport-tuning-registry'
import { computePlayerAdjustments, type RawNewsItem, scoreNewsItems } from '@/lib/trade-engine/news-impact-engine'
import { computePlayerOutlookScores } from './player-outlook-engine'
import { buildOutlookUserPrompt, PLAYER_OUTLOOK_SYSTEM_PROMPT } from './player-outlook-prompt'
import type {
  PlayerOutlook,
  OutlookDataBundle,
} from './player-outlook-types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GetPlayerOutlookParams {
  playerName?: string
  playerId?: string
  sport?: string
  includeNarrative?: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeName(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * Simple concurrency limiter.
 */
function pLimit(concurrency: number) {
  let active = 0
  const queue: Array<() => void> = []
  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve))
    }
    active++
    try { return await fn() }
    finally { active--; if (queue.length > 0) queue.shift()!() }
  }
}

// ---------------------------------------------------------------------------
// Data Gathering
// ---------------------------------------------------------------------------

async function gatherDataBundle(
  playerName: string,
  sport: string,
): Promise<OutlookDataBundle> {
  const normalized = normalizeName(playerName)

  // Parallel data fetch — all sources are optional
  const [fcValuesResult, analyticsResult, newsResult] = await Promise.allSettled([
    getFantasyCalcValuesDbFirst({ isDynasty: true, numQbs: 1, numTeams: 12, ppr: 1 }),
    getPlayerAnalytics(playerName).catch(() => null),
    prisma.sportsNews.findMany({
      where: {
        OR: [
          { title: { contains: playerName, mode: 'insensitive' } },
          { playerNames: { has: normalized } },
        ],
      },
      orderBy: { publishedAt: 'desc' },
      take: 5,
    }).catch(() => []),
  ])

  // Extract FantasyCalc player
  const fcPlayers = fcValuesResult.status === 'fulfilled' ? fcValuesResult.value : []
  const fc = findPlayerByName(fcPlayers, playerName)

  // Extract analytics
  const analytics = analyticsResult.status === 'fulfilled' ? analyticsResult.value : null

  // Extract position from available sources
  const positionRank = fc?.positionRank
  const position =
    (positionRank != null ? String(positionRank).replace(/[0-9]/g, '') : null) ??
    analytics?.position ??
    'UNKNOWN'

  // Sport tuning (synchronous)
  const ageCurve = getAgeCurve(sport, position)
  const volatilityProfile = getVolatilityProfile(sport, position)

  // News adjustments
  let newsAdjustments = null
  let newsVolatilityIncrease = false
  if (newsResult.status === 'fulfilled' && newsResult.value.length > 0) {
    const rawItems: RawNewsItem[] = newsResult.value.map((n: any) => ({
      id: n.id,
      title: n.title ?? '',
      source: n.source ?? 'unknown',
      url: n.sourceUrl ?? null,
      publishedAt: n.publishedAt?.toISOString() ?? new Date().toISOString(),
      playerName: playerName,
      team: n.team ?? null,
      isInjury: /injur|out|ir\b|questionable/i.test(n.title ?? ''),
    }))
    const scored = scoreNewsItems(rawItems)
    const adjustments = computePlayerAdjustments(scored)
    if (adjustments.length > 0) {
      newsAdjustments = adjustments
      newsVolatilityIncrease = adjustments.some(a => a.volatilityIncrease)
    }
  }

  // Build age from analytics rawData or FantasyCalc when available
  const age = (analytics?.rawData as Record<string, unknown> | null)?.age ?? (fc as any)?.age ?? null

  return {
    playerName,
    playerId: null,
    sport,
    position,
    team: (fc as any)?.team ?? analytics?.currentTeam ?? null,
    age,
    fantasyCalc: fc ?? null,
    analytics,
    newsAdjustments,
    ageCurve,
    volatilityProfile,
    scarcity: null, // Would need league-specific scarcity
    fantasyPointsPerGame: analytics?.fantasyPointsPerGame ?? null,
    gamesPlayed: null,
    seasonStats: null,
    trend30Day: fc?.trend30Day ?? null,
    trendType: null,
    injuryStatus: analytics?.status ?? null,
    weeklyVolatility: analytics?.weeklyVolatility ?? null,
    newsVolatilityIncrease,
    breakoutAge: (analytics as any)?.college?.breakoutAge ?? (analytics as any)?.breakoutAge ?? null,
    dominatorRating: (analytics as any)?.college?.dominatorRating ?? (analytics as any)?.dominatorRating ?? null,
    athleticGrade: null,
  }
}

// ---------------------------------------------------------------------------
// Main: Single Player Outlook
// ---------------------------------------------------------------------------

export async function getPlayerOutlook(
  params: GetPlayerOutlookParams,
): Promise<PlayerOutlook> {
  const playerName = params.playerName?.trim() ?? ''
  const sport = (params.sport ?? 'NFL').toUpperCase()
  const includeNarrative = params.includeNarrative ?? false

  if (!playerName) {
    throw new Error('playerName is required')
  }

  // Step 1: Cache check
  const cacheParams = { sport, name: normalizeName(playerName) }
  const cached = await readCache<PlayerOutlook>(prisma, 'player_outlook', cacheParams).catch(() => null)
  if (cached) {
    const age = Math.round((Date.now() - new Date(cached.fetchedAt).getTime()) / 1000)
    return { ...cached.data, fromCache: true, cacheAge: age }
  }

  // Step 2: Gather data
  const bundle = await gatherDataBundle(playerName, sport)

  // Step 3: Deterministic scoring
  const scoring = computePlayerOutlookScores(bundle)

  // Step 4: Track sources
  const sourcesUsed: string[] = []
  if (bundle.fantasyCalc) sourcesUsed.push('FantasyCalc')
  if (bundle.analytics) sourcesUsed.push('PlayerAnalytics')
  if (bundle.newsAdjustments) sourcesUsed.push('NewsImpact')
  if (bundle.ageCurve) sourcesUsed.push('SportTuning')
  if (bundle.fantasyPointsPerGame != null) sourcesUsed.push('SeasonStats')

  // Step 5: AI narrative (optional)
  let narrative: string | null = null
  if (includeNarrative) {
    try {
      const { openaiChatJson } = await import('@/lib/openai-client')
      const prompt = buildOutlookUserPrompt(scoring, bundle)
      const result = await openaiChatJson({
        messages: [
          { role: 'system', content: PLAYER_OUTLOOK_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.6,
        maxTokens: 300,
      })
      if (result.ok && result.json?.choices?.[0]?.message?.content) {
        narrative = result.json.choices[0].message.content.trim()
      }
    } catch (err) {
      console.warn('[player-outlook] AI narrative generation failed:', (err as any)?.message)
    }
  }

  // Step 6: Assemble final outlook
  const outlook: PlayerOutlook = {
    playerName: bundle.playerName,
    playerId: bundle.playerId,
    sport,
    position: bundle.position,
    team: bundle.team,
    currentValue: bundle.fantasyCalc?.value ?? 0,
    currentRank: bundle.fantasyCalc?.overallRank ?? 999,
    positionRank: typeof bundle.fantasyCalc?.positionRank === 'number'
      ? bundle.fantasyCalc.positionRank
      : parseInt(String(bundle.fantasyCalc?.positionRank ?? '999').replace(/\D/g, '')) || 999,
    ...scoring,
    narrative,
    sourcesUsed,
    updatedAt: new Date().toISOString(),
    fromCache: false,
    cacheAge: null,
  }

  // Step 7: Cache write
  await writeCache(prisma, 'player_outlook', cacheParams, outlook, 'player_outlook_service').catch(() => {})

  return outlook
}

// ---------------------------------------------------------------------------
// Main: Batch Player Outlook
// ---------------------------------------------------------------------------

export async function getPlayerOutlookBatch(
  players: Array<{ playerName: string; sport?: string }>,
  includeNarrative?: boolean,
): Promise<(PlayerOutlook | null)[]> {
  const limiter = pLimit(5)

  const results = await Promise.allSettled(
    players.map((p) =>
      limiter(() =>
        getPlayerOutlook({
          playerName: p.playerName,
          sport: p.sport ?? 'NFL',
          includeNarrative: includeNarrative ?? false,
        }),
      ),
    ),
  )

  return results.map((r) => (r.status === 'fulfilled' ? r.value : null))
}

// ---------------------------------------------------------------------------
// Cache Invalidation
// ---------------------------------------------------------------------------

export async function invalidateOutlookCache(
  playerName: string,
  sport: string,
): Promise<void> {
  const cacheParams = { sport: sport.toUpperCase(), name: normalizeName(playerName) }
  try {
    // The enrichment cache uses SHA256 keys — we need to delete by reconstructing the key
    const crypto = await import('crypto')
    const stable = JSON.stringify(cacheParams)
    const hash = crypto.createHash('sha256').update(stable).digest('hex').slice(0, 16)
    const key = `player_outlook:${hash}`
    await prisma.sportsDataCache.delete({ where: { cacheKey: key } }).catch(() => {})
  } catch {
    // Non-fatal
  }
}
