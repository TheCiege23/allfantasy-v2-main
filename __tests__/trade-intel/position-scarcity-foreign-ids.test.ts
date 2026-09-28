/**
 * @vitest-environment node
 *
 * 🛑 A foreign league's roster ids cannot be subtracted from the wire.
 *
 * A Fleaflicker / MFL / Fantrax / Yahoo roster holds that provider's own ids — short numbers that
 * collide with real Sleeper ids (51 of 248 on the one production Fleaflicker league). Read as Sleeper
 * ids, a collision hid a real free agent while the league's actual players were never subtracted at
 * all, so the scarcity count was wrong in both directions. Such a league now gets an empty board —
 * "we did not look" — and the control shows the same id IS subtracted in a Sleeper league.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = { platform: 'fleaflicker' }

vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: {
      findMany: vi.fn(async () => [{ playerData: { players: ['6038'] }, league: { platform: state.platform } }]),
    },
    fantasyProjection: {
      findMany: vi.fn(async () => [{ playerId: '6038' }, { playerId: '7000' }]),
    },
    sportsPlayer: {
      findMany: vi.fn(async () => [
        { sleeperId: '6038', name: 'Wrong Player', position: 'K' },
        { sleeperId: '7000', name: 'Free Kicker', position: 'K' },
      ]),
    },
    sportsInjury: { findMany: vi.fn(async () => []) },
  },
}))

import { getPositionScarcity } from '@/lib/trade-intel/positionScarcity'

const ARGS = { leagueId: 'L1', sport: 'NFL', projectionWeek: { season: '2026', week: 4 }, positions: ['K'] }

beforeEach(() => {
  state.platform = 'fleaflicker'
})

describe('getPositionScarcity — a foreign league’s roster ids', () => {
  it('🛑 a Fleaflicker roster gets NO board, not a count built from colliding ids', async () => {
    const board = await getPositionScarcity(ARGS)
    expect(board.size).toBe(0)
  })

  it('🛑 the same for MFL, Fantrax and Yahoo', async () => {
    for (const platform of ['mfl', 'fantrax', 'yahoo']) {
      state.platform = platform
      expect((await getPositionScarcity(ARGS)).size).toBe(0)
    }
  })

  it('CONTROL: in a Sleeper league the same id IS subtracted from the wire', async () => {
    state.platform = 'sleeper'
    const board = await getPositionScarcity(ARGS)
    expect(board.get('K')?.freeAgents).toBe(1)
  })
})
