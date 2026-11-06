/**
 * The tanking monitor's rules (lib/integrity/tankingRules.ts): who counts as a real alternative, how
 * repetition is counted, and how serious a case is. A wrong answer here accuses someone of cheating.
 */
import { describe, expect, it } from 'vitest'

import {
  consecutiveRun,
  eligibleBench,
  maxSeverity,
  tankingSeverity,
  tankingSummary,
  unplayableReason,
} from '@/lib/integrity/tankingRules'

describe('unplayableReason', () => {
  it('reads a bye, OUT, IR, doubtful and suspended, and nothing else', () => {
    expect(unplayableReason({ playerId: 'a', byeWeek: 7 }, 7)).toBe('BYE')
    expect(unplayableReason({ playerId: 'a', status: 'Out' }, 7)).toBe('OUT')
    expect(unplayableReason({ playerId: 'a', status: 'IR' }, 7)).toBe('IR')
    expect(unplayableReason({ playerId: 'a', status: 'Doubtful' }, 7)).toBe('DOUBTFUL')
    expect(unplayableReason({ playerId: 'a', status: 'Suspended' }, 7)).toBe('SUSPENDED')
    expect(unplayableReason({ playerId: 'a', status: 'Questionable' }, 7)).toBeNull()
    expect(unplayableReason({ playerId: 'a', byeWeek: 9 }, 7)).toBeNull()
  })
})

describe('eligibleBench — only someone who could LEGALLY take the slot', () => {
  const outWr = { playerId: 'wr', status: 'Out', position: 'WR', slot: 'WR' }

  it('a healthy quarterback is no alternative for a receiver slot', () => {
    expect(eligibleBench(outWr, [{ playerId: 'qb', position: 'QB', proj: 20 }], 'NFL', 5)).toEqual([])
  })

  it('a healthy receiver is', () => {
    expect(eligibleBench(outWr, [{ playerId: 'wr2', position: 'WR' }], 'NFL', 5).map((b) => b.playerId)).toEqual(['wr2'])
  })

  it('a FLEX slot takes a running back, receiver or tight end', () => {
    const flex = { ...outWr, slot: 'FLEX' }
    const bench = [{ playerId: 'rb', position: 'RB' }, { playerId: 'te', position: 'TE' }, { playerId: 'qb', position: 'QB' }]
    expect(eligibleBench(flex, bench, 'NFL', 5).map((b) => b.playerId).sort()).toEqual(['rb', 'te'])
  })

  it('a bench player who could not play either is no alternative', () => {
    const bench = [{ playerId: 'wr2', position: 'WR', status: 'Out' }, { playerId: 'wr3', position: 'WR', byeWeek: 5 }]
    expect(eligibleBench(outWr, bench, 'NFL', 5)).toEqual([])
  })

  it('an unknown position or slot fits nothing — eligibility is never guessed', () => {
    expect(eligibleBench(outWr, [{ playerId: 'x', position: null }], 'NFL', 5)).toEqual([])
    expect(eligibleBench({ playerId: 'wr' }, [{ playerId: 'wr2', position: 'WR' }], 'NFL', 5)).toEqual([])
  })

  it('the strongest projection comes first', () => {
    const bench = [{ playerId: 'lo', position: 'WR', proj: 4 }, { playerId: 'hi', position: 'WR', proj: 12 }]
    expect(eligibleBench(outWr, bench, 'NFL', 5).map((b) => b.playerId)).toEqual(['hi', 'lo'])
  })
})

describe('consecutiveRun', () => {
  it('counts the run ending at this week, and a gap breaks it', () => {
    expect(consecutiveRun([5], 5)).toBe(1)
    expect(consecutiveRun([3, 4, 5], 5)).toBe(3)
    expect(consecutiveRun([3, 5, 6], 6)).toBe(2)
    expect(consecutiveRun([3, 4], 6)).toBe(0)
  })
})

describe('tankingSeverity', () => {
  it('one starter, one week, still in contention: low — often just inattention', () => {
    expect(tankingSeverity({ suspiciousStarters: 1, consecutiveWeeks: 1, eliminated: false })).toBe('low')
  })
  it('two starters, a second week in a row, or already eliminated: medium', () => {
    expect(tankingSeverity({ suspiciousStarters: 2, consecutiveWeeks: 1, eliminated: false })).toBe('medium')
    expect(tankingSeverity({ suspiciousStarters: 1, consecutiveWeeks: 2, eliminated: false })).toBe('medium')
    expect(tankingSeverity({ suspiciousStarters: 1, consecutiveWeeks: 1, eliminated: true })).toBe('medium')
  })
  it('three in a lineup, three weeks running, or eliminated and repeating: high', () => {
    expect(tankingSeverity({ suspiciousStarters: 3, consecutiveWeeks: 1, eliminated: false })).toBe('high')
    expect(tankingSeverity({ suspiciousStarters: 1, consecutiveWeeks: 3, eliminated: false })).toBe('high')
    expect(tankingSeverity({ suspiciousStarters: 1, consecutiveWeeks: 2, eliminated: true })).toBe('high')
  })
  it('an extended case never gets milder', () => {
    expect(maxSeverity('high', 'low')).toBe('high')
    expect(maxSeverity('low', 'medium')).toBe('medium')
    expect(maxSeverity(undefined, 'low')).toBe('low')
  })
})

describe('tankingSummary', () => {
  it('says how many players and, once it repeats, how many weeks', () => {
    expect(tankingSummary({ idleOnly: false, suspiciousStarters: 1, consecutiveWeeks: 1 })).toBe(
      'Started a player who could not play, while a healthy bench player could have taken the spot.',
    )
    expect(tankingSummary({ idleOnly: false, suspiciousStarters: 2, consecutiveWeeks: 3 })).toBe(
      'Started 2 players who could not play, while a healthy bench player could have taken the spot. 3 weeks in a row.',
    )
  })
})
