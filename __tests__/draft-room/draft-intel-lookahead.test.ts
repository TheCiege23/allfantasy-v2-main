import { describe, expect, it } from 'vitest'

import { buildDraftLookahead, type LookaheadInput } from '@/lib/draft-room/draftIntelLookahead'
import { buildAdpLookup, type PulsePick, type PulsePoolPlayer } from '@/lib/draft-room/draftPulse'

const SLOT_ORDER = [
  { slot: 1, rosterId: 'r1', displayName: 'Me' },
  { slot: 2, rosterId: 'r2', displayName: 'Steve' },
  { slot: 3, rosterId: 'r3', displayName: 'Open 3' },
  { slot: 4, rosterId: 'r4', displayName: 'Open 4' },
]

function pick(overall: number, rosterId: string, playerName: string, position: string): PulsePick {
  return { overall, rosterId, displayName: rosterId, playerName, position, playerId: null }
}

const DRAFTED: PulsePoolPlayer[] = [
  { name: 'Jokic', position: 'C', adp: 1 },
  { name: 'Wemby', position: 'C', adp: 2 },
  { name: 'SGA', position: 'PG', adp: 3 },
  { name: 'Luka', position: 'PG', adp: 4 },
]

const AVAILABLE: PulsePoolPlayer[] = [
  { name: 'Edwards', position: 'SG', adp: 5 },
  { name: 'Cade', position: 'PG', adp: 6 },
  { name: 'Giannis', position: 'PF', adp: 7 },
  { name: 'Booker', position: 'SG', adp: 8 },
  { name: 'Tatum', position: 'SF', adp: 9 },
  { name: 'No ADP', position: 'C', adp: null },
]

// Round 1: r1 Jokic, r2 Wemby, r3 SGA, r4 Luka. Snake → round 2 starts with r4 at 2.01 (overall 5).
const PICKS: PulsePick[] = [
  pick(1, 'r1', 'Jokic', 'C'),
  pick(2, 'r2', 'Wemby', 'C'),
  pick(3, 'r3', 'SGA', 'PG'),
  pick(4, 'r4', 'Luka', 'PG'),
]

function input(overrides: Partial<LookaheadInput> = {}): LookaheadInput {
  return {
    picks: PICKS,
    available: AVAILABLE,
    lookup: buildAdpLookup([...DRAFTED, ...AVAILABLE]),
    slotOrder: SLOT_ORDER,
    tradedPicks: [],
    teamCount: 4,
    rounds: 3,
    draftType: 'snake',
    thirdRoundReversal: false,
    currentOverall: 5,
    viewerRosterId: 'r1',
    starterSlots: null,
    ...overrides,
  }
}

describe('buildDraftLookahead — window', () => {
  it('covers every pick between now and the viewer’s next turn', () => {
    const res = buildDraftLookahead(input())
    expect(res.rows.map((r) => r.displayName)).toEqual(['Open 4', 'Open 3', 'Steve'])
    expect(res.rows.map((r) => r.pickLabel)).toEqual(['2.01', '2.02', '2.03'])
    expect(res.viewerNextOverall).toBe(8)
    expect(res.windowSize).toBe(3)
  })

  it('skips the viewer’s own back-to-back picks at the turn', () => {
    // On the clock at 2.04 (overall 8, r1) → r1 also has 3.01 (overall 9); window is 3.02..3.04.
    const res = buildDraftLookahead(input({ currentOverall: 8 }))
    expect(res.startOverall).toBe(10)
    expect(res.rows.map((r) => r.displayName)).toEqual(['Steve', 'Open 3', 'Open 4'])
    expect(res.viewerNextOverall).toBeNull() // r1 has no pick left in a 3-round draft
  })

  it('follows a traded pick to its new owner', () => {
    const res = buildDraftLookahead(
      input({
        tradedPicks: [
          { round: 2, originalRosterId: 'r3', previousOwnerName: 'Open 3', newRosterId: 'r1', newOwnerName: 'Me' },
        ],
      }),
    )
    // r3's 2.02 now belongs to the viewer, so the window ends there.
    expect(res.rows.map((r) => r.displayName)).toEqual(['Open 4'])
    expect(res.viewerNextOverall).toBe(6)
  })

  it('caps a spectator’s window at maxRows', () => {
    const res = buildDraftLookahead(input({ viewerRosterId: null, maxRows: 2 }))
    expect(res.rows).toHaveLength(2)
    expect(res.viewerNextOverall).toBeNull()
  })
})

describe('buildDraftLookahead — needs and projections', () => {
  it('lists positions a manager has not drafted, in ADP order', () => {
    const res = buildDraftLookahead(input())
    const open4 = res.rows[0]!
    expect(open4.needs).toEqual(['SG', 'PF', 'SF']) // has PG; C never appears in the ADP-ranked pool
  })

  it('restricts needs to starter-slot positions and ignores flex keys', () => {
    const res = buildDraftLookahead(input({ starterSlots: { PG: 1, SG: 1, C: 1, UTIL: 2 } }))
    expect(res.rows[0]!.needs).toEqual(['SG'])
  })

  it('projects a need-filling pick from the top candidates, never twice, never without ADP', () => {
    const res = buildDraftLookahead(input())
    expect(res.rows.map((r) => r.projected?.name)).toEqual(['Edwards', 'Giannis', 'Cade'])
    const names = res.rows.map((r) => r.projected?.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).not.toContain('No ADP')
  })

  it('falls back to best ADP when nothing in range fills a need', () => {
    const res = buildDraftLookahead(input({ candidatesPerPick: 1 }))
    expect(res.rows.map((r) => r.projected?.name)).toEqual(['Edwards', 'Cade', 'Giannis'])
  })

  it('flags auto-drafting rosters', () => {
    const res = buildDraftLookahead(input({ autoRosterIds: new Set(['r3', 'r4']) }))
    expect(res.rows.map((r) => r.isAuto)).toEqual([true, true, false])
  })
})
