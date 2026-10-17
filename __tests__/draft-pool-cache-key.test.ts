import { describe, expect, it } from 'vitest'
import { compactDraftPoolCacheKey } from '@/lib/draft-room/draftPoolCacheKey'

describe('draft pool cache key', () => {
  it('fits the database column for a real URL-shaped league key without colliding across variants', () => {
    const leagueId = '11a6f2d4-1436-4cc7-865e-68cc583a78f5'
    const fingerprint = 'cfg:starters:DEF|K|QB|RB|TE|WR'
    const urlKey = `api:GET:/api/leagues/${leagueId}/draft/pool:limit=100`
    const key = compactDraftPoolCacheKey(leagueId, fingerprint,
      'dbmerge_v4:nflproj_v2:nflfoundation_v1:nba_roster_v1', urlKey)
    expect(key.length).toBeLessThanOrEqual(191)
    expect(key).toMatch(/^draft_pool:/)
    expect(compactDraftPoolCacheKey(leagueId, fingerprint, 'new-version', urlKey)).not.toBe(key)
    expect(compactDraftPoolCacheKey(leagueId, fingerprint, 'new-version', `${urlKey}:page=2`)).not.toBe(key)
  })
})
