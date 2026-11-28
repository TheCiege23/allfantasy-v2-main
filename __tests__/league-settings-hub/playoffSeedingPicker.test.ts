/**
 * Playoff seeding and the consolation bracket as pickers (owner request, 2026-11-28). The seeding
 * choices are only behaviours the engine has: a stored value it does not recognise seeds as standard.
 */
import { describe, expect, it } from 'vitest'
import { buildGeneralGroups, PLAYOFF_SEEDING_CHOICES } from '@/lib/league-settings-hub/hubModel'
import { getPlayoffSeedingRule } from '@/lib/scoring-engine/scoringSettingsResolved'

const rows = (league: Record<string, unknown>) =>
  buildGeneralGroups({ league: { sport: 'NFL', teamCount: 12, playoffStartWeek: 15, ...league } }, 'redraft').flatMap((g) => g.rows)

describe('playoff seeding picker', () => {
  it('every choice is a distinct behaviour the engine applies', () => {
    const behaviours = PLAYOFF_SEEDING_CHOICES.map((c) => getPlayoffSeedingRule(null, String(c.value)))
    expect(behaviours).toEqual(['default', 'points_only', 'division_winners_first'])
  })

  it('CONTROL: the full editor’s "points for then record" is not one of them; the engine seeds it as standard', () => {
    expect(getPlayoffSeedingRule(null, 'points_for_then_record')).toBe('default')
    expect(PLAYOFF_SEEDING_CHOICES.some((c) => c.value === 'points_for_then_record')).toBe(false)
  })

  it('saves playoffSeedingRule and names the current rule in words', () => {
    const seeding = rows({ playoffSeedingRule: 'points_only' }).find((r) => r.key === 'seeding')!
    expect(seeding.edit?.field).toBe('playoffSeedingRule')
    expect(seeding.edit?.current).toBe('points_only')
    expect(seeding.value).toBe('Points for only')
  })

  it('keeps a stored value outside the choices listed as current', () => {
    const seeding = rows({ playoffSeedingRule: 'record_then_points' }).find((r) => r.key === 'seeding')!
    expect(seeding.edit?.choices.some((c) => c.value === 'record_then_points')).toBe(true)
  })

  it('the consolation bracket offers consolation, toilet bowl and none', () => {
    const lower = rows({ playoffLowerBracket: 'toilet' }).find((r) => r.key === 'lower')!
    expect(lower.edit?.field).toBe('playoffLowerBracket')
    expect(lower.edit?.choices.map((c) => c.value)).toEqual(['consolation', 'toilet', 'none'])
    expect(lower.value).toBe('Toilet bowl')
  })
})
