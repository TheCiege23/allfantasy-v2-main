import { describe, expect, it } from 'vitest'
import { resolveLeagueScoringFlags } from '@/lib/shared-services/draft/DraftContextAssembler'

// Phase 31: real finding -- the pre-existing isSF check (rosterSettings.starterSlots.QB >= 2,
// read from League.settings) NEVER fired for a single one of the 65 real leagues in .env.test.
// A direct query found the real signal for Superflex leagues is a SUPER_FLEX/SFLEX/OP slot key
// on League.starters (4 real leagues have this shape: QB:1 + SUPER_FLEX:1), the same real
// pattern lib/agents/anthropic-pipeline.ts's buildLeagueScoringSettings() already uses for AI
// chat context. True 2QB (QB:2, no flex slot) had zero real occurrences, but is a real,
// data-distinguishable, mutually-exclusive shape (0 real leagues have both signals at once).
describe('resolveLeagueScoringFlags — real Superflex vs 2QB disambiguation (Phase 31)', () => {
  it('detects Superflex from a real SUPER_FLEX starter slot key, not QB count', () => {
    const starters = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'SUPER_FLEX', 'BN']
    const result = resolveLeagueScoringFlags({}, starters)
    expect(result.isSF).toBe(true)
    expect(result.is2QB).toBe(false)
  })

  it('detects Superflex from an OP starter slot key (alternate provider naming)', () => {
    const starters = ['QB', 'RB', 'WR', 'TE', 'OP']
    expect(resolveLeagueScoringFlags({}, starters).isSF).toBe(true)
  })

  it('detects real 2QB from two dedicated QB starter slots, no flex slot present', () => {
    const starters = ['QB', 'QB', 'RB', 'RB', 'WR', 'WR', 'TE']
    const result = resolveLeagueScoringFlags({}, starters)
    expect(result.is2QB).toBe(true)
    expect(result.isSF).toBe(false)
  })

  it('the old QB>=2-from-settings-snapshot check no longer misfires as Superflex without a real flex slot', () => {
    // Regression guard: a league with 2 dedicated QB slots must classify as 2QB, not Superflex.
    const starters = ['QB', 'QB', 'RB', 'WR', 'TE']
    const result = resolveLeagueScoringFlags({}, starters)
    expect(result.isSF).toBe(false)
    expect(result.is2QB).toBe(true)
  })

  it('a single-QB league is neither Superflex nor 2QB', () => {
    const starters = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX']
    const result = resolveLeagueScoringFlags({}, starters)
    expect(result.isSF).toBe(false)
    expect(result.is2QB).toBe(false)
  })

  it('falls back to settings.superflex/is_superflex boolean when starters is absent', () => {
    const result = resolveLeagueScoringFlags({ superflex: true }, null)
    expect(result.isSF).toBe(true)
  })

  it('omitting startersJson entirely preserves backward-compatible non-throwing behavior', () => {
    expect(() => resolveLeagueScoringFlags({})).not.toThrow()
  })

  it('reads a real te_premium value from league settings', () => {
    const result = resolveLeagueScoringFlags({ te_premium: 1 }, null)
    expect(result.tePremiumValue).toBe(1)
  })

  it('reads the alternate tePremium settings key', () => {
    const result = resolveLeagueScoringFlags({ tePremium: 0.5 }, null)
    expect(result.tePremiumValue).toBe(0.5)
  })

  it('returns a null tePremiumValue when the setting is absent (the real, honest .env.test state)', () => {
    const result = resolveLeagueScoringFlags({}, null)
    expect(result.tePremiumValue).toBeNull()
  })

  it('malformed settings/starters never throw, degrading to safe defaults', () => {
    // @ts-expect-error deliberately malformed input
    const result = resolveLeagueScoringFlags('not json', 12345)
    expect(result).toEqual({ isSF: false, is2QB: false, scoringFormat: 'standard', tePremiumValue: null })
  })
})
