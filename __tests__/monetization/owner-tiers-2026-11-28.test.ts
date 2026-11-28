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

describe('2. the draft-room AI pick explanation is AF Pro + AF Legacy + AF Supreme', () => {
  it('draft_room_ai_explanation opens for exactly pro, legacy and supreme', async () => {
    expect(await tiersFor('draft_room_ai_explanation')).toEqual(['pro', 'legacy', 'supreme'])
  })

  it('the draft-room surfaces read it: the route and both lock cards', async () => {
    const { readFileSync } = await import('node:fs')
    expect(readFileSync('app/api/draft/recommend/route.ts', 'utf8')).toMatch(/^\s*featureId: 'draft_room_ai_explanation',$/m)
    for (const file of ['components/app/draft-room/DraftHelperPanel.tsx', 'components/app/draft-room/DraftHelperRedraftLayout.tsx']) {
      const src = readFileSync(file, 'utf8')
      expect([file, src.includes('featureId="draft_room_ai_explanation"')]).toEqual([file, true])
      expect([file, src.includes('featureId="draft_prep"')]).toEqual([file, false])
    }
  })

  it('draft_prep (now only the War Room card) is unchanged: AF Legacy, and Supreme through it', async () => {
    expect(await tiersFor('draft_prep')).toEqual(['legacy', 'supreme'])
  })
})
