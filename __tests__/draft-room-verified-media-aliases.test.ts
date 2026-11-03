import { describe, expect, it } from 'vitest'
import { reconcileCurrentProRows } from '@/lib/draft-room/currentProRoster'
import { verifiedMediaAliasMatches } from '@/lib/draft-room/verifiedMediaAliases'
const now = Date.parse('2026-10-29T02:00:00Z')
const dates = { fetchedAt: new Date(now), expiresAt: new Date(now + 86400000) }
const ri = { ...dates, source: 'rolling_insights', externalId: '2564', name: 'Peter Alonso', dob: '1994-12-07', team: 'Baltimore Orioles', position: '1B', status: 'ACT', imageUrl: null }
const photo = { ...dates, source: 'thesportsdb', externalId: 'tsdb_34185729', name: 'Pete Alonso', dob: '1994-12-07', team: 'Baltimore Orioles', position: '1B', status: 'Active', imageUrl: 'https://r2.thesportsdb.com/images/media/player/cutout/fixture.png' }
describe('verified provider media aliases', () => {
  it('adds a verified nickname portrait while preserving the scoring identity and role', () => {
    const result = reconcileCurrentProRows('MLB', [ri], [photo], true, now)
    expect(result).toEqual([{ ...ri, imageUrl: photo.imageUrl }])
  })
  it('rejects a reused ID, changed name, conflicting birthday, source or sport', () => {
    for (const candidate of [{ ...photo, dob: '1993-12-07' }, { ...photo, name: 'Other Alonso' }, { ...photo, externalId: 'tsdb_wrong' }, { ...photo, source: 'sleeper' }]) {
      expect(verifiedMediaAliasMatches('MLB', ri, candidate)).toBe(false)
      expect(reconcileCurrentProRows('MLB', [ri], [candidate], true, now)[0].imageUrl).toBeNull()
    }
    expect(verifiedMediaAliasMatches('NBA', ri, photo)).toBe(false)
  })
  it('does not promote an inactive player, adopt a new position, or relax suffix matching', () => {
    expect(reconcileCurrentProRows('MLB', [{ ...ri, status: 'INACT' }], [photo], true, now)).toEqual([])
    const modifiedRole = { ...photo, position: 'P', team: 'Other Team' }
    expect(reconcileCurrentProRows('MLB', [ri], [modifiedRole], true, now)[0]).toMatchObject({ externalId: '2564', position: '1B', team: ri.team })
  })
})
