import 'server-only'
import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { OutlookLeague, SwingMatchup } from './seasonOutlook'
export type PlayoffPoint = { period: number; probability: number; sampledAt: string }
export type WeeklyPlayoffPath = { leagueId?: string; league: OutlookLeague | null; swing: SwingMatchup | null; points: PlayoffPoint[]; historyUnavailable: boolean; season: number; period: number }
export function validPlayoffPoint(value: unknown): value is PlayoffPoint {
  const p = value as Partial<PlayoffPoint> | null
  return !!p && Number.isInteger(p.period) && p.period! > 0 && typeof p.probability === 'number' && Number.isFinite(p.probability) && p.probability >= 0 && p.probability <= 100 && typeof p.sampledAt === 'string' && Number.isFinite(Date.parse(p.sampledAt))
}
/** Independent per-period snapshots avoid concurrent visits overwriting other weeks. */
export async function readWeeklyPlayoffPath(userId: string, league: OutlookLeague | null, swing: SwingMatchup | null, season: number, period: number, now = new Date()): Promise<WeeklyPlayoffPath> {
  const matches = league?.season === season && league.period === period && period > 0
  const result: WeeklyPlayoffPath = { league: matches ? league : null, swing: matches && swing?.leagueId === league?.leagueId && swing.week >= period ? swing : null, points: [], historyUnavailable: false, season, period }
  if (!matches || !league?.you?.modelled) return result
  const probability = league.you.playoffPct
  const point = { period, probability, sampledAt: league.assumptions.computedAt }
  if (!validPlayoffPoint(point)) return result
  const scope = createHash('sha256').update(JSON.stringify([userId, league.leagueId, season, league.you.rosterId])).digest('hex')
  // Older snapshots did not validate the model period and may carry a delayed provider marker.
  // Preserve those cache entries, but start the displayed history with verified period identity.
  const prefix = `core-week-path:v2:${scope}:`
  try {
    const rows = await prisma.sportsDataCache.findMany({ where: { cacheKey: { startsWith: prefix }, expiresAt: { gt: now } }, select: { data: true }, orderBy: { createdAt: 'desc' }, take: 40 })
    result.points = rows.map(r => r.data).filter(validPlayoffPoint).filter(p => p.period < period).sort((a,b) => a.period - b.period).slice(-15)
    await prisma.sportsDataCache.upsert({ where: { cacheKey: `${prefix}${period}` }, create: { cacheKey: `${prefix}${period}`, data: point as Prisma.InputJsonValue, expiresAt: new Date(now.getTime() + 400 * 86400000) }, update: { data: point as Prisma.InputJsonValue, expiresAt: new Date(now.getTime() + 400 * 86400000) } })
  } catch { result.historyUnavailable = true }
  result.points.push(point)
  return result
}
