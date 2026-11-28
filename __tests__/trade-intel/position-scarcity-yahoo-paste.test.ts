/**
 * @vitest-environment node
 *
 * 🛑 A pasted Yahoo league's wire is counted only above its coverage bar (declaredAvailability.ts).
 *
 * Matched players are stored `sleeper:<id>`; an unmatched one keeps `yahoo-paste:<name>|<pos>|<team>`.
 * Above 80% the declared ids are subtracted and the unmatched player's own row is not counted as a free
 * agent; below it the board is empty ("we did not look") and the verdict travels beside it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = { players: [] as string[] }

vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: {
      findMany: vi.fn(async () => [{ playerData: { players: state.players }, league: { platform: 'yahoo', sport: 'NFL' } }]),
    },
    fantasyProjection: {
      findMany: vi.fn(async () => [{ playerId: '6038' }, { playerId: '7000' }, { playerId: '7001' }]),
    },
    sportsPlayer: {
      findMany: vi.fn(async () => [
        { sleeperId: '6038', name: 'Rostered Kicker', position: 'K', team: 'BUF' },
        { sleeperId: '7000', name: 'Free Kicker', position: 'K', team: 'KC' },
        { sleeperId: '7001', name: 'Pasted Kicker', position: 'K', team: 'NYJ' },
      ]),
    },
    sportsInjury: { findMany: vi.fn(async () => []) },
  },
}))

import { getPositionScarcity, getPositionScarcityWithAvailability } from '@/lib/trade-intel/positionScarcity'

const ARGS = { leagueId: 'Y1', sport: 'NFL', projectionWeek: { season: '2026', week: 4 }, positions: ['K'] }
const declared = (n: number) => Array.from({ length: n }, (_, i) => `sleeper:${100 + i}`)

beforeEach(() => {
  // 9 of 10 declared.
  state.players = ['sleeper:6038', ...declared(8), 'yahoo-paste:pasted kicker|K|NYJ']
})

describe('getPositionScarcity — a pasted Yahoo league', () => {
  it('above the bar: subtracts the declared players and reports the verdict', async () => {
    const { board, availability } = await getPositionScarcityWithAvailability(ARGS)
    expect(availability).toEqual({ verified: true, unmatched: 1 })
    expect(board.get('K')?.freeAgents).toBe(1)
  })

  it('🛑 the unmatched pasted player is never counted as a free agent', async () => {
    // Free Kicker alone: Rostered Kicker is declared, Pasted Kicker is somebody's unmatched player.
    expect((await getPositionScarcity(ARGS)).get('K')?.freeAgents).toBe(1)
  })

  it('below the bar: no board, with the verdict saying why', async () => {
    state.players = ['sleeper:6038', 'yahoo-paste:pasted kicker|K|NYJ', 'yahoo-paste:a|RB|KC']
    const { board, availability } = await getPositionScarcityWithAvailability(ARGS)
    expect(board.size).toBe(0)
    expect(availability).toEqual({ verified: false, unmatched: 2 })
  })
})
