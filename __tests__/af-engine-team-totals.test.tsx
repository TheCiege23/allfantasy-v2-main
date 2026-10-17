import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { afEngineLineupTotal, type AfEngineProjection, type PlayerProjection } from '@/lib/core-app/playerProjections'
import { afEngineColumnTotal } from '@/components/core-app/screens/Matchup'
import type { MatchupPlayerCell, MatchupSlot } from '@/lib/core-app/matchup'

const provider = (id: string, ppr: number, rec: number): PlayerProjection => ({
  playerId: id, projectedPoints: ppr, name: null, position: null, team: null, componentStats: { rec },
})
const engine = (id: string, pts: number): AfEngineProjection => ({ playerId: id, projectedPoints: pts, basis: null, confidence: null })

describe('afEngineLineupTotal — AllFantasy engine, summed over a lineup under league rules', () => {
  it('scales each starter by his provider line and skips starters the engine never wrote', () => {
    // a: provider 10 PPR -> league 4 (rec 4 x 1); engine 20 -> 20 x 4/10 = 8.
    // b: no provider row; engine 6 stands as PPR. c: provider only -> not counted.
    const total = afEngineLineupTotal(
      ['a', 'b', 'c'],
      new Map([['a', provider('a', 10, 4)], ['c', provider('c', 12, 3)]]),
      new Map([['a', engine('a', 20)], ['b', engine('b', 6)]]),
      { rec: 1 },
    )
    expect(total).toEqual({ projected: 14, projectedFrom: 2 })
  })

  it('is null, never 0, when the engine priced nobody', () => {
    expect(afEngineLineupTotal(['a'], new Map([['a', provider('a', 10, 4)]]), new Map(), { rec: 1 }))
      .toEqual({ projected: null, projectedFrom: 0 })
  })
})

const cell = (over: Partial<MatchupPlayerCell>): MatchupPlayerCell => ({
  playerId: 'p', sleeperId: 'p', name: 'P', position: 'WR', team: 'KC', sport: 'NFL', imageUrl: null,
  projected: 10, actual: null, empty: false, unavailable: null, ...over,
})
const slot = (you: MatchupPlayerCell | null, opponent: MatchupPlayerCell | null): MatchupSlot =>
  ({ slotLabel: 'WR', you, opponent }) as MatchupSlot

describe('afEngineColumnTotal — the Matchup board AF footer and banner', () => {
  it('sums the AF cells of one side, leaving out empty slots and ruled-out starters', () => {
    const slots = [
      slot(cell({ afEngine: 12.25 }), cell({ afEngine: 3 })),
      slot(cell({ afEngine: 7.5 }), cell({ afEngine: null })),
      slot(cell({ empty: true, afEngine: 99 }), null),
      slot(cell({ unavailable: 'out', projected: 0, afEngine: 40 }), null),
    ]
    expect(afEngineColumnTotal(slots, 'you')).toBe(19.8)
    expect(afEngineColumnTotal(slots, 'opponent')).toBe(3)
  })

  it('is null when no starter on that side has an AF number', () => {
    expect(afEngineColumnTotal([slot(cell({}), cell({}))], 'you')).toBeNull()
  })
})
