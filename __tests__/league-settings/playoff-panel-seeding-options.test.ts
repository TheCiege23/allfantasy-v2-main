/**
 * The full Playoffs editor offered "Points-for then record", which the engine seeds as standard: a dead
 * option (owner decision 2026-11-28: replace it with "Points for only"). Every option must be a distinct
 * order the engine applies, so a dead one cannot come back.
 */
import { describe, expect, it } from 'vitest'
import { SEEDING_RULES } from '@/components/app/settings/PlayoffSettingsPanel'
import { PLAYOFF_SEEDING_CHOICES } from '@/lib/league-settings-hub/hubModel'
import { getPlayoffSeedingRule } from '@/lib/scoring-engine/scoringSettingsResolved'

describe('the Playoffs editor seeding options', () => {
  it('each is a distinct order the engine applies', () => {
    const behaviours = SEEDING_RULES.map((r) => getPlayoffSeedingRule(null, r.value))
    expect(new Set(behaviours).size).toBe(SEEDING_RULES.length)
  })

  it('no longer offers points_for_then_record, and offers points_only', () => {
    const values = SEEDING_RULES.map((r) => r.value as string)
    expect(values).not.toContain('points_for_then_record')
    expect(values).toContain('points_only')
  })

  it('matches the League Setup picker, so the two editors never disagree', () => {
    expect(SEEDING_RULES.map((r) => r.value).sort()).toEqual(PLAYOFF_SEEDING_CHOICES.map((c) => String(c.value)).sort())
  })
})
