/** Which native leagues get the tap-to-swap lineup screen (lib/league/native/lineupScreenRouting.ts). */
import { describe, expect, it } from 'vitest'
import { hasCollegeRoster, usesNativeLineupScreen } from '@/lib/league/native/lineupScreenRouting'

describe('usesNativeLineupScreen', () => {
  it('redraft and dynasty leagues get it, in every sport (the variant carries no sport)', () => {
    for (const leagueVariant of [null, 'standard', 'dynasty', 'DYNASTY', 'superflex']) {
      expect(usesNativeLineupScreen({ leagueVariant, idp: false, bestBall: false })).toBe(true)
    }
  })

  it('devy and C2C keep the classic Team tab, where the devy squad and college rights move', () => {
    for (const leagueVariant of ['devy', 'devy_dynasty', 'c2c', 'merged_devy_c2c', 'Devy_Dynasty']) {
      expect(hasCollegeRoster(leagueVariant)).toBe(true)
      expect(usesNativeLineupScreen({ leagueVariant, idp: false, bestBall: false })).toBe(false)
    }
  })

  it('IDP and best ball keep the classic Team tab', () => {
    expect(usesNativeLineupScreen({ leagueVariant: 'dynasty', idp: true, bestBall: false })).toBe(false)
    expect(usesNativeLineupScreen({ leagueVariant: 'dynasty', idp: false, bestBall: true })).toBe(false)
  })
})
