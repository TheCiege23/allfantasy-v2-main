import { describe, expect, it } from 'vitest'

import { parseDescriptiveId } from '@/lib/core-app/descriptiveId'

/*
 * Measured on production 2026-08-29: of 723 distinct starting-slot ids across
 * 600 rosters, 110 (15%) resolve to no player row. They split by platform —
 * sleeper 0%, manual 24%, ESPN 100% — and this parser addresses only the
 * `name:` shape, which is the sole foreign id space readable without a mapping
 * table because the mapping is inside the string.
 */
describe('parseDescriptiveId', () => {
  it('reads the name, position and club out of the id', () => {
    expect(parseDescriptiveId('name:Christian McCaffrey:RB:SF')).toEqual({
      name: 'Christian McCaffrey',
      position: 'RB',
      team: 'SF',
    })
    expect(parseDescriptiveId('name:Pittsburgh Defense:DEF:PIT')).toEqual({
      name: 'Pittsburgh Defense',
      position: 'DEF',
      team: 'PIT',
    })
  })

  /*
   * ⚠ EVERY REJECTION HERE FALLS THROUGH TO "we could not identify this
   * player", which is the correct outcome. A name is the one field a bad parse
   * would put in front of a manager as fact.
   */
  it('rejects every id space it cannot actually read', () => {
    for (const id of [
      '4242335', // ESPN player id
      '-16002', // ESPN D/ST id
      '4034', // a Sleeper id that simply has no row
      '', // nothing at all
      'name:', // the prefix and no payload
      'name:Christian McCaffrey', // truncated
      'name:Christian McCaffrey:RB', // three parts, not four
      'name:Christian McCaffrey:RB:SF:extra', // five parts
      'name::RB:SF', // no name
      'name:   :RB:SF', // whitespace name
    ]) {
      expect(parseDescriptiveId(id), id).toBeNull()
    }
  })

  /* Blank segments become null, never '' — an empty string renders as a gap
     that looks like data we hold. */
  it('returns null rather than an empty string for a missing position or club', () => {
    expect(parseDescriptiveId('name:Some Guy::')).toEqual({
      name: 'Some Guy',
      position: null,
      team: null,
    })
  })

  it('keeps names that contain spaces and punctuation intact', () => {
    expect(parseDescriptiveId("name:Amon-Ra St. Brown:WR:DET")?.name).toBe('Amon-Ra St. Brown')
    expect(parseDescriptiveId('name:Brian Thomas Jr.:WR:JAX')?.name).toBe('Brian Thomas Jr.')
  })
})
