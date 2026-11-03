import { describe, expect, it } from 'vitest'
import { buildObservedAdpIdentityIndex, observedAdpCanonicalId, observedAdpForPlayer } from '@/lib/draft-room/observedAdpIdentity'
const id = '20b2d613-c3ad-461c-b376-6279a9b92635'
const identity = { id, sport: 'NBA', canonicalName: 'Luka Doncic', rollingInsightsId: '834' }
const row = { name: 'Luka Doncic', adp: 3.38, canonicalPlayerIds: ['NBA:af:' + id] }
describe('observed market ADP identity bridge', () => {
  it('keeps ADP on the verified athlete when provider lineup positions differ', () => {
    const index = buildObservedAdpIdentityIndex('NBA', [row], [identity])
    expect(observedAdpForPlayer(index, '834', 'Luka Doncic')).toBe(3.38)
    expect(observedAdpForPlayer(index, '835', 'Luka Doncic')).toBeNull()
    expect(observedAdpForPlayer(index, '834', 'Another Player')).toBeNull()
  })
  it('refuses another sport, an unregistered ID and numeric provider-ID collisions', () => {
    expect(buildObservedAdpIdentityIndex('NHL', [row], [identity]).size).toBe(0)
    expect(buildObservedAdpIdentityIndex('NBA', [row], []).size).toBe(0)
    expect(observedAdpCanonicalId('NBA', '834')).toBeNull()
    expect(observedAdpCanonicalId('NFL', 'NFL:af:' + id)).toBeNull()
  })
  it('refuses name disagreement and conflicting ranks for a registry athlete', () => {
    expect(buildObservedAdpIdentityIndex('NBA', [row], [{ ...identity, canonicalName: 'Another Player' }]).size).toBe(0)
    expect(buildObservedAdpIdentityIndex('NBA', [row, { ...row, adp: 90 }], [identity]).size).toBe(0)
    expect(buildObservedAdpIdentityIndex('NBA', [row, row], [identity]).size).toBe(1)
  })
})
