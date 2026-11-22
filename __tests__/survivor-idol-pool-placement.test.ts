import { describe, expect, it } from 'vitest'
import {
  SURVIVOR_WAIVER_IMMUNITY_IDOLS,
  chooseWaiverImmunityPlayers,
  computeSurvivorIdolPoolPlacement,
  orderPoolCandidates,
} from '@/lib/survivor/survivorIdolPoolPlacement'

/** Idols hide on random DRAFT-POOL players at draft lock (owner's call, 2026-10-20). */
const pool = Array.from({ length: 60 }, (_, i) => ({ playerId: `p${i}`, playerName: `Player ${i}`, adp: i + 1 }))

describe('idol pool placement', () => {
  it('orders the pool by ADP, drops repeats and blanks, and puts unknown ADP last', () => {
    const out = orderPoolCandidates([{ playerId: 'b', adp: 9 }, { playerId: 'a', adp: 2 }, { playerId: 'a', adp: 2 }, { playerId: '', adp: 1 }, { playerId: 'c', adp: null }])
    expect(out.map(c => c.playerId)).toEqual(['a', 'b', 'c'])
  })

  it('places one idol per sealed type on distinct players inside the top-of-pool window, deterministically', () => {
    const types = ['vote_shield', 'vote_steal', 'vote_steal', 'triple_steal', 'extra_vote', 'vote_shield', 'extra_vote']
    const plan = computeSurvivorIdolPoolPlacement({ candidates: pool, powerTypes: types, windowSize: 16 * 2, seed: 42 })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.placements).toHaveLength(7)
    expect(new Set(plan.placements.map(p => p.playerId)).size).toBe(7)
    expect(plan.placements.every(p => Number(p.playerId.slice(1)) < 32)).toBe(true)
    expect(plan.placements.map(p => p.powerType).sort()).toEqual([...types].sort())
    const again = computeSurvivorIdolPoolPlacement({ candidates: pool, powerTypes: types, windowSize: 32, seed: 42 })
    expect(again).toEqual(plan)
    const other = computeSurvivorIdolPoolPlacement({ candidates: pool, powerTypes: types, windowSize: 32, seed: 43 })
    expect(other).not.toEqual(plan)
  })

  it('refuses without types or with a pool smaller than the idol count', () => {
    expect(computeSurvivorIdolPoolPlacement({ candidates: pool, powerTypes: [], windowSize: 10, seed: 1 })).toMatchObject({ ok: false, code: 'no_types' })
    expect(computeSurvivorIdolPoolPlacement({ candidates: pool.slice(0, 3), powerTypes: ['a', 'b', 'c', 'd'], windowSize: 10, seed: 1 })).toMatchObject({ ok: false, code: 'pool_too_small' })
  })

  it('waiver immunity: two undrafted players from the best of the wire, never one already carrying an idol', () => {
    const undrafted = pool.slice(20)
    const chosen = chooseWaiverImmunityPlayers({ undrafted, excludePlayerIds: new Set(['p20', 'p21']), count: SURVIVOR_WAIVER_IMMUNITY_IDOLS, windowSize: 10, seed: 7 })
    expect(chosen).toHaveLength(2)
    expect(chosen.every(c => !['p20', 'p21'].includes(c.playerId))).toBe(true)
    expect(chosen.every(c => Number(c.playerId.slice(1)) < 32)).toBe(true)
    expect(chooseWaiverImmunityPlayers({ undrafted: [], excludePlayerIds: new Set(), count: 2, windowSize: 10, seed: 7 })).toEqual([])
  })
})
