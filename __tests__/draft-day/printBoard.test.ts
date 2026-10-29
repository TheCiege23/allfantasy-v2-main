import { describe, expect, it } from 'vitest'
import { buildPrintBoard } from '@/lib/draft-day/printBoard'

const slotOrder = [
  { slot: 1, rosterId: 'r1', displayName: 'Ace' },
  { slot: 2, rosterId: 'r2', displayName: 'Bee' },
  { slot: 3, rosterId: 'r3', displayName: 'Cee' },
]
const base = { rounds: 2, teamCount: 3, draftType: 'snake', thirdRoundReversal: false, slotOrder, tradedPicks: [], picks: [], keepers: [] }

describe('buildPrintBoard', () => {
  it('one column per manager, with the snaking pick label under each', () => {
    const b = buildPrintBoard(base)
    expect(b.managers.map((m) => m.displayName)).toEqual(['Ace', 'Bee', 'Cee'])
    expect(b.rows[0].cells.map((c) => c.label)).toEqual(['1.01', '1.02', '1.03'])
    // Round 2 snakes: Ace's column holds the last pick of the round.
    expect(b.rows[1].cells.map((c) => [c.label, c.overall])).toEqual([['2.03', 6], ['2.02', 5], ['2.01', 4]])
  })
  it('fills picks made, then keepers, and shows who owns a traded pick', () => {
    const b = buildPrintBoard({
      ...base,
      picks: [{ overall: 1, playerName: 'Player One', position: 'RB', team: 'KC' }, { overall: 2, playerName: '(Skipped)', position: 'SKIP', team: null }],
      keepers: [{ overall: 6, playerName: 'Kept Guy', position: 'WR', team: 'BUF' }],
      tradedPicks: [{ round: 2, originalRosterId: 'r3', previousOwnerName: 'Cee', newRosterId: 'r1', newOwnerName: 'Ace' }],
    })
    expect(b.rows[0].cells[0]).toMatchObject({ kind: 'pick', player: 'Player One', detail: 'RB · KC' })
    expect(b.rows[0].cells[1]).toMatchObject({ kind: 'pick', player: 'Skipped', detail: null })
    expect(b.rows[1].cells[0]).toMatchObject({ kind: 'keeper', player: 'Kept Guy', overall: 6 })
    expect(b.rows[1].cells[2]).toMatchObject({ kind: 'open', ownedBy: 'Ace' })
    expect(b.rows[1].cells[1].ownedBy).toBeNull()
    expect([b.picksMade, b.keepers]).toEqual([2, 1])
  })
  it('linear drafts never reverse', () => {
    const b = buildPrintBoard({ ...base, draftType: 'linear' })
    expect(b.rows[1].cells.map((c) => c.label)).toEqual(['2.01', '2.02', '2.03'])
  })
})
