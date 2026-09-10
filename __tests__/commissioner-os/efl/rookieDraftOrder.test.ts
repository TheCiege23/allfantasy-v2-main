import { describe, expect, it } from 'vitest'

import {
  EFL_ROOKIE_DRAFT_ORDER_V1,
  resolveEflRookieDraftOrder,
} from '@/lib/commissioner-os/efl/rookieDraftOrder'
import { ALL_OUTCOMES, ALL_TIERS, EXPECTED_ORDER, PREMIER_PLACEMENT, freeze, teamId } from './fixtures'

const resolve = (over: Partial<Parameters<typeof resolveEflRookieDraftOrder>[0]> = {}) =>
  resolveEflRookieDraftOrder({
    leagueId: 'efl-1',
    season: 2027,
    tiers: ALL_TIERS,
    freeze: freeze(),
    freezeState: 'frozen',
    playoffOutcomes: ALL_OUTCOMES,
    tierPlacements: [PREMIER_PLACEMENT],
    ...over,
  })

describe('the published order is data, and it is thirty-two slots', () => {
  it('the spec has 32 entries', () => {
    expect(EFL_ROOKIE_DRAFT_ORDER_V1).toHaveLength(32)
  })

  it('every tier owns exactly eight of them', () => {
    /*
     * ⚠ ASSERTED BECAUSE THE BANDS INTERLEAVE. Slots 1-5 are League 2 and slot 6 is too, but slot 7
     * jumps to League 1 and slot 9 comes back. A transcription slip is invisible by eye and shows
     * up here as a tier with seven or nine.
     */
    for (const t of [1, 2, 3, 4]) {
      expect(EFL_ROOKIE_DRAFT_ORDER_V1.filter((r) => r.tierLevel === t)).toHaveLength(8)
    }
  })
})

describe('a fully resolved season produces the exact published order', () => {
  const result = resolve()

  it('returns exactly 32 unique teams', () => {
    expect(result.slots).toHaveLength(32)
    expect(new Set(result.slots.map((s) => s.teamId)).size).toBe(32)
    expect(result.complete).toBe(true)
    expect(result.conflicts).toEqual([])
  })

  it('matches the constitution slot for slot', () => {
    expect(result.slots.map((s) => s.teamId)).toEqual(EXPECTED_ORDER)
  })

  it('slots 1-5 are League 2 by FROZEN value, lowest first — not by tier rank', () => {
    /*
     * 🛑 THE FIXTURE SCRAMBLES THE FROZEN VALUES AGAINST RANK ON PURPOSE. A resolver that sorted on
     * rank would return ranks 4,5,6,7,8 here. The correct answer is ranks 5,7,6,8,4, which can only
     * come from reading the freeze.
     */
    expect(result.slots.slice(0, 5).map((s) => s.teamId)).toEqual([
      teamId(4, 5),
      teamId(4, 7),
      teamId(4, 6),
      teamId(4, 8),
      teamId(4, 4),
    ])
  })

  it('slots 12-13 are League 1 frozen Reverse Max PF', () => {
    expect(result.slots.slice(11, 13).map((s) => s.teamId)).toEqual([teamId(3, 5), teamId(3, 4)])
    expect(result.slots[11]!.provenance.basis).toBe('reverse_max_pf')
    expect(result.slots[11]!.provenance.tierLevel).toBe(3)
  })

  it('slots 20-21 are Championship frozen Reverse Max PF', () => {
    expect(result.slots.slice(19, 21).map((s) => s.teamId)).toEqual([teamId(2, 4), teamId(2, 5)])
    expect(result.slots[19]!.provenance.basis).toBe('reverse_max_pf')
    expect(result.slots[19]!.provenance.tierLevel).toBe(2)
  })

  it('slot 31 is the Premier League runner-up', () => {
    expect(result.slots[30]!.teamId).toBe(teamId(1, 2))
    expect(result.slots[30]!.provenance.basis).toBe('tier_final_placement')
  })

  it('slot 32 is the Premier League champion', () => {
    expect(result.slots[31]!.teamId).toBe(teamId(1, 1))
  })

  it('every slot carries provenance and a human explanation', () => {
    for (const s of result.slots) {
      expect(s.provenance.basis).toBeTruthy()
      expect(s.provenance.tierLevel).toBeGreaterThanOrEqual(1)
      expect(s.explanation.length).toBeGreaterThan(0)
      expect(s.explanation).toContain(`Pick ${s.slot}`)
    }
  })

  it('a reverse-Max-PF slot cites the frozen number and the metric it used', () => {
    const inputs = result.slots[0]!.provenance.inputs.join(' ')
    expect(inputs).toMatch(/frozen Max PF 100\.00/)
    expect(inputs).toMatch(/optimal_lineup_max_pf/)
  })

  it('is deterministic', () => {
    expect(JSON.stringify(resolve())).toBe(JSON.stringify(resolve()))
  })
})

describe('before the playoffs finish, slots are PENDING and never guessed', () => {
  const partial = resolve({ playoffOutcomes: [], tierPlacements: [] })

  it('is not complete', () => {
    expect(partial.complete).toBe(false)
  })

  it('leaves exactly the playoff-dependent slots open', () => {
    /*
     * Six playoff outcomes (four teams each named in the order) plus the five Premier placings:
     * slots 6, 8, 9, 11, 14, 16, 17, 19, 22, 24, 25, 27 and 28-32.
     */
    expect(partial.pendingSlots).toEqual([6, 8, 9, 11, 14, 16, 17, 19, 22, 24, 25, 27, 28, 29, 30, 31, 32])
  })

  it('the frozen and automatic slots ARE already known', () => {
    expect(partial.slots[0]!.teamId).toBe(teamId(4, 5))
    expect(partial.slots[6]!.teamId).toBe(teamId(3, 8)) // slot 7, auto-relegated
    expect(partial.slots[9]!.teamId).toBe(teamId(4, 1)) // slot 10, auto-promoted
  })

  it('every pending slot says why', () => {
    for (const s of partial.slots.filter((x) => x.status === 'pending')) {
      expect(s.teamId).toBeNull()
      expect(s.pendingReason).toBeTruthy()
      expect(s.explanation).toMatch(/not yet decided/i)
    }
  })

  it('a half-played playoff round fills only what it decided', () => {
    const half = resolve({ playoffOutcomes: ALL_OUTCOMES.filter((o) => o.tierLevel === 4) })
    expect(half.slots[5]!.teamId).toBe(teamId(4, 3)) // slot 6, League 2 promotion loser
    expect(half.slots[8]!.teamId).toBe(teamId(4, 2)) // slot 9, League 2 promotion winner
    expect(half.slots[7]!.status).toBe('pending') // slot 8, League 1 relegation loser
  })
})

describe('the order refuses to build on a missing or contradictory freeze', () => {
  it('with no freeze, every reverse-Max-PF slot is pending and says so', () => {
    const noFreeze = resolve({ freeze: null, freezeState: 'missing' })
    expect(noFreeze.slots[0]!.status).toBe('pending')
    expect(noFreeze.slots[0]!.pendingReason).toMatch(/freeze is not available/i)
    expect(noFreeze.pendingSlots).toContain(12)
    expect(noFreeze.pendingSlots).toContain(20)
  })

  it('a team missing from the freeze is a conflict, not a silent omission', () => {
    /*
     * 🛑 A MISSING VALUE MUST NOT DEFAULT TO ZERO. This is a REVERSE order, so zero is the FIRST
     * pick — a gap does not degrade the order, it hands that team the top of the draft.
     */
    const partialFreeze = freeze()
    partialFreeze.rows = partialFreeze.rows.filter((r) => r.teamId !== teamId(4, 5))
    const result = resolve({ freeze: partialFreeze })
    expect(result.conflicts.join(' ')).toMatch(/no frozen value/i)
    expect(result.complete).toBe(false)
    /* And the team is nowhere in the order rather than sitting at pick 1. */
    expect(result.slots.some((s) => s.teamId === teamId(4, 5))).toBe(false)
  })

  it('a duplicate team across two rules is reported', () => {
    /* Naming the auto-promoted team as the playoff winner claims it twice. */
    const result = resolve({
      playoffOutcomes: [
        ...ALL_OUTCOMES.filter((o) => !(o.kind === 'promotion' && o.tierLevel === 4)),
        { kind: 'promotion', tierLevel: 4, winnerTeamId: teamId(4, 1), loserTeamId: teamId(4, 3) },
      ],
    })
    expect(result.conflicts.join(' ')).toMatch(/appears at both pick/i)
    expect(result.complete).toBe(false)
  })
})

describe('the freeze state travels with the order', () => {
  it('an order built on a READY freeze says so, because it can still move', () => {
    expect(resolve({ freezeState: 'ready' }).freezeState).toBe('ready')
  })

  it('an order built on a FROZEN freeze says so', () => {
    expect(resolve().freezeState).toBe('frozen')
  })
})

describe('the resolver is generic, not EFL-only', () => {
  it('accepts a customised order spec', () => {
    const custom = resolve({
      orderSpec: [
        { kind: 'tier_final_placement', tierLevel: 1, place: 1 },
        { kind: 'auto_promoted', tierLevel: 4 },
      ],
    })
    expect(custom.slots.map((s) => s.teamId)).toEqual([teamId(1, 1), teamId(4, 1)])
    expect(custom.complete).toBe(true)
  })

  it('a spec that asks for more reverse-Max-PF teams than a tier has reports the mismatch', () => {
    /*
     * ⚠ THE DERIVED POOL IS WHAT MAKES THIS LOUD. League 1 has two unclaimed teams; asking for a
     * third means the spec and the playoff counts disagree, and saying so beats leaving a hole.
     */
    const bad = resolve({ orderSpec: [{ kind: 'reverse_max_pf', tierLevel: 3, groupIndex: 3 }] })
    expect(bad.slots[0]!.status).toBe('pending')
    expect(bad.slots[0]!.pendingReason).toMatch(/only 2 team\(s\)/i)
  })
})
