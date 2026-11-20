import 'server-only'
import { prisma } from '@/lib/prisma'
import type { SGProviderSport } from './providerCatalog'
export const sgProviderHealthKey = (sport: string, season: number) => `sg:provider-health:${sport}:${season}`
export async function readSGProviderHealth(sport: string, season: number, now = new Date()) {
  const enabled = process.env.SG_PROVIDER_INGEST_ENABLED === 'true'
  if (!enabled) return { enabled, ready: false, status: 'not_enabled', checkedAt: null as string | null }
  const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey: sgProviderHealthKey(sport, season) } })
  const data = row?.data && typeof row.data === 'object' && !Array.isArray(row.data) ? row.data as Record<string, unknown> : {}
  const checkedAt = typeof data.checkedAt === 'string' ? data.checkedAt : null, checked = checkedAt ? Date.parse(checkedAt) : NaN
  const fresh = Number.isFinite(checked) && checked <= now.getTime() && now.getTime() - checked <= 10 * 60_000
  return { enabled, ready: fresh && data.status === 'healthy', status: !fresh ? 'delayed' : data.status === 'healthy' ? 'healthy' : 'unavailable', checkedAt }
}
export async function saveSGProviderHealth(sport: SGProviderSport, season: number, data: { checkedAt: string; status: 'healthy' | 'failed'; message?: string }) {
  const cacheKey = sgProviderHealthKey(sport, season), expiresAt = new Date(Date.parse(data.checkedAt) + 10 * 60_000)
  await prisma.sportsDataCache.upsert({ where: { cacheKey }, create: { cacheKey, data, expiresAt }, update: { data, expiresAt } })
}
