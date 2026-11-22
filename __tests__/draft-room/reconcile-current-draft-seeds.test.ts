import { describe, expect, it } from 'vitest'
import { reconcileCurrentDraftSeeds } from '@/lib/draft-room/reconcileCurrentDraftSeeds'
describe('current roster authority over market seeds', () => {
  it('retains the current player after a verified position correction', () => {
    const rows = reconcileCurrentDraftSeeds([{ name: 'Test Player', position: 'C', team: 'Old', adp: 1 }], [{ name: 'Test Player', position: 'PF', team: 'Current', playerId: '319' }])
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ position: 'PF', team: 'Current', playerId: '319' })
  })
  it('preserves a market rank while refreshing current team and scoring id', () => {
    expect(reconcileCurrentDraftSeeds([{ name: 'Test Player', position: 'PF', team: 'Old', adp: 12 }], [{ name: 'Test Player', position: 'PF', team: 'Current', playerId: '319' }])[0]).toMatchObject({ adp: 12, team: 'Current', playerId: '319' })
  })
  it('retains two same-name, same-position athletes with different current identities', () => {
    const players = [{ name: 'Luis Garcia', position: 'P', team: 'A', playerId: '1' }, { name: 'Luis Garcia', position: 'P', team: 'B', playerId: '2' }]
    const result = reconcileCurrentDraftSeeds([{ name: 'Luis Garcia', position: 'P', team: null }], players)
    expect(result.map(p => p.playerId)).toEqual(['1', '2'])
  })
})
