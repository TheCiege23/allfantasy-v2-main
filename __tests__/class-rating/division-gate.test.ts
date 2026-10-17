// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  decideDivisionGate,
  divisionBand,
  divisionGateMessage,
  medianDivision,
  type DivisionGateDecision,
} from '@/lib/class-rating/divisionGate'
import type { ManagerClass } from '@/lib/class-rating/reads'

const est = (division: number): ManagerClass => ({
  status: 'established',
  rating: 1500,
  rd: 60,
  games: 50,
  classLevel: division * 5,
  division,
  percentile: 0.5,
  computedAt: '2026-10-01T00:00:00.000Z',
})
const provisional: ManagerClass = { status: 'provisional', rating: 1600, rd: 180, games: 4, establishedAtRd: 100, computedAt: 'x' }
const unrated: ManagerClass = { status: 'unrated' }

describe('decideDivisionGate — the ruling, row by row', () => {
  it('a league with no established member gates nobody', () => {
    expect(decideDivisionGate({ user: est(1), leagueDivision: null, path: 'open' })).toMatchObject({ outcome: 'allow', reason: 'league_unrated' })
  })

  it('in band (±1 division) is a plain allow, on either path', () => {
    for (const d of [2, 3, 4]) {
      expect(decideDivisionGate({ user: est(d), leagueDivision: 3, path: 'open' })).toMatchObject({ outcome: 'allow', reason: 'in_band' })
    }
  })

  it('🛑 an OPEN join outside the band is refused, and the refusal names the band', () => {
    const d = decideDivisionGate({ user: est(1), leagueDivision: 3, path: 'open' })
    expect(d).toEqual({ outcome: 'deny', reason: 'outside_division_band', userDivision: 1, leagueDivision: 3, band: [2, 4] })
    expect(divisionGateMessage(d as Extract<DivisionGateDecision, { outcome: 'deny' }>)).toMatch(/Division 3.*Divisions 2–4.*Division 1/)
  })

  it('🛑 an INVITED player outside the band is allowed and flagged, never blocked', () => {
    expect(decideDivisionGate({ user: est(5), leagueDivision: 1, path: 'invited' })).toEqual({
      outcome: 'allow_flagged',
      reason: 'invited_outside_band',
      userDivision: 5,
      leagueDivision: 1,
    })
  })

  it('an unrated or provisional player is never gated, only flagged — even on an open join', () => {
    expect(decideDivisionGate({ user: unrated, leagueDivision: 5, path: 'open' })).toMatchObject({ outcome: 'allow_flagged', reason: 'unrated_player' })
    expect(decideDivisionGate({ user: provisional, leagueDivision: 5, path: 'open' })).toMatchObject({ outcome: 'allow_flagged', reason: 'provisional_player' })
  })

  it('clamps the band at the ends of the ladder', () => {
    expect(divisionBand(1)).toEqual([1, 2])
    expect(divisionBand(5)).toEqual([4, 5])
    expect(decideDivisionGate({ user: est(3), leagueDivision: 1, path: 'open' }).outcome).toBe('deny')
    const edge = decideDivisionGate({ user: est(5), leagueDivision: 5, path: 'open' })
    expect(edge.outcome).toBe('allow')
  })
})

describe('medianDivision', () => {
  it('is null for nobody, the member for one, and the LOWER median for an even count', () => {
    expect(medianDivision([])).toBeNull()
    expect(medianDivision([4])).toBe(4)
    expect(medianDivision([5, 1, 3])).toBe(3)
    expect(medianDivision([2, 4, 5, 1])).toBe(2)
  })
})
