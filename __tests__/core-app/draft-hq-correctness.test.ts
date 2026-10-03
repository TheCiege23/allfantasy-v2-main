import { describe, expect, it } from 'vitest'
import { draftPickOwner, draftNextPick, latestDraftsByLeague } from '@/lib/core-app/draftHqState'

const order = [{ slot: 2, rosterId: 'b', displayName: 'Beta' }, { slot: 1, rosterId: 'a', displayName: 'Alpha' }]
describe('Draft HQ uses draft-engine order and ownership', () => {
  it('resolves snake turns by slot, even when the order array is unsorted', () => {
    expect(draftPickOwner({ overall: 3, teamCount: 2, draftType: 'snake', slotOrder: order })?.rosterId).toBe('b')
  })
  it('respects third-round reversal', () => {
    expect(draftPickOwner({ overall: 5, teamCount: 2, draftType: 'snake', thirdRoundReversal: true, slotOrder: order })?.rosterId).toBe('b')
  })
  it('respects linear order', () => {
    expect(draftPickOwner({ overall: 3, teamCount: 2, draftType: 'linear', slotOrder: order })?.rosterId).toBe('a')
  })
  it('uses the last trade without losing the original owner', () => {
    const owner = draftPickOwner({ overall: 1, teamCount: 2, draftType: 'snake', slotOrder: order,
      tradedPicks: [
        { round: 1, originalRosterId: 'a', newRosterId: 'b', newOwnerName: 'Beta' },
        { round: 1, originalRosterId: 'a', newRosterId: 'c', newOwnerName: 'Gamma' },
      ] })
    expect(owner).toMatchObject({ rosterId: 'c', originalRosterId: 'a', displayName: 'Gamma' })
  })
  it('does not invent an auction turn from snake order', () => {
    expect(draftPickOwner({ overall: 1, teamCount: 2, draftType: 'auction', slotOrder: order })).toBeNull()
  })
  it('rejects malformed imported ownership records', () => {
    expect(draftPickOwner({ overall: 1, teamCount: 2, draftType: 'snake', slotOrder: [null, ...order], tradedPicks: [null, { round: -1 }] })?.rosterId).toBe('a')
  })
})
describe('Draft cursor and portfolio identity', () => {
  it('keeps a canonical cursor even when prior picks may contain gaps', () => {
    expect(draftNextPick('in_progress', 7, 12)).toBe(7)
  })
  it.each(['complete', 'completed', 'post_draft'])('does not show a turn for %s', (status) => {
    expect(draftNextPick(status, 7, 12)).toBeNull()
  })
  it.each([0, -1, 13, Number.NaN])('rejects invalid cursor %s', (cursor) => {
    expect(draftNextPick('in_progress', cursor, 12)).toBeNull()
  })
  it('selects one latest session per league in any input order', () => {
    const sessions = [
      { id: 'new', leagueId: 'one', createdAt: new Date('2026-09-01') },
      { id: 'other', leagueId: 'two', createdAt: new Date('2026-08-01') },
      { id: 'old', leagueId: 'one', createdAt: new Date('2025-09-01') },
    ]
    expect(latestDraftsByLeague(sessions).map((s) => s.id)).toEqual(['new', 'other'])
  })
  it('breaks timestamp ties by ID to match the league loader', () => {
    const createdAt = new Date('2026-09-01')
    expect(latestDraftsByLeague([{ id: 'a', leagueId: 'one', createdAt }, { id: 'b', leagueId: 'one', createdAt }])[0].id).toBe('b')
  })
})
