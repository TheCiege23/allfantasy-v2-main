import { beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ trades: vi.fn(), players: vi.fn(), teams: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { leagueTrade: { findMany: h.trades }, sportsPlayer: { findMany: h.players }, leagueTeam: { findMany: h.teams } } }))
vi.mock('@/lib/player-media', () => ({ attachPlayerMediaBatch: vi.fn(async () => new Map()) }))
import { persistedRecentTrades } from '@/lib/core-app/persistedRecentTrades'
beforeEach(() => {
  h.players.mockResolvedValue([{ sleeperId: 'p', name: 'Player One', position: 'QB' }])
  h.teams.mockResolvedValue([
    { leagueId: 'af', platformUserId: 'other1', externalId: '1', ownerName: 'Alice', teamName: 'A' },
    { leagueId: 'af', platformUserId: 'other2', externalId: '2', ownerName: 'Bob', teamName: 'B' },
  ])
})
it('publishes an ingested trade between other managers before grading exists, once per transaction', async () => {
  const row = { platform: 'sleeper', sport: 'nfl', transactionId: 'new', tradeDate: new Date('2026-09-27T12:00:00Z'), playersReceived: ['p'], picksReceived: [] }
  h.trades.mockResolvedValue([
    { ...row, history: { sleeperLeagueId: 'src', sleeperUsername: 'other1' } },
    { ...row, playersReceived: [], picksReceived: [{ season: '2027', round: 1 }], history: { sleeperLeagueId: 'src', sleeperUsername: 'other2' } },
    { ...row, history: { sleeperLeagueId: 'src', sleeperUsername: 'other1' } },
  ])
  const trades = await persistedRecentTrades([{ id: 'af', name: 'League', platformLeagueId: 'src', platform: 'sleeper' }], new Date('2026-09-26'))
  expect(trades).toHaveLength(1)
  expect(trades[0].sides.map(s => s.managerName)).toEqual(['Alice', 'Bob'])
  expect(trades[0].sides[1].received[0].name).toBe('2027 round 1')
  expect(trades[0].sides[0].gradeReason).toBe('Trade received. Grade pending.')
  expect(trades[0].partial).toBe(false)
})
