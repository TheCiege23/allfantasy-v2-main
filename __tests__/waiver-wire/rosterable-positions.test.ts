/**
 * A league's Players list offers only positions the league can start. Owner report, 2026-11-22: a
 * QB / RB / WR / TE / FLEX league listed a defensive lineman and offered K and DEF as filters.
 */
import { describe, expect, it } from 'vitest'
import { positionIsRosterable, rosterablePositions } from '@/lib/waiver-wire/rosterablePositions'

describe('rosterablePositions', () => {
  it('is the set the roster route reports', () => {
    expect([...rosterablePositions(['QB', 'RB', 'WR', 'te', ' RB '])!].sort()).toEqual(['QB', 'RB', 'TE', 'WR'])
  })

  it('is null when the league did not say, so nothing is hidden', () => {
    for (const value of [undefined, null, [], [''], 'QB', { QB: 1 }]) expect(rosterablePositions(value)).toBeNull()
  })
})

describe('positionIsRosterable', () => {
  const noKickerNoDefense = rosterablePositions(['QB', 'RB', 'WR', 'TE'])

  it('keeps the positions the league starts', () => {
    for (const p of ['QB', 'RB', 'WR', 'TE', 'wr']) expect(positionIsRosterable(p, noKickerNoDefense)).toBe(true)
  })

  it('leaves out a kicker, a team defense and a defender in a league with no slot for them', () => {
    for (const p of ['K', 'DEF', 'DST', 'DL', 'DE', 'LB', 'CB', 'S']) expect(positionIsRosterable(p, noKickerNoDefense)).toBe(false)
  })

  it("reads a player's position against the slot it fills", () => {
    const idp = rosterablePositions(['QB', 'DL', 'LB', 'DB', 'K', 'DEF'])
    for (const p of ['DE', 'DT', 'EDGE', 'CB', 'S', 'FS', 'ILB', 'PK', 'DST', 'D/ST']) expect(positionIsRosterable(p, idp)).toBe(true)
    expect(positionIsRosterable('RB', idp)).toBe(false)
  })

  it('hides no one when the league did not say, or the player has no position on file', () => {
    expect(positionIsRosterable('K', null)).toBe(true)
    expect(positionIsRosterable(null, noKickerNoDefense)).toBe(true)
    expect(positionIsRosterable('', noKickerNoDefense)).toBe(true)
  })
})
