/**
 * Soccer FLEX and NCAAB G / F / UTIL best ball seats could not be filled (audit 2026-11-06; fixed on the
 * owner's call 2026-11-07). Soccer's `best_ball` template has a FLEX seat the redraft config gave no
 * eligibility, and NCAAB's G/F seats took only a literal `G`/`F` while UTIL took `PG..C` but not `G`/`F`.
 * These run production's own slots (`buildBestBallSlots` over the sport's `best_ball` template) through
 * the production optimizer.
 */
import { describe, expect, it } from 'vitest'
import { bestBallTemplateSettings, buildBestBallSlots, computeBestBallLineup } from '@/lib/bestball/productionLineup'

const slotsFor = (sport: string) => buildBestBallSlots(sport, bestBallTemplateSettings(sport))
const seat = (sport: string, token: string) => slotsFor(sport).find((s) => s.slot === token)!

describe('soccer best ball', () => {
  it('the FLEX seat accepts outfield players, and is filled', () => {
    expect(seat('SOCCER', 'FLX').eligible).toEqual(expect.arrayContaining(['DEF', 'MID', 'FWD']))
    expect(seat('SOCCER', 'FLX').eligible).not.toContain('GK')
    const players = [
      { playerId: 'gk', position: 'GK', points: 5 },
      ...['d1', 'd2', 'd3'].map((id) => ({ playerId: id, position: 'DEF', points: 4 })),
      ...['m1', 'm2', 'm3', 'm4'].map((id) => ({ playerId: id, position: 'MID', points: 6 })),
      ...['f1', 'f2', 'f3'].map((id) => ({ playerId: id, position: 'FWD', points: 7 })),
      { playerId: 'f4', position: 'FWD', points: 9 },
    ]
    const r = computeBestBallLineup({ slots: slotsFor('SOCCER'), players })
    expect(r.unfilledSlots).toEqual([])
    // 5 + 12 + 24 + (9 + 7 + 7) + FLEX 7 — every seat filled, the fourth forward in FLEX.
    expect(r.total).toBe(71)
  })

  it('a player stored with a detailed code (CB, GKP, ST) is seated in his line', () => {
    const r = computeBestBallLineup({
      slots: slotsFor('SOCCER'),
      players: [
        { playerId: 'gk', position: 'GKP', points: 3 },
        { playerId: 'cb', position: 'CB', points: 4 },
        { playerId: 'st', position: 'ST', points: 6 },
      ],
    })
    expect(r.total).toBe(13)
  })
})

describe('NCAAB best ball', () => {
  it('G and F seats take PG/SG and SF/PF, and UTIL takes G and F', () => {
    expect(seat('NCAAB', 'G').eligible).toEqual(expect.arrayContaining(['G', 'PG', 'SG']))
    expect(seat('NCAAB', 'F').eligible).toEqual(expect.arrayContaining(['F', 'SF', 'PF']))
    expect(seat('NCAAB', 'UTIL').eligible).toEqual(expect.arrayContaining(['G', 'F', 'C', 'PG', 'SG', 'SF', 'PF']))
  })

  it('fills every seat whether positions are stored as G/F or as PG/SG/SF/PF', () => {
    const slots = slotsFor('NCAAB')
    const seats = slots.reduce((n, s) => n + s.count, 0)
    const broad = ['G', 'G', 'G', 'G', 'F', 'F', 'F', 'F', 'C', 'C'].map((position, i) => ({ playerId: `b${i}`, position, points: 10 }))
    const fine = ['PG', 'SG', 'PG', 'SG', 'SF', 'PF', 'SF', 'PF', 'C', 'C'].map((position, i) => ({ playerId: `f${i}`, position, points: 10 }))
    for (const players of [broad, fine]) {
      const r = computeBestBallLineup({ slots, players })
      expect(r.unfilledSlots).toEqual([])
      expect(r.total).toBe(seats * 10)
    }
  })
})

describe('other sports do not move', () => {
  it('NBA, NFL and NHL seat eligibility is exactly the redraft eligibility', async () => {
    const { allowedPositionsForSlot } = await import('@/lib/redraft/lineupValidation')
    for (const sport of ['NBA', 'NFL', 'NHL', 'MLB', 'NCAAF']) {
      for (const s of slotsFor(sport)) expect(s.eligible).toEqual(allowedPositionsForSlot(sport, s.slot))
    }
  })
})
