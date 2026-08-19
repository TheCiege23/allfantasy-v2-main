import { describe, it, expect } from 'vitest'
import { __testables } from '@/lib/stats/cfbdPlayerStats'

const { idpFantasyPoints, dkFantasyPoints, DEFENSIVE_POSITIONS, OFFENSIVE_POSITIONS } = __testables

/**
 * College IDP was never missing from CFBD — the ingest discarded it. The
 * position filter dropped every defender before the row was written, so the
 * table held 5,530 college players and zero defensive stats.
 */
describe('idpFantasyPoints', () => {
  it('scores a real linebacker line', () => {
    // 70 total / 45 solo => 25 assists.
    const pts = idpFantasyPoints({
      'defensive.TOT': 70,
      'defensive.SOLO': 45,
      'defensive.SACKS': 6,
      'defensive.TFL': 11,
      'defensive.PD': 4,
      'defensive.QB HUR': 5,
      'interceptions.INT': 2,
      'fumbles.REC': 1,
    })
    // 45 + 12.5 + 12 + 11 + 4 + 5 + 6 + 2
    expect(pts).toBe(97.5)
  })

  it('derives assists from TOT - SOLO and never goes negative', () => {
    // A source reporting more solo than total would otherwise subtract points.
    const pts = idpFantasyPoints({ 'defensive.TOT': 10, 'defensive.SOLO': 14 })
    expect(pts).toBe(14) // 14 solo, assists floored at 0
  })

  it('returns null with no defensive production rather than 0', () => {
    // 0 reads as "scored zero"; null reads as "no basis". The projection engine
    // treats those differently and the distinction is the honest one.
    expect(idpFantasyPoints({})).toBeNull()
    expect(idpFantasyPoints({ 'receiving.YDS': 400 })).toBeNull()
  })

  it('pays a defensive touchdown like a touchdown', () => {
    expect(idpFantasyPoints({ 'defensive.TD': 1 })).toBe(6)
  })
})

describe('formula selection is by position, not by stats present', () => {
  it('treats every listed defensive position as a defender', () => {
    for (const p of ['DL', 'DE', 'DT', 'NT', 'EDGE', 'LB', 'ILB', 'OLB', 'MLB', 'DB', 'CB', 'S', 'FS', 'SS']) {
      expect(DEFENSIVE_POSITIONS.has(p)).toBe(true)
    }
  })

  it('keeps the offensive skill set intact', () => {
    for (const p of ['QB', 'RB', 'FB', 'WR', 'TE']) {
      expect(OFFENSIVE_POSITIONS.has(p)).toBe(true)
      expect(DEFENSIVE_POSITIONS.has(p)).toBe(false)
    }
  })

  it('does not give a running back IDP credit for a tackle', () => {
    // RBs make tackles after interceptions. Scored by position, that is worth
    // nothing — scored by stats-present, it would quietly pay them.
    const rbLine = { 'rushing.YDS': 1200, 'rushing.TD': 11, 'defensive.SOLO': 2 }
    expect(DEFENSIVE_POSITIONS.has('RB')).toBe(false)
    const asOffense = dkFantasyPoints(rbLine)
    expect(asOffense).toBe(1200 * 0.1 + 11 * 6)
  })

  it('does not give a linebacker offensive credit for a fluke reception', () => {
    const lbLine = { 'defensive.TOT': 60, 'defensive.SOLO': 40, 'receiving.REC': 1, 'receiving.YDS': 3 }
    expect(DEFENSIVE_POSITIONS.has('LB')).toBe(true)
    // 40 solo + 20 assists (60 - 40) * 0.5 = 50. The receiving line is ignored.
    expect(idpFantasyPoints(lbLine)).toBe(50)
  })
})
