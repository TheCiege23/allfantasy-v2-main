import { describe, expect, it } from 'vitest'
import { eligibleComparisons, teamHealth } from '@/lib/core-app/teamWorkspace'
import { isEligibleForSlot } from '@/lib/core-app/rosterSlots'
import type { MyTeamData } from '@/lib/core-app/myTeam'

describe('team workspace player portraits', () => {
  it('carries imported roster images into health checks and start/sit candidates', () => {
    const starter = {
      sleeperId: 'fantrax:starter', name: 'Starter', position: 'PG',
      imageUrl: 'https://example.com/starter.png', ruledOut: true, onBye: false,
      afProjectedPoints: null, kickoff: null,
    }
    const bench = {
      sleeperId: 'fantrax:bench', name: 'Bench', position: 'PG',
      imageUrl: 'https://example.com/bench.png', ruledOut: false, onBye: false,
      afProjectedPoints: null, kickoff: null,
    }
    const data = {
      league: { format: null, bestBall: false, lineupMode: 'manual', sport: 'NBA' },
      starters: { available: true, data: [{ slotLabel: 'PG', player: starter, empty: false }] },
      bench: { available: true, data: [bench] },
      taxi: { available: false }, ir: { available: false },
    } as unknown as MyTeamData

    expect(teamHealth(data).find((check) => check.id === 'player-fantrax:starter')?.player)
      .toEqual({ name: 'Starter', imageUrl: starter.imageUrl })
    expect(eligibleComparisons(data, Date.now())[0]?.candidates[0]?.player.imageUrl)
      .toBe(bench.imageUrl)
  })

  it('uses NBA guard and forward eligibility without changing other sports', () => {
    expect(isEligibleForSlot('G', 'PG', 'NBA')).toBe(true)
    expect(isEligibleForSlot('G', 'C', 'NBA')).toBe(false)
    expect(isEligibleForSlot('F', 'SF', 'NBA')).toBe(true)
    expect(isEligibleForSlot('FLEX_F_C', 'C', 'NBA')).toBe(true)
    expect(isEligibleForSlot('G', 'PG', 'NHL')).toBe(false)
  })
})
