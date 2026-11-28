import { describe, expect, it } from 'vitest'
import { mapFantraxLineupSlots } from '@/lib/league-import/fantrax/fantraxProSports'

/*
 * Road To Glory NCAA Football (140 teams) starts LB 1 + OLB 1. OLB had no equivalent here, and the football
 * lineup mapper is all-or-nothing, so the whole 16-seat lineup was dropped on import (2026-11-26).
 * Slot settings below are that league's real ones.
 */
const RTG_NCAAF = {
  positionConstraints: {
    RB: { maxActive: 2 }, DT: { maxActive: 1 }, TE: { maxActive: 1 }, DE: { maxActive: 1 }, S: { maxActive: 1 },
    OLB: { maxActive: 1 }, SFX: { maxActive: 2 }, LB: { maxActive: 1 }, ID: { maxActive: 1 }, WR: { maxActive: 2 },
    RWT: { maxActive: 2 }, CB: { maxActive: 1 },
  },
  maxTotalPlayers: 32,
  maxTotalActivePlayers: 16,
  maxTotalReservePlayers: 16,
}

describe('Fantrax linebacker seats', () => {
  it('maps the Road To Glory NCAA Football lineup whole: OLB and LB are two LB seats', () => {
    const out = mapFantraxLineupSlots('NCAAF', RTG_NCAAF)
    expect(out.gaps).toEqual([])
    const by = Object.fromEntries(out.slots.map((s) => [s.position, s.count]))
    expect(by.LB).toBe(2)
    expect(by.SUPER_FLEX).toBe(2)
    expect(by.IDP_FLEX).toBe(1)
    const starters = out.slots.filter((s) => s.position !== 'BN').reduce((n, s) => n + s.count, 0)
    expect(starters).toBe(16)
  })

  it('an inside linebacker seat is a linebacker seat too', () => {
    const out = mapFantraxLineupSlots('NFL', { positionConstraints: { ILB: { maxActive: 2 } }, maxTotalActivePlayers: 2, maxTotalPlayers: 4 })
    expect(out.slots).toEqual(expect.arrayContaining([{ position: 'LB', count: 2 }]))
  })

  it('[control] a code still unknown here drops the lineup with a named gap', () => {
    const out = mapFantraxLineupSlots('NCAAF', { positionConstraints: { ER: { maxActive: 1 } }, maxTotalActivePlayers: 1 })
    expect(out.slots).toEqual([])
    expect(out.gaps[0]).toMatch(/ER/)
  })
})
