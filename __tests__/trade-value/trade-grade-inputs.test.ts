import { describe, expect, it } from 'vitest'
import {
  gradeInputsFromNativeItems,
  gradeInputsFromPending,
  unpriceableReason,
} from '@/lib/trade-value/tradeGradeInputs'

describe('pending-offer assets → the one grader', () => {
  it('prices players by NAME — a Sleeper id handed to getPlayer queues a whole-sport import', () => {
    const r = gradeInputsFromPending([{ playerName: 'Puka Nacua', isPick: false }])
    expect(r.assets).toEqual([{ kind: 'player', name: 'Puka Nacua' }])
    expect(JSON.stringify(r.assets)).not.toContain('playerId')
  })

  it('a pick with its year and round is a pick; one without is named, not dropped', () => {
    const r = gradeInputsFromPending([
      { playerName: '2027 1st', isPick: true, pickRound: '2027 1st', pickYear: 2027, pickRoundNumber: 1 },
      { playerName: 'Future pick', isPick: true, pickRound: 'Future pick' },
    ])
    expect(r.assets).toEqual([{ kind: 'pick', year: 2027, round: 1 }])
    expect(r.unpriceable).toEqual(['Future pick'])
  })

  it('FAAB is FAAB', () => {
    expect(gradeInputsFromPending([{ playerName: '$25 FAAB', faabAmount: 25 }]).assets).toEqual([{ kind: 'faab', amount: 25 }])
  })
})

describe('native trade items → the one grader', () => {
  it('reads the metadata spellings serverTradeDecision reads', () => {
    const r = gradeInputsFromNativeItems([
      { itemType: 'player', itemReference: '4984', metadata: { playerName: 'Josh Allen' } },
      { itemType: 'draft_pick', itemReference: 'pick:2027:2', metadata: { season: 2027, round: 2 } },
      { itemType: 'draft_pick', itemReference: 'pick:2028:1', metadata: { pickSeason: 2028, pickRound: 1 } },
      { itemType: 'faab', itemReference: null, faabAmount: 10, metadata: null },
    ])
    expect(r.assets).toEqual([
      { kind: 'player', name: 'Josh Allen' },
      { kind: 'pick', year: 2027, round: 2 },
      { kind: 'pick', year: 2028, round: 1 },
      { kind: 'faab', amount: 10 },
    ])
    expect(r.unpriceable).toEqual([])
  })

  it('an unnamed player or a pick without a round withholds the grade — named, never by a raw id', () => {
    const give = gradeInputsFromNativeItems([{ itemType: 'player', itemReference: '999', metadata: {} }])
    const get = gradeInputsFromNativeItems([{ itemType: 'rookie_pick', itemReference: 'b7c1e2d4-uuid', metadata: { pickLabel: '2027 pick' } }])
    expect(unpriceableReason(give, get)).toBe(
      'a player with no name on file, 2027 pick cannot be priced, and a missing asset is not graded as worthless.',
    )
    expect(unpriceableReason({ assets: [], unpriceable: [] }, { assets: [], unpriceable: [] })).toBeNull()
  })

  /*
   * 🛑 THE TRADE CENTER PROPOSES WITH IDS AND NO METADATA (measured 2026-09-24): a player is a Sleeper
   * id, a pick is its pick id. Without these two fallbacks nearly every native trade read "Not graded".
   */
  it('names a bare Sleeper id through the lookup the trades panel supplies', () => {
    const r = gradeInputsFromNativeItems(
      [{ itemType: 'player', itemReference: '4984', metadata: null }],
      (id) => (id === '4984' ? 'Josh Allen' : null),
    )
    expect(r.assets).toEqual([{ kind: 'player', name: 'Josh Allen' }])
  })

  it('reads the season and round a future-pick reference carries', () => {
    const r = gradeInputsFromNativeItems([
      { itemType: 'future_pick', itemReference: 'fdp:2028:2:roster-9', metadata: null },
      { itemType: 'draft_pick', itemReference: 'pick:2027:1:r1', metadata: {} },
      { itemType: 'rookie_pick', itemReference: 'fdp:20x8:2:roster-9', metadata: null },
    ])
    expect(r.assets).toEqual([
      { kind: 'pick', year: 2028, round: 2 },
      { kind: 'pick', year: 2027, round: 1 },
    ])
    expect(r.unpriceable).toEqual(['a draft pick with no season or round on file'])
  })
})
