import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { FINALE_TIEBREAK_RULE, isFinaleVoteComplete, juryScoreline, orderFinaleRevealSequence, slipLabel } from '@/lib/survivor/finaleReveal'
import { buildFinaleRevealPayload } from '@/lib/survivor/finaleView'
import type { SurvivorFinaleState } from '@/lib/survivor/SurvivorFinaleEngine'

const base: SurvivorFinaleState = {
  open: true, closed: false, finalists: ['tc', 'o4', 'o5'], juryRosterIds: ['j1', 'j2', 'j3', 'j4', 'j5'],
  votes: [
    { jurorRosterId: 'j1', finalistRosterId: 'tc', submittedAt: new Date(), weight: 1 },
    { jurorRosterId: 'j2', finalistRosterId: 'o4', submittedAt: new Date(), weight: 1 },
  ],
  votesSubmitted: 2, votesRequired: 5, pendingJuryRosterIds: ['j3', 'j4', 'j5'], voteCount: { tc: 1, o4: 1, o5: 0 }, bonusVotesByFinalist: {},
  winnerRosterId: null, crownedAt: null, tieBreakSeasonPoints: null, finalistCount: 3, votingDeadline: null, votingComplete: false,
}

describe('jury vote secrecy', () => {
  it('sends nothing while any juror has not voted and the deadline has not passed', () => {
    expect(buildFinaleRevealPayload(base, base.finalists)).toBeNull()
  })
  it('a vote is complete when all jurors voted, the deadline passed, or a winner is crowned', () => {
    const now = new Date('2026-12-01T20:00:00Z')
    expect(isFinaleVoteComplete({ votesSubmitted: 4, votesRequired: 5, deadline: null, now })).toBe(false)
    expect(isFinaleVoteComplete({ votesSubmitted: 5, votesRequired: 5, deadline: null, now })).toBe(true)
    expect(isFinaleVoteComplete({ votesSubmitted: 2, votesRequired: 5, deadline: new Date('2026-12-01T19:59:59Z'), now })).toBe(true)
    expect(isFinaleVoteComplete({ votesSubmitted: 2, votesRequired: 5, deadline: new Date('2026-12-01T20:00:01Z'), now })).toBe(false)
    expect(isFinaleVoteComplete({ votesSubmitted: 0, votesRequired: 0, deadline: null, now })).toBe(false)
  })
  it('once complete, the payload carries slips (finalist only, never the juror)', () => {
    const done: SurvivorFinaleState = {
      ...base, votingComplete: true, winnerRosterId: 'tc', voteCount: { tc: 3, o4: 1, o5: 1 },
      votes: [
        { jurorRosterId: 'j1', finalistRosterId: 'tc', submittedAt: new Date(), weight: 1 },
        { jurorRosterId: 'j2', finalistRosterId: 'o4', submittedAt: new Date(), weight: 1 },
        { jurorRosterId: 'j3', finalistRosterId: 'tc', submittedAt: new Date(), weight: 1 },
        { jurorRosterId: 'j4', finalistRosterId: 'o5', submittedAt: new Date(), weight: 1 },
        { jurorRosterId: 'j5', finalistRosterId: 'tc', submittedAt: new Date(), weight: 1 },
      ],
    }
    const payload = buildFinaleRevealPayload(done, done.finalists)!
    expect(payload.slips).toHaveLength(5)
    expect(JSON.stringify(payload)).not.toMatch(/j[1-5]/)
    expect(payload.scoreline).toBe('3–1–1')
    expect(payload.slips.at(-1)!.finalistRosterId).toBe('tc')
  })
})

describe('suspense ordering', () => {
  const seq = (votes: Array<[string, number]>, winner: string) =>
    orderFinaleRevealSequence(votes.map(([finalistRosterId, weight]) => ({ finalistRosterId, weight })), winner, ['tc', 'o4', 'o5']).map((s) => s.finalistRosterId)

  it('alternates finalists and saves the deciding vote for last', () => {
    const order = seq([['tc', 1], ['o4', 1], ['tc', 1], ['o5', 1], ['tc', 1]], 'tc')
    expect(order).toHaveLength(5)
    expect(order.at(-1)).toBe('tc')
    for (let i = 1; i < order.length - 1; i++) expect(order[i]).not.toBe(order[i - 1])
    expect(order.filter((id) => id === 'tc')).toHaveLength(3)
  })
  it('keeps the count close: the winner never leads by two before the end', () => {
    const order = seq([['tc', 1], ['tc', 1], ['tc', 1], ['o4', 1], ['o4', 1]], 'tc')
    const counts: Record<string, number> = {}
    for (const id of order.slice(0, -1)) {
      counts[id] = (counts[id] ?? 0) + 1
      expect((counts.tc ?? 0) - (counts.o4 ?? 0)).toBeLessThanOrEqual(1)
    }
    expect(order.at(-1)).toBe('tc')
  })
  it('expands a doubled vote into two slips', () => {
    expect(seq([['o4', 2], ['tc', 1]], 'o4')).toHaveLength(3)
  })
  it('labels slips and states the tiebreak rule', () => {
    expect(slipLabel(0)).toBe('First vote')
    expect(slipLabel(4)).toBe('Fifth vote')
    expect(slipLabel(20)).toBe('Vote 21')
    expect(juryScoreline({ a: 1, b: 2, c: 1 }, 'b')).toBe('2–1–1')
    expect(FINALE_TIEBREAK_RULE).toMatch(/season points/)
  })
})
