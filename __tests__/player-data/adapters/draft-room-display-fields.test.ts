import { describe, expect, it } from 'vitest'
import {
  getDraftRoomDisplayHeadshot,
  getDraftRoomDisplayInjury,
  mergePoolPlayerIntoBoardPickDisplay,
} from '@/lib/player-data/adapters/draftRoomDisplayFields'

describe('draftRoomDisplayFields', () => {
  it('prefers unified headshot over display-only', () => {
    const url = getDraftRoomDisplayHeadshot({
      display: { assets: { headshotUrl: 'https://legacy.com/a.png' } } as any,
      unifiedProductView: {
        unified: { headshotUrl: 'https://cdn.com/u.png' },
      } as any,
    })
    expect(url).toBe('https://cdn.com/u.png')
  })

  it('falls back to display headshot when unified missing', () => {
    const url = getDraftRoomDisplayHeadshot({
      display: { assets: { headshotUrl: 'https://legacy.com/a.png' } } as any,
    })
    expect(url).toBe('https://legacy.com/a.png')
  })

  it('returns null injury when nothing present', () => {
    expect(getDraftRoomDisplayInjury({ display: {} as any })).toBeNull()
  })

  it('merge keeps pick identity fields and overlays pool display', () => {
    const merged = mergePoolPlayerIntoBoardPickDisplay(
      {
        playerImageUrl: 'https://pick.com/p.png',
        injuryStatus: null,
        playerId: 'abc',
        playerName: 'X',
      } as any,
      {
        unifiedProductView: {
          unified: {
            headshotUrl: 'https://pool.com/h.png',
            injuryStatus: 'Questionable',
          },
        } as any,
      },
    )
    expect(merged.playerImageUrl).toBe('https://pool.com/h.png')
    expect(merged.injuryStatus).toBe('Questionable')
    expect((merged as any).playerName).toBe('X')
  })
})
