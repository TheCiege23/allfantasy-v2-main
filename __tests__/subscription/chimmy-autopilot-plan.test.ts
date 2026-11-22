/**
 * Chimmy running a team (drafting for it and managing it) is AF Pro and AF Supreme — owner decision
 * 2026-11-22. It was AF Commissioner; the other commissioner tools stay there.
 */
import { describe, expect, it } from 'vitest'
import { getAcceptedPlansForFeature, hasFeatureAccessForPlans } from '@/lib/subscription/feature-access'
import { ENTITLEMENTS } from '@/lib/monetization/entitlements'

describe('commissioner_chimmy_autopilot', () => {
  it('is accepted on AF Pro and AF Supreme, not AF Commissioner alone', () => {
    expect(getAcceptedPlansForFeature('commissioner_chimmy_autopilot').sort()).toEqual(['pro', 'supreme'])
    expect(hasFeatureAccessForPlans(['pro'], 'active', 'commissioner_chimmy_autopilot')).toBe(true)
    expect(hasFeatureAccessForPlans(['supreme'], 'active', 'commissioner_chimmy_autopilot')).toBe(true)
    expect(hasFeatureAccessForPlans(['commissioner'], 'active', 'commissioner_chimmy_autopilot')).toBe(false)
  })

  it('upgrades to AF Pro', () => {
    expect(ENTITLEMENTS.commissioner_chimmy_autopilot).toMatchObject({ upgradeUrl: '/pro', upgradeLabel: 'Get AF Pro' })
  })

  it('leaves the other commissioner tools on AF Commissioner', () => {
    expect(getAcceptedPlansForFeature('commissioner_draft_as_me').sort()).toEqual(['commissioner', 'supreme'])
  })
})
