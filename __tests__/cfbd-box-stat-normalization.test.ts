import { describe, expect, it } from 'vitest'
import { normalizeCfbdBoxStats } from '@/lib/scoring-runtime/cfbdBoxStatNormalization'

describe('CFBD athlete box scoring map', () => {
  it('translates measured box keys and derives only attempts minus makes', () => {
    expect(normalizeCfbdBoxStats({
      'passing.YDS': 250, 'passing.TD': 2, 'passing.INT': 1,
      'kicking.FGA': 3, 'kicking.FGM': 2, 'kicking.XPA': 4, 'kicking.XPM': 3,
      'conversions.PASS': 1,
    })).toMatchObject({ pass_yds: 250, pass_td: 2, pass_int: 1,
      fg_made: 2, fg_miss: 1, xp_made: 3, xp_miss: 1, pass_2pt: 1, two_pt: 1 })
  })

  it('does not invent missing team defense or forced-fumble totals', () => {
    const stats = normalizeCfbdBoxStats({ 'defensive.SOLO': 5, 'defensive.SACKS': 1 })
    expect(stats).toMatchObject({ idp_solo: 5, idp_sack: 1 })
    expect(stats).not.toHaveProperty('def_fr')
    expect(stats).not.toHaveProperty('idp_ff')
    expect(normalizeCfbdBoxStats({ 'unknown.field': 3 })).toBeNull()
  })
})
