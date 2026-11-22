/**
 * The best ball rule stamp's scoring fingerprint covers a Fantrax soccer league's goalkeeper weights.
 *
 * `resolveLeagueScoringRules` returns them as `fantraxSoccer` (main, #3459) and the stat scorer applies
 * them to a GK, but the fingerprint hashed only `categories` and `overrides`, so a change to keeper
 * scoring left a sealed week's fingerprint unchanged. Every other league resolves no `fantraxSoccer`, and
 * its fingerprint must not move.
 */
import { describe, expect, it } from 'vitest'
import { scoringRulesFingerprint } from '@/lib/bestball/resultRuleStamp'
import epl from '../../tests/fixtures/fantrax/epl-public-2026.json'

const scoringSystem = structuredClone(epl.info.scoringSystem)

describe('scoring fingerprint', () => {
  it('changes when only a goalkeeper weight changes', () => {
    const base = scoringRulesFingerprint({ sport: 'SOCCER', settings: { fantrax_settings: { scoringSystem } } })
    const groups = structuredClone(scoringSystem.scoringCategorySettings) as Array<{
      group: { code: string }
      configs: Array<{ points: number; scoringCategory: { code: string } }>
    }>
    // Saves score only in the goalkeeper group, and the parser reads them (`keeper.saves`).
    const keeper = groups.find((g) => g.group.code === 'SOCCER_GOALIE')!
    keeper.configs.find((c) => c.scoringCategory.code === 'INDIVIDUAL_SAVES')!.points += 5
    const changed = scoringRulesFingerprint({ sport: 'SOCCER', settings: { fantrax_settings: { scoringSystem: { ...scoringSystem, scoringCategorySettings: groups } } } })
    expect(base).toBeTruthy()
    expect(changed).not.toBe(base)
  })

  it('is unchanged for a league with no Fantrax soccer rules', () => {
    // Pinned before this change: the NFL defaults hash to this value.
    expect(scoringRulesFingerprint({ sport: 'NFL', settings: null })).toBe(NFL_DEFAULT)
  })
})

const NFL_DEFAULT = '71eb1e412769cb57'
