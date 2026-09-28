import { describe, expect, it } from 'vitest'
import { resolveCreatedSeasonWeeks } from '@/lib/redraft/createdSeasonLength'
describe('created season duration', () => {
  it('keeps the sport default without a dynasty config', () => expect(resolveCreatedSeasonWeeks({}, 24)).toBe(24))
  it.each([[12, 4, 1, 14], [14, 6, 1, 17], [20, 6, 1, 23], [14, 6, 2, 20], [12, 7, 1, 15], [14, 0, 1, 14]])('uses %i regular weeks with %i playoff teams and %i weeks per round', (regularSeasonWeeks, playoffTeams, playoffWeeksPerRound, expected) => {
    expect(resolveCreatedSeasonWeeks({ dynastyConfig: { regularSeasonWeeks }, playoffTeams, playoffWeeksPerRound }, 17)).toBe(expected)
  })
})
