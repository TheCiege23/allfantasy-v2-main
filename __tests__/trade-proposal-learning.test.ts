import { describe, expect, it } from 'vitest'
import { derivePartnerBehaviorProfiles } from '@/lib/league-trade-engine/proposalLearning'

describe('trade proposal outcome learning', () => {
  it('learns acceptance, countering and preferred incoming asset kinds from real decisions', () => {
    const [profile] = derivePartnerBehaviorProfiles([
      { proposerRosterId: 'a', receiverRosterId: 'b', status: 'processed', items: [{ itemType: 'player', fromRosterId: 'a', toRosterId: 'b' }] },
      { proposerRosterId: 'a', receiverRosterId: 'b', status: 'processed', items: [{ itemType: 'future_pick', fromRosterId: 'a', toRosterId: 'b' }] },
      { proposerRosterId: 'a', receiverRosterId: 'b', status: 'rejected', items: [{ itemType: 'faab', fromRosterId: 'a', toRosterId: 'b' }] },
      { proposerRosterId: 'a', receiverRosterId: 'b', status: 'countered', items: [{ itemType: 'player', fromRosterId: 'a', toRosterId: 'b' }] },
    ], ['b'])
    expect(profile?.sampleSize).toBe(4)
    expect(profile?.acceptanceRate).toBeCloseTo(0.5)
    expect(profile?.counterRate).toBe(0.25)
    expect(profile?.preferredAssetKinds).toEqual(['player', 'pick'])
  })

  it('gives a recorded system suggestion extra weight in the next acceptance model', () => {
    const [profile] = derivePartnerBehaviorProfiles([
      { proposerRosterId: 'a', receiverRosterId: 'b', status: 'processed', metadata: { suggestionId: 'suggested-1' }, items: [{ itemType: 'future_pick', fromRosterId: 'a', toRosterId: 'b' }] },
      { proposerRosterId: 'a', receiverRosterId: 'b', status: 'rejected', items: [{ itemType: 'player', fromRosterId: 'a', toRosterId: 'b' }] },
    ], ['b'])
    expect(profile?.acceptanceRate).toBe(0.6)
    expect(profile?.preferredAssetKinds[0]).toBe('pick')
  })
})
