import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiveGameDetail } from '@/lib/live/espnGameSummary'
import type { GameObservation } from '@/lib/engagement-alerts/gameEvents'

const h = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), dispatch: vi.fn(), budget: vi.fn(), cap: vi.fn(), profiles: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsDataCache: { findUnique: h.read, upsert: h.write }, userProfile: { findMany: h.profiles } } }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))
vi.mock('@/lib/notifications/liveGamePushBudget', () => ({ splitByGameAlertPushBudget: h.budget }))
vi.mock('@/lib/follows/teamFollowAlerts', () => ({ withinDailyCap: h.cap }))
vi.mock('@/lib/notifications/sportAudience', () => ({ listSportsAlertAudience: vi.fn() }))

import { observeGameAlerts, recipientsFor } from '@/lib/engagement-alerts/gameAlertService'

const game: GameObservation = {
  gameId: '12345', homeTeam: 'HOM', awayTeam: 'AWY', homeScore: 3, awayScore: 2,
  homeLogo: 'https://images.example/hom.png', awayLogo: 'https://images.example/awy.png',
  status: 'STATUS_IN_PROGRESS', statusDetail: 'Q4', period: 4, clock: '4:00', completed: false,
}
const baseball = { sport: 'MLB', drives: [], scoringPlays: [], players: {}, baseball: { atBats: [{ id: 'run', scoring: true, result: 'Run scores', events: [] }] } } as unknown as LiveGameDetail
const cached = (observation: GameObservation = game) => h.read.mockResolvedValue({ data: { observation, seen: [], playsInitialized: true } })

beforeEach(() => {
  vi.resetAllMocks()
  h.read.mockResolvedValue(null)
  h.write.mockResolvedValue({})
  h.dispatch.mockResolvedValue({ delivered: 1, failed: 0 })
  h.budget.mockImplementation(async (ids: string[]) => ({ push: ids, held: [] }))
  h.cap.mockImplementation(async (ids: string[]) => ids)
  h.profiles.mockResolvedValue([])
})

describe('game alert observer', () => {
  it('baselines an unseen game without sending historical plays', async () => {
    await observeGameAlerts('MLB', game, baseball, ['u'])
    expect(h.dispatch).not.toHaveBeenCalled()
    expect(h.write.mock.calls[0][0].create.data.seen).toEqual([])
  })

  it('sends no MLB at-bat alerts between inning checkpoints', async () => {
    cached()
    await observeGameAlerts('MLB', game, baseball, ['u'])
    expect(h.dispatch).not.toHaveBeenCalled()
  })

  it('sends every NHL goal by push and in-app, even when the hourly game budget is full', async () => {
    cached({ ...game, period: 1, clock: '12:00', homeScore: 0, awayScore: 0 })
    h.budget.mockResolvedValue({ push: [], held: ['u'] })
    const detail = { sport: 'NHL', drives: [], scoringPlays: [], players: {}, hockey: { plays: [{ id: 'g1', text: 'Goal', scoring: true, period: 1, clock: '11:59', homeScore: 1, awayScore: 0, athleteIds: [] }], box: { home: { goalies: [] }, away: { goalies: [] } } } } as unknown as LiveGameDetail
    await observeGameAlerts('NHL', { ...game, period: 1, clock: '11:59', homeScore: 1, awayScore: 0 }, detail, ['u'])
    expect(h.dispatch).toHaveBeenCalledTimes(1)
    expect(h.dispatch.mock.calls[0][0]).toMatchObject({ type: 'game_scoring_play', skipChannels: { sms: true, email: true }, meta: { pushBudget: 'pushed' } })
    expect(h.budget).not.toHaveBeenCalled()
  })

  it('sends every soccer goal without a halftime or close alert', async () => {
    cached({ ...game, period: 2, clock: '85', homeScore: 0, awayScore: 0 })
    const detail = { sport: 'SOCCER', drives: [], scoringPlays: [{ id: 'g1', text: 'Goal', homeScore: 1, awayScore: 0 }], players: {} } as unknown as LiveGameDetail
    await observeGameAlerts('SOCCER', { ...game, period: 2, clock: '86', homeScore: 1, awayScore: 0 }, detail, ['u'])
    expect(h.dispatch.mock.calls.map(c => c[0].type)).toEqual(['game_scoring_play'])
  })

  it('sends one close alert at seven points in the final basketball quarter', async () => {
    cached({ ...game, homeScore: 100, awayScore: 92 })
    await observeGameAlerts('NBA', { ...game, homeScore: 100, awayScore: 93 }, null, { game: ['u'], broad: ['u', 'fan'] })
    const call = h.dispatch.mock.calls[0][0]
    expect(call).toMatchObject({ type: 'game_close', userIds: ['u', 'fan'], skipChannels: { sms: true, email: true } })
    expect(h.cap).toHaveBeenCalled()
  })

  it('puts winner logo, both crests and final score on the final push and in-app row', async () => {
    cached()
    h.budget.mockResolvedValue({ push: [], held: ['u'] })
    await observeGameAlerts('MLB', { ...game, completed: true }, null, ['u'])
    const call = h.dispatch.mock.calls[0][0]
    expect(call).toMatchObject({ type: 'game_final', userIds: ['u'], skipChannels: { sms: true, email: true }, meta: {
      homeLogo: game.homeLogo, awayLogo: game.awayLogo, iconUrl: game.homeLogo,
      homeScore: 3, awayScore: 2, pushBudget: 'pushed',
    } })
    expect(call.title).toContain('AWY 2 — HOM 3')
    expect(h.budget).not.toHaveBeenCalled()
  })

  it('keeps the score and crests on a starter recap in place of the plain final', async () => {
    cached()
    const detail = { sport: 'NFL', drives: [], scoringPlays: [], players: { qb: [{ name: 'QB', group: 'passing', labels: ['YDS'], stats: ['280'] }] } } as unknown as LiveGameDetail
    await observeGameAlerts('NFL', { ...game, completed: true }, detail, { game: ['u'], broad: [], startersByUser: new Map([['u', ['qb']]]) })
    const call = h.dispatch.mock.calls[0][0]
    expect(call).toMatchObject({ type: 'postgame_recap', skipChannels: { sms: true, email: true }, meta: { homeLogo: game.homeLogo, awayLogo: game.awayLogo, iconUrl: game.homeLogo } })
    expect(call.title).toContain('Final: AWY 2 — HOM 3')
  })

  it('retains its cursor when delivery fails', async () => {
    cached()
    h.dispatch.mockResolvedValue({ delivered: 0, failed: 1 })
    await expect(observeGameAlerts('MLB', { ...game, completed: true }, null, ['u'])).rejects.toThrow('dispatch failed')
    expect(h.write).not.toHaveBeenCalled()
  })

  it('does not mistake a database outage for a fresh baseline', async () => {
    h.read.mockRejectedValue(new Error('database down'))
    await expect(observeGameAlerts('MLB', game, null, ['u'])).rejects.toThrow('database down')
    expect(h.write).not.toHaveBeenCalled()
  })

  it('avoids duplicate game and starter notifications for the same athlete', () => {
    expect(recipientsFor({ key: 'play:1', type: 'game_scoring_play', title: '', body: '', athleteIds: ['qb'] },
      { game: ['starter', 'fan'], broad: [], startersByAthlete: new Map([['qb', new Set(['starter'])]]) }).game).toEqual(['fan'])
  })
})
