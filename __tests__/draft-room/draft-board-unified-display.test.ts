import { describe, expect, it } from 'vitest'
import { mergePoolPlayerIntoBoardPickDisplay } from '@/lib/player-data/adapters/draftRoomDisplayFields'

describe('draft board unified display merge', () => {
  it('does not mutate playerId / names on pick snapshot merge', () => {
    const base = {
      overall: 3,
      round: 1,
      slot: 2,
      pickLabel: '1.2',
      playerName: 'Josh Allen',
      position: 'QB',
      team: 'BUF',
      playerId: 'player-buf-1',
      playerImageUrl: null as string | null,
      injuryStatus: null as string | null,
      byeWeek: null as number | null,
      sport: 'NFL',
    }
    const out = mergePoolPlayerIntoBoardPickDisplay(base, {
      unifiedProductView: {
        unified: {
          headshotUrl: 'https://img.example/h.jpg',
          fullName: 'Different Name',
        },
      } as any,
    })
    expect(out.playerId).toBe('player-buf-1')
    expect(out.playerName).toBe('Josh Allen')
    expect(out.playerImageUrl).toBe('https://img.example/h.jpg')
  })

  it('no pool row leaves pick unchanged', () => {
    const base = { playerImageUrl: 'https://x.com/a.png', injuryStatus: 'Out' as string | null }
    expect(mergePoolPlayerIntoBoardPickDisplay(base, null)).toEqual(base)
  })
})
