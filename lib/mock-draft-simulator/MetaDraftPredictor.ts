/**
 * MetaDraftPredictor — uses platform meta trends to adjust draft rankings (reaches, value, trend awareness).
 */

import { getPlayerMetaTrendsForMeta, getPositionMetaTrends } from '@/lib/global-meta-engine/MetaQueryService'
import { normalizeSportForMeta } from '@/lib/global-meta-engine/SportMetaResolver'
import type { MetaDraftInput, MetaDraftOutput } from './types'

function normalizeName(name: string): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[.'-]/g, '')
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Return meta-adjusted scores for available players (trend score, draft rate, position trend).
 */
export async function predictWithMeta(input: MetaDraftInput): Promise<MetaDraftOutput> {
  const { sport, available } = input
  const normalizedSport = normalizeSportForMeta(sport)

  const [playerTrends, positionTrends] = await Promise.all([
    getPlayerMetaTrendsForMeta({ sport: normalizedSport, limit: 300 }),
    getPositionMetaTrends(normalizedSport),
  ])

  const trendByKey = new Map<string, { trendScore: number; draftRate: number; direction: string }>()
  for (const t of playerTrends) {
    const key = normalizeName(t.playerId) // playerId may be name in some sources
    if (key) trendByKey.set(key, { trendScore: t.trendScore ?? 0, draftRate: t.draftRate ?? 0, direction: t.trendingDirection ?? 'neutral' })
  }
  const posRates = new Map(positionTrends.map((p: { position: string; draftRate: number }) => [p.position.toUpperCase(), p.draftRate ?? 0]))

  const playerScores = available.map((p) => {
    const key = normalizeName(p.name)
    const trend = trendByKey.get(key)
    const posRate = posRates.get(String(p.position || '').toUpperCase()) ?? 0.5

    let metaBoost = 0
    if (trend) {
      metaBoost += (trend.trendScore ?? 0) * 0.1
      metaBoost += (trend.draftRate - 0.5) * 20
      if (trend.direction === 'up') metaBoost += 3
      if (trend.direction === 'down') metaBoost -= 2
    }
    metaBoost += (posRate - 0.5) * 5

    const adp = p.adp ?? 999
    const valueScore = adp < 999 ? 200 - adp : 0
    const adjustedScore = valueScore + metaBoost

    return {
      name: p.name,
      position: p.position,
      adjustedScore: Math.round(adjustedScore * 10) / 10,
      metaBoost: Math.round(metaBoost * 10) / 10,
    }
  })

  return { playerScores }
}
