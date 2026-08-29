import { describe, expect, it } from 'vitest'

import { startingSlotTemplate } from '@/lib/core-app/rosterSlots'

/*
 * Two platforms write `roster_positions` and the shapes are not
 * interchangeable. Reading one as the other silently mislabels every slot in a
 * lineup, which is invisible for as long as the players in it cannot be named —
 * which is exactly how it survived: ESPN rosters rendered "Player we could not
 * identify" in every row, so nobody could see that the row was also labelled
 * with the wrong slot.
 */
describe('startingSlotTemplate', () => {
  it('reads the Sleeper shape, dropping bench entries', () => {
    expect(
      startingSlotTemplate({
        roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN', 'IR'],
      }),
    ).toEqual(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'])
  })

  it('applies the slot aliases', () => {
    expect(startingSlotTemplate({ roster_positions: ['SUPER_FLEX', 'WRRB_FLEX', 'DST'] })).toEqual([
      'SFLEX',
      'FLEX',
      'DEF',
    ])
  })

  /*
   * ⚠ THE LOAD-BEARING ONE. This is ESPN's real production shape. Read as a
   * Sleeper template it is nine labels for an eight-man lineup, and "BE:7" /
   * "IR:1" do not match the bench filter — so bench and IR were handed out as
   * STARTING slot names. On a live roster that put Ja'Marr Chase in "QB:1" and
   * a kicker in "D/ST:1".
   *
   * Expanding the pairs does not rescue it either: expanded, the template leads
   * with QB while that roster's `starters` array leads with a WR. There is
   * nothing to align against, so the only honest answer is null.
   */
  it('refuses the ESPN SLOT:COUNT shape rather than mislabelling a lineup', () => {
    expect(
      startingSlotTemplate({
        roster_positions: ['QB:1', 'RB:2', 'WR:2', 'TE:1', 'D/ST:1', 'K:1', 'BE:7', 'IR:1', 'FLEX:1'],
      }),
    ).toBeNull()
  })

  it('refuses even when only one entry is compressed', () => {
    expect(startingSlotTemplate({ roster_positions: ['QB', 'RB', 'WR:2'] })).toBeNull()
  })

  it('returns null for a league carrying no template at all', () => {
    expect(startingSlotTemplate(null)).toBeNull()
    expect(startingSlotTemplate({})).toBeNull()
    expect(startingSlotTemplate({ roster_positions: [] })).toBeNull()
    expect(startingSlotTemplate({ roster_positions: ['BN', 'IR'] })).toBeNull()
  })
})
