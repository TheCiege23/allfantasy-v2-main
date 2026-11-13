import { createHash } from 'crypto'
import { prisma } from '@/lib/prisma'
import { getCacheTTL } from './flags'

export type CacheType = 'rankings' | 'trade' | 'simulation' | 'waiver'

function stableStringify(obj: any): string {
  if (obj === null || obj === undefined) return 'null'
  if (typeof obj !== 'object') return JSON.stringify(obj)
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']'
  const keys = Object.keys(obj).sort()
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}'
}

export function computeContextHash(context: any): string {
  const normalized = stableStringify(context)
  return createHash('sha256').update(normalized).digest('hex').slice(0, 64)
}

export async function getCachedResult<T>(
  leagueId: string,
  type: CacheType,
  contextHash: string
): Promise<T | null> {
  try {
    const cached = await prisma.engineSnapshot.findFirst({
      where: {
        leagueId,
        type,
        hash: contextHash,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    })

    if (cached) {
      return cached.payload as T
    }
    return null
  } catch {
    return null
  }
}

export async function setCachedResult(
  leagueId: string,
  type: CacheType,
  contextHash: string,
  payload: any
): Promise<void> {
  try {
    const ttl = getCacheTTL(type as any) || 10 * 60 * 1000
    const expiresAt = new Date(Date.now() + ttl)

    await prisma.engineSnapshot.upsert({
      where: {
        leagueId_type_hash: { leagueId, type, hash: contextHash },
      },
      update: {
        payload,
        expiresAt,
        createdAt: new Date(),
      },
      create: {
        leagueId,
        type,
        hash: contextHash,
        payload,
        expiresAt,
      },
    })
  } catch {}
}

