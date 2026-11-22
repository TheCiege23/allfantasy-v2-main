/**
 * A TE premium saved on the commissioner's NFL scoring panel scored nothing: the panel's store
 * (`nfl_scoring_config.rules.te_premium`) never turned on the engine's toggle
 * (`sportConfig.enableTEPremium`), and the `te_premium` category exists only when it is on. Creation and
 * import already derive the toggle from the rules; the panel now does too (dynasty simulation,
 * 2026-11-08: a TE's 10 catches scored the same as a WR's after the panel saved 0.5).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ settings: {} as Record<string, unknown> }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: vi.fn(async () => ({ settings: h.settings })),
      update: vi.fn(async ({ data }: { data: { settings: Record<string, unknown> } }) => {
        h.settings = data.settings
        return {}
      }),
    },
  },
}))

import { saveLeagueNflScoringConfig, buildFullNflScoringConfig } from '@/lib/nfl-scoring'
import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'

const tenCatches = { rec: 10, receptions: 10, rec_yd: 100, receiving_yards: 100 }
const premiumPerCatch = () => {
  const scorer = buildLeagueStatScorer({ sport: 'NFL', settings: h.settings })!
  return (Number(scorer(tenCatches, 'TE')) - Number(scorer(tenCatches, 'WR'))) / 10
}

beforeEach(() => {
  h.settings = { sportConfig: { scoringPreset: 'PPR' } }
})

describe('a TE premium saved on the NFL scoring panel', () => {
  it('scores: a TE catch is worth 0.5 more than a WR catch', async () => {
    await saveLeagueNflScoringConfig('lg', { presetKey: 'custom', rules: { ...buildFullNflScoringConfig('af_default'), te_premium: 0.5 } })
    expect((h.settings.sportConfig as Record<string, unknown>).enableTEPremium).toBe(true)
    expect(premiumPerCatch()).toBeCloseTo(0.5)
  })

  it('removing it on the panel switches it off', async () => {
    await saveLeagueNflScoringConfig('lg', { presetKey: 'custom', rules: { ...buildFullNflScoringConfig('af_default'), te_premium: 0.5 } })
    await saveLeagueNflScoringConfig('lg', { presetKey: 'af_default', rules: buildFullNflScoringConfig('af_default') })
    expect((h.settings.sportConfig as Record<string, unknown>).enableTEPremium).toBe(false)
    expect(premiumPerCatch()).toBe(0)
  })

  it('keeps the rest of the sport config', async () => {
    await saveLeagueNflScoringConfig('lg', { presetKey: 'custom', rules: { te_premium: 1 } })
    expect(h.settings.sportConfig).toMatchObject({ scoringPreset: 'PPR', enableTEPremium: true })
  })
})
