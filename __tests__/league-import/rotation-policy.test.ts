/**
 * The two-bucket rotation: the tail, and the leagues people are actually looking at.
 *
 * ── 🛑 BOTH SINGLE-BUCKET DESIGNS ARE WRONG, AND EACH LOOKS RIGHT ────────────────────────────
 *
 * Pure staleness is fair in the only unit it can measure: a league nobody has opened since June
 * outranks the one its owner has open right now.
 *
 * Pure demand is worse, and worse in a way nobody would report — it refreshes the same handful
 * of active leagues forever and never reaches the tail, and a drifting tail is invisible
 * precisely because nobody is looking at it. It would read as healthy from every angle.
 *
 * So the assertions below are mostly about the INTERACTION, not either bucket alone.
 */
import { describe, expect, it } from 'vitest'

import { STARVED_RESERVE, mergeRotation } from '@/lib/league-import/rotationPolicy'

const starved = (n: number, p = 's') => Array.from({ length: n }, (_, i) => `${p}${i + 1}`)
const demand = (n: number) => Array.from({ length: n }, (_, i) => `d${i + 1}`)

describe('mergeRotation', () => {
  it('reserves the floor for the tail before demand gets anything', () => {
    const r = mergeRotation({ starvedLeagueIds: starved(30), demandLeagueIds: demand(30), cap: 25 })
    expect(r.leagueIds).toHaveLength(25)
    expect(r.fromStarved).toBe(STARVED_RESERVE)
    expect(r.fromDemand).toBe(25 - STARVED_RESERVE)
    // The reserved slots go to the OLDEST, in order.
    expect(r.leagueIds.slice(0, 3)).toEqual(['s1', 's2', 's3'])
  })

  it('🛑 demand cannot lock the tail out, however many leagues are being viewed', () => {
    const r = mergeRotation({ starvedLeagueIds: starved(30), demandLeagueIds: demand(500), cap: 25 })
    expect(r.fromStarved).toBe(STARVED_RESERVE)
    expect(r.fromStarved).toBeGreaterThan(0)
  })

  it('🛑 the tail cannot lock demand out either — unused starved slots flow to demand', () => {
    // Only 3 leagues are starved, so the other 22 slots must go to demand rather than idle.
    const r = mergeRotation({ starvedLeagueIds: starved(3), demandLeagueIds: demand(30), cap: 25 })
    expect(r.fromStarved).toBe(3)
    expect(r.fromDemand).toBe(22)
    expect(r.leagueIds).toHaveLength(25)
  })

  it('and unused DEMAND slots flow back to the tail', () => {
    // Nobody has opened anything yet — the whole fire should still do 25 leagues of backlog.
    const r = mergeRotation({ starvedLeagueIds: starved(40), demandLeagueIds: [], cap: 25 })
    expect(r.fromStarved).toBe(25)
    expect(r.fromDemand).toBe(0)
  })

  it('⚠ an empty demand bucket is the NORMAL early state, not an edge case', () => {
    // League.lastViewedAt is brand new. Before anyone opens a league this degrades exactly to
    // the staleness rotation it replaced — which is correct behaviour, not a fallback.
    const r = mergeRotation({ starvedLeagueIds: starved(10), demandLeagueIds: [], cap: 25 })
    expect(r.leagueIds).toEqual(starved(10))
  })

  it('🛑 a league that is BOTH starved and in demand takes ONE slot, not two', () => {
    // The highest-priority league there is: opened yesterday, still not refreshed. Counting it
    // twice would spend two of the fire's 25 slots refreshing it once.
    const r = mergeRotation({
      starvedLeagueIds: ['a', 'b', 'c'],
      demandLeagueIds: ['b', 'z'],
      cap: 25,
    })
    expect(r.leagueIds).toEqual(['a', 'b', 'c', 'z'])
    expect(new Set(r.leagueIds).size).toBe(r.leagueIds.length)
  })

  it('never exceeds the cap', () => {
    const r = mergeRotation({ starvedLeagueIds: starved(100), demandLeagueIds: demand(100), cap: 7 })
    expect(r.leagueIds).toHaveLength(7)
    expect(r.fromStarved + r.fromDemand).toBe(7)
  })

  it('handles a zero cap and empty inputs without inventing work', () => {
    expect(mergeRotation({ starvedLeagueIds: starved(5), demandLeagueIds: demand(5), cap: 0 }).leagueIds).toEqual([])
    expect(mergeRotation({ starvedLeagueIds: [], demandLeagueIds: [], cap: 25 }).leagueIds).toEqual([])
  })

  it('a reserve larger than the cap does not overflow it', () => {
    const r = mergeRotation({
      starvedLeagueIds: starved(30),
      demandLeagueIds: demand(30),
      cap: 5,
      starvedReserve: 99,
    })
    expect(r.leagueIds).toHaveLength(5)
    expect(r.fromDemand).toBe(0)
  })
})

describe('the control: these assertions can fail', () => {
  it('demand ordering actually changes the selection', () => {
    // Without this, every test above would pass against a function that ignored the demand
    // bucket entirely and returned starved leagues only — which is the exact regression that
    // would make this whole change a no-op while every other assertion stayed green.
    const withDemand = mergeRotation({ starvedLeagueIds: starved(3), demandLeagueIds: demand(10), cap: 25 })
    const without = mergeRotation({ starvedLeagueIds: starved(3), demandLeagueIds: [], cap: 25 })
    expect(withDemand.leagueIds).not.toEqual(without.leagueIds)
    expect(withDemand.leagueIds.length).toBeGreaterThan(without.leagueIds.length)
  })
})
