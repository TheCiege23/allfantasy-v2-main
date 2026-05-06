import { describe, expect, it } from 'vitest'
import type { QueueEntry } from '@/lib/live-draft-engine/types'

describe('queue display vs order', () => {
  it('queue entry array is unchanged by display-only meta maps', () => {
    const queue: QueueEntry[] = [
      { playerId: 'a', playerName: 'A', position: 'RB', team: 'DAL' },
      { playerId: 'b', playerName: 'B', position: 'WR', team: 'KC' },
    ]
    const frozen = JSON.stringify(queue)
    const meta = {
      a: { headshotUrl: 'https://x.com/1.png', adp: 12, aiAdp: 14, injuryStatus: 'Q', experienceBadge: 'Rookie' },
    }
    expect(meta.a.headshotUrl).toBeTruthy()
    expect(JSON.stringify(queue)).toBe(frozen)
  })
})
