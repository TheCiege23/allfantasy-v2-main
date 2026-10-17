import { createHash } from 'node:crypto'

/** DraftPoolCache.cacheKey is VARCHAR(191); API URLs must be hashed before persistence. */
export function compactDraftPoolCacheKey(leagueId: string, rosterFp: string,
  version: string, apiCacheKey: string): string {
  const digest = createHash('sha256').update(JSON.stringify([rosterFp, version, apiCacheKey])).digest('hex')
  const key = `draft_pool:${leagueId}:${digest}`
  if (key.length > 191) throw new Error('Draft pool cache key exceeds database limit.')
  return key
}
