import { describe, expect, it } from 'vitest'
import { survivorFinishingOrder, type SurvivorOrderInput } from '@/lib/payouts/survivorOrder'

/** A Survivor league's finishing order for payouts (lib/payouts/survivorOrder.ts). */

const rosters = [
  { id: 'A', ownerId: 'ua', playoffSeed: 1 },
  { id: 'B', ownerId: 'ub', playoffSeed: 2 },
  { id: 'C', ownerId: 'uc', playoffSeed: 3 },
  { id: 'D', ownerId: 'ud', playoffSeed: 4 },
  { id: 'E', ownerId: 'ue', playoffSeed: 5 },
]
const base = (over: Partial<SurvivorOrderInput> = {}): SurvivorOrderInput => ({
  rosters,
  players: [
    { userId: 'ua', redraftRosterId: 'A', eliminatedWeek: 2, isFinalist: false },
    { userId: 'ub', redraftRosterId: null, eliminatedWeek: 8, isFinalist: false }, // no roster id: found by owner
    { userId: 'uc', redraftRosterId: 'C', eliminatedWeek: null, isFinalist: true },
    { userId: 'ud', redraftRosterId: 'D', eliminatedWeek: null, isFinalist: true },
    { userId: 'ue', redraftRosterId: 'E', eliminatedWeek: null, isFinalist: true },
  ],
  jury: { status: 'winner_revealed', winnerId: 'ue', finalistUserIds: ['uc', 'ud', 'ue'] },
  votes: [{ finalistUserId: 'ue' }, { finalistUserId: 'ue' }, { finalistUserId: 'uc' }, { finalistUserId: 'ud' }, { finalistUserId: 'ud' }],
  ...over,
})
const ids = (input: SurvivorOrderInput) => survivorFinishingOrder(input)!.order.map((r) => r.rosterId)

describe('survivorFinishingOrder', () => {
  it('winner, finalists by jury votes, then the voted-out latest first; places are 1..n', () => {
    const r = survivorFinishingOrder(base())!
    expect(r.final).toBe(true)
    // E won; D (2 votes) beats C (1); B out week 8, A out week 2.
    expect(r.order).toEqual([
      { rosterId: 'E', place: 1 }, { rosterId: 'D', place: 2 }, { rosterId: 'C', place: 3 }, { rosterId: 'B', place: 4 }, { rosterId: 'A', place: 5 },
    ])
  })

  it('a jury-vote tie between runner-ups falls back to seed, so places stay unique', () => {
    expect(ids(base({ votes: [{ finalistUserId: 'uc' }, { finalistUserId: 'ud' }] }))).toEqual(['E', 'C', 'D', 'B', 'A'])
  })

  it('before the reveal: not final, votes ignored, still-in players by seed then the voted-out', () => {
    for (const status of ['pending', 'questions_open', 'voting_open', 'complete']) {
      const r = survivorFinishingOrder(base({ jury: { status, winnerId: status === 'complete' ? 'ue' : null, finalistUserIds: ['uc', 'ud', 'ue'] } }))!
      expect(r.final).toBe(false)
      expect(r.order.map((x) => x.rosterId)).toEqual(['C', 'D', 'E', 'B', 'A'])
    }
    expect(survivorFinishingOrder(base({ jury: null }))!.final).toBe(false)
  })

  it('a revealed status with no winner is not final', () => {
    expect(survivorFinishingOrder(base({ jury: { status: 'winner_revealed', winnerId: null, finalistUserIds: [] } }))!.final).toBe(false)
  })

  it('no players: not a Survivor league; a player with no roster is left out rather than given a place', () => {
    expect(survivorFinishingOrder(base({ players: [] }))).toBeNull()
    const r = survivorFinishingOrder(base({ players: [...base().players, { userId: 'ghost', redraftRosterId: null, eliminatedWeek: 1, isFinalist: false }] }))!
    expect(r.order).toHaveLength(5)
  })
})
