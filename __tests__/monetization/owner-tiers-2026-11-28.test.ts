// @vitest-environment node
/**
 * The owner's tier decisions of 2026-11-28, each read off the REAL plan rules (`hasFeatureAccessForPlans`
 * through tierMatrixHarness, so Supreme's inheritance is the shipped one) for all five customer tiers.
 *
 * Route-level gates for the same decisions (the model is never reached when locked) live in
 * __tests__/monetization/owner-tier-gates-2026-11-28.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { TIERS, tiersFor, type Tier } from './tierMatrixHarness'

const AF_INTELLIGENCE_TIERS: Tier[] = ['pro', 'commissioner', 'supreme']

describe('1. AF Intelligence (Chimmy Intelligence) stays AF Commissioner + AF Pro + AF Supreme', () => {
  it('af_intelligence opens for exactly pro, commissioner and supreme — not free, not AF Legacy alone', async () => {
    const opened = await tiersFor('af_intelligence')
    expect(opened).toEqual(AF_INTELLIGENCE_TIERS)
    for (const tier of TIERS) {
      expect([tier, opened.includes(tier)]).toEqual([tier, AF_INTELLIGENCE_TIERS.includes(tier)])
    }
  })

  it('the /core depths that sell it read the af_intelligence key', async () => {
    const { CORE_DEPTH } = await import('@/lib/core-app/coreDepthAccess')
    const readers = Object.entries(CORE_DEPTH)
      .filter(([, v]) => (v as { featureId?: string }).featureId === 'af_intelligence')
      .map(([k]) => k)
    expect(readers.length).toBeGreaterThan(0)
    for (const key of readers) expect([key, await tiersFor(CORE_DEPTH[key as keyof typeof CORE_DEPTH].featureId)]).toEqual([key, AF_INTELLIGENCE_TIERS])
  })
})
