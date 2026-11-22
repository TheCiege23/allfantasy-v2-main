import { describe, expect, it } from 'vitest'
import { selectDraftSeasonRows } from '@/lib/draft-room/selectDraftSeasonRows'
describe('stored draft season selection', () => {
  it('uses the current season regardless of provider result order', () => {
    const rows = [{ playerId: '1', season: '2025', gamesPlayed: 82 }, { playerId: '1', season: '2026', gamesPlayed: 3 }]
    expect(selectDraftSeasonRows(rows, 2026).get('1')?.season).toBe('2026')
    expect(selectDraftSeasonRows([...rows].reverse(), 2026).get('1')?.season).toBe('2026')
  })
  it('uses the labeled previous season for a player yet to appear, never a zero-game line', () => {
    expect(selectDraftSeasonRows([{ playerId: '1', season: '2026', gamesPlayed: 0 }, { playerId: '1', season: '2025', gamesPlayed: 80 }], 2026).get('1')?.season).toBe('2025')
    expect(selectDraftSeasonRows([{ playerId: '1', season: '2024', gamesPlayed: 82 }], 2026).size).toBe(0)
  })
  it('keeps identities separate', () => {
    expect(selectDraftSeasonRows([{ playerId: '1', season: '2026', gamesPlayed: 1 }, { playerId: '2', season: '2026', gamesPlayed: 2 }], 2026).size).toBe(2)
  })
})
