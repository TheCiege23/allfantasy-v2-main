import { describe, expect, it } from 'vitest'
import { validateCreatePayload } from '@/lib/league-creation/canonical/validateCreateLeague'
const body = { concept: 'redraft', sport: 'NFL', teamCount: 12, draftType: 'snake', scoringPreset: 'fb_half_ppr', leagueName: 'Schedule League' }
describe('creation schedule validation', () => {
  it.each(['America/Chicago', 'UTC', 'Europe/London'])('accepts %s', (timezone) => {
    expect(validateCreatePayload({ ...body, timezone, conceptSetup: { draftDate: '2026-11-08', draftTime: '20:00', draftTimezone: timezone } }).ok).toBe(true)
  })
  it.each([
    { timezone: 'Mars/Olympus' },
    { conceptSetup: { draftTimezone: 'Mars/Olympus' } },
    { conceptSetup: { draftDate: '2026-02-30', draftTime: '20:00' } },
    { conceptSetup: { draftDate: '2026-11-08', draftTime: '25:00' } },
    { conceptSetup: { draftDate: '2026-11-08' } },
    { conceptSetup: { draftTime: '20:00' } },
  ])('rejects invalid or incomplete schedules %j', (invalid) => {
    const result = validateCreatePayload({ ...body, ...invalid })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })
  it('allows API creation without a scheduled date', () => expect(validateCreatePayload(body).ok).toBe(true))
})

describe('dynasty creation guards', () => {
  it('rejects a draft that cannot fit the selected slots', () => {
    expect(validateCreatePayload({ ...body, concept: 'dynasty', conceptSetup: { startupRosterDepth: 80, benchCount: 0, irCount: 0, taxiSlots: 0 } }).ok).toBe(false)
  })
  it.each([{ benchCount: -1 }, { irCount: 2.5 }, { taxiSlots: 'four' }, { faabBudget: -10 }, { regularSeasonWeeks: 500 }, { playoffTeamCount: 20 }])('rejects invalid choices %j', (conceptSetup) => {
    expect(validateCreatePayload({ ...body, concept: 'dynasty', conceptSetup }).ok).toBe(false)
  })
})
