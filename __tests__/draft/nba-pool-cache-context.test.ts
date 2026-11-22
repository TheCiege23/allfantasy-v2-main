import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/prisma', () => ({prisma:{}}))
vi.mock('@/lib/draft-room/getResolvedDraftPoolForLeague', () => ({getResolvedDraftPoolForLeague:vi.fn()}))
import { resolveDraftPoolCacheContext } from '@/lib/draft-room/ensureDraftPoolReady'
function template(sport: string) {
  return {sport, hasPersistedRosterSchema:true, allowedPositions:new Set(['PG','C']), template:{slots:[{slotName:'UTIL',starterCount:1,allowedPositions:['PG','C']}]}}
}
describe('live NBA roster cache context', () => {
  it('versions both the exact key and league fallback fingerprint without clearing other sports', async () => {
    const nba=await resolveDraftPoolCacheContext('L',{effectiveLeagueTemplate:template('NBA') as never})
    const nfl=await resolveDraftPoolCacheContext('L',{effectiveLeagueTemplate:template('NFL') as never})
    expect(nba.rosterFp).toBe(`nba-current-roster-v2:${nfl.rosterFp}`)
    expect(nfl.rosterFp).toBe('cfg:starters:C|PG')
    expect(nba.standardCacheKey).not.toBe(nfl.standardCacheKey)
    expect(nba.standardCacheKey.length).toBeLessThanOrEqual(191)
  })
})
