import { describe, expect, it } from 'vitest'

import { describeSeats, lineupGainCalculator, type LineupMember } from '@/lib/trade-intel/faabLineupGain'
import { lineupSeatsFromSettings } from '@/lib/core-app/slotEligibility'
import { assumedOneChopHorizon } from '@/lib/trade-intel/survivorSchedule'

/*
 * The lineup a free agent must beat is the league's REAL one. Shape and roster below mirror the
 * guillotine league where this went wrong live (2026-09-28): FLEX ×4 + SUPER_FLEX, one receiver on
 * the roster. Values are illustrative, names synthetic.
 */
const SLOTS = { roster_positions: ['FLEX', 'FLEX', 'FLEX', 'FLEX', 'SUPER_FLEX', 'BN', 'BN', 'BN'] }

const ROSTER: LineupMember[] = [
  { id: 'wr1', name: 'Alpha WR', position: 'WR', value: 7000 },
  { id: 'rb1', name: 'Bravo RB', position: 'RB', value: 5000 },
  { id: 'rb2', name: 'Charlie RB', position: 'RB', value: 4000 },
  { id: 'te1', name: 'Delta TE', position: 'TE', value: 3000 },
  { id: 'qb1', name: 'Echo QB', position: 'QB', value: 4500 },
  { id: 'rb3', name: 'Foxtrot RB', position: 'RB', value: 2000 },
  { id: 'te2', name: 'Golf TE', position: 'TE', value: 1000 },
  { id: 'te3', name: 'Hotel TE', position: 'TE', value: 900 },
]

const seats = () => {
  const s = lineupSeatsFromSettings(SLOTS)
  if (!s) throw new Error('fixture slots must be readable')
  return s
}

describe('faabLineupGain', () => {
  it('a receiver who would not crack a FLEX lineup adds nothing — the case that bid $31 live', () => {
    const gain = lineupGainCalculator(seats(), ROSTER)
    // Under the old fixed 1/2/2/1 table this roster had ONE WR, so the phantom second WR seat made
    // his full 759 the "upgrade". Against the real lineup he must beat the weakest FLEX starter (3000).
    expect(gain({ id: 'fa', name: 'Free WR', position: 'WR', value: 759 })).toEqual({ gain: 0, displacedName: null })
  })

  it('a receiver who does crack it is worth only his margin over the man he benches, who is named', () => {
    const gain = lineupGainCalculator(seats(), ROSTER)
    expect(gain({ id: 'fa', name: 'Free WR', position: 'WR', value: 3500 })).toEqual({ gain: 500, displacedName: 'Delta TE' })
  })

  it('a quarterback can only take the SUPER_FLEX seat, so he is measured against the quarterback there', () => {
    const gain = lineupGainCalculator(seats(), ROSTER)
    expect(gain({ id: 'fa', name: 'Free QB', position: 'QB', value: 6000 })).toEqual({ gain: 1500, displacedName: 'Echo QB' })
  })

  it('a player filling a seat nobody can fill is worth his full value, and displaces nobody', () => {
    const gain = lineupGainCalculator(seats(), ROSTER.filter((p) => p.position !== 'QB'))
    // Without a QB the SUPER_FLEX takes the best non-starter (Foxtrot 2000), so a QB beats HIM.
    expect(gain({ id: 'fa', name: 'Free QB', position: 'QB', value: 6000 })).toEqual({ gain: 4000, displacedName: 'Foxtrot RB' })
    const tiny = lineupGainCalculator(seats(), ROSTER.slice(0, 3))
    expect(tiny({ id: 'fa', name: 'Free TE', position: 'TE', value: 800 })).toEqual({ gain: 800, displacedName: null })
  })

  it('names the lineup it measured against', () => {
    expect(describeSeats(seats())).toBe('FLEX ×4, SUPER_FLEX')
  })
})

describe('assumedOneChopHorizon', () => {
  it('16 teams alive, one chop a week: about 8.4 weeks to play, counting this one', () => {
    const h = assumedOneChopHorizon(16)
    // sum over 16,15,…,2 of j/16 = 135/16.
    expect(h?.expectedWeeksAlive).toBeCloseTo(135 / 16, 10)
    expect(h?.basis).toMatch(/^16 teams still alive and no published schedule, so one chop a week is assumed: about 8\.4 more weeks/)
  })

  it('the final two teams get the whole budget, and one team or none is not a horizon', () => {
    expect(assumedOneChopHorizon(2)?.expectedWeeksAlive).toBe(1)
    expect(assumedOneChopHorizon(1)).toBeNull()
    expect(assumedOneChopHorizon(0)).toBeNull()
  })
})
