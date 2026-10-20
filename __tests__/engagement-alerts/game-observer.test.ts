import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), dispatch: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsDataCache: { findUnique: h.read, upsert: h.write } } }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))
import { observeGameAlerts } from '@/lib/engagement-alerts/gameAlertService'
import type { GameObservation } from '@/lib/engagement-alerts/gameEvents'
import type { LiveGameDetail } from '@/lib/live/espnGameSummary'
const game: GameObservation = { gameId: '12345', homeTeam: 'H', awayTeam: 'A', homeScore: 10, awayScore: 9, status: 'STATUS_IN_PROGRESS', statusDetail: 'Q4', period: 4, clock: '4:00', completed: false }
const detail = (ids: string[]) => ({ sport: 'NBA', drives: [], scoringPlays: ids.map(id => ({ id, text: `Scored ${id}` })) }) as unknown as LiveGameDetail
beforeEach(() => { vi.resetAllMocks(); h.write.mockResolvedValue({}); h.dispatch.mockResolvedValue({ delivered: 1, failed: 0 }); h.read.mockResolvedValue(null) })
describe('persisted game observation', () => {
  it('bootstraps silently with all known play identities', async () => {
    await observeGameAlerts('NBA', game, detail(['1', '2']), ['u'])
    expect(h.dispatch).not.toHaveBeenCalled()
    expect(h.write.mock.calls[0][0].create.data.seen).toEqual(['play:1', 'play:2'])
  })
  it('does not miss the first score after a scheduled-game baseline', async () => {
    await observeGameAlerts('NBA', { ...game, status: 'STATUS_SCHEDULED', period: 0, homeScore: null, awayScore: null }, null, ['u'])
    h.read.mockResolvedValue({ data: h.write.mock.calls[0][0].create.data })
    await observeGameAlerts('NBA', { ...game, period: 1, clock: '10:00' }, detail(['first']), ['u'])
    expect(h.dispatch).toHaveBeenCalledTimes(1)
    expect(h.dispatch.mock.calls[0][0].type).toBe('game_scoring_play')
  })
  it('delivers each new play once and final score independently', async () => {
    h.read.mockResolvedValue({ data: { observation: game, seen: ['play:1'], playsInitialized: true } })
    await observeGameAlerts('NBA', { ...game, completed: true }, detail(['1', '2', '3']), ['u'])
    expect(h.dispatch.mock.calls.map(c => c[0].type)).toEqual(['game_final', 'game_scoring_play', 'game_scoring_play'])
    expect(h.dispatch.mock.calls[1][0].dedupePrefix).not.toEqual(h.dispatch.mock.calls[2][0].dedupePrefix)
  })
  it('retains its cursor on delivery failures', async () => {
    h.read.mockResolvedValue({ data: { observation: game, seen: [], playsInitialized: true } })
    h.dispatch.mockResolvedValue({ delivered: 0, failed: 1 })
    await expect(observeGameAlerts('NBA', game, detail(['2']), ['u'])).rejects.toThrow('dispatch failed')
    expect(h.write).not.toHaveBeenCalled()
  })
  it('does not mistake a database outage for a bootstrap', async () => {
    h.read.mockRejectedValue(new Error('database down'))
    await expect(observeGameAlerts('NBA', game, detail(['2']), ['u'])).rejects.toThrow('database down')
    expect(h.write).not.toHaveBeenCalled()
  })
  it('baselines the first available play feed after a summary outage', async () => {
    h.read.mockResolvedValue({ data: { observation: game, seen: [], playsInitialized: false } })
    await observeGameAlerts('NBA', game, detail(['old1', 'old2']), ['u'])
    expect(h.dispatch).not.toHaveBeenCalled()
  })
})
