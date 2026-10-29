/** "What AllFantasy did this week" (phase 9, 2026-10-29): the counting, the wording and the week. */
import { describe, expect, it } from 'vitest'
import { countRecapActions, isRecapDay, previousRecapWeek, recapLines, recapMessage } from '@/lib/commissioner-hub/weeklyAutomationRecap'

describe('counting', () => {
  it('maps each recorded action to its line, adds strikes to warnings and the three penalties together', () => {
    const c = countRecapActions(
      [
        { action: 'fill_empty_starters.applied', n: 3 },
        { action: 'integrity.tanking_warning', n: 1 },
        { action: 'integrity.tanking_strike', n: 2 },
        { action: 'integrity.tanking_pick_forfeited', n: 1 },
        { action: 'integrity.tanking_faab_taken', n: 1 },
        { action: 'something.else', n: 99 },
      ],
      4,
    )
    expect(c).toMatchObject({ emptySpotsFilled: 3, tankingWarnings: 3, tankingPenalties: 2, autoPicks: 4, byesBenched: 0 })
  })
})

describe('the message', () => {
  it('lists only what happened, most frequent first, and nothing at all for a quiet week', () => {
    const lines = recapLines(countRecapActions([{ action: 'fill_empty_starters.applied', n: 1 }, { action: 'chimmy_autopilot.claim', n: 5 }], 0))
    expect(lines).toEqual(['made 5 waiver claims for teams on Chimmy autopilot', 'filled 1 empty starting spot'])
    expect(recapLines(countRecapActions([], 0))).toEqual([])
    expect(recapMessage('Dyn', lines)).toEqual({
      title: 'What AllFantasy did this week · Dyn',
      body: 'This week AllFantasy made 5 waiver claims for teams on Chimmy autopilot; and filled 1 empty starting spot. Every action is in the league log.',
    })
    expect(recapMessage('Dyn', ['filled 2 empty starting spots']).body).toBe('This week AllFantasy filled 2 empty starting spots. Every action is in the league log.')
  })
})

describe('the week', () => {
  it('is the Monday-to-Monday week just finished, whatever hour of the next Monday it runs', () => {
    // Monday 2026-11-02, 15:00 UTC → the week of Monday 2026-10-26.
    const w = previousRecapWeek(new Date('2026-11-02T15:00:00Z'))
    expect(w).toEqual({ start: new Date('2026-10-26T00:00:00Z'), end: new Date('2026-11-02T00:00:00Z'), key: '2026-10-26' })
    expect(previousRecapWeek(new Date('2026-11-02T00:00:00Z')).key).toBe('2026-10-26')
    expect(isRecapDay(new Date('2026-11-02T15:00:00Z'))).toBe(true)
    expect(isRecapDay(new Date('2026-11-03T15:00:00Z'))).toBe(false)
  })
})
