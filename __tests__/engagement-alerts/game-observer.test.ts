import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), dispatch: vi.fn(), budget: vi.fn(), cap: vi.fn(), profiles: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsDataCache: { findUnique: h.read, upsert: h.write }, userProfile: { findMany: h.profiles } } }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))
vi.mock('@/lib/notifications/liveGamePushBudget', () => ({ splitByGameAlertPushBudget: h.budget }))
vi.mock('@/lib/follows/teamFollowAlerts', () => ({ withinDailyCap: h.cap }))
vi.mock('@/lib/notifications/sportAudience', () => ({ listSportsAlertAudience: vi.fn() }))
import { observeGameAlerts, recipientsFor } from '@/lib/engagement-alerts/gameAlertService'
import type { GameObservation } from '@/lib/engagement-alerts/gameEvents'
import type { LiveGameDetail } from '@/lib/live/espnGameSummary'

const game: GameObservation = { gameId: '12345', homeTeam: 'H', awayTeam: 'A', homeScore: 3, awayScore: 2, status: 'STATUS_IN_PROGRESS', statusDetail: 'Top 4th', period: 4, clock: '', completed: false }
const detail = (ids: string[]) => ({ sport: 'MLB', drives: [], scoringPlays: [], players: {}, baseball: { atBats: ids.map(id => ({ id, scoring: true, result: `Run ${id}`, events: [] })) } }) as unknown as LiveGameDetail
beforeEach(() => {
  vi.resetAllMocks()
  h.write.mockResolvedValue({}); h.dispatch.mockResolvedValue({ delivered: 1, failed: 0 }); h.read.mockResolvedValue(null)
  h.budget.mockImplementation(async (ids: string[]) => ({ push: ids, held: [] }))
  h.cap.mockImplementation(async (ids: string[]) => ids)
  h.profiles.mockResolvedValue([])
})

describe('persisted game observation', () => {
  it('bootstraps silently with all known play identities', async () => {
    await observeGameAlerts('MLB', game, detail(['1', '2']), ['u'])
    expect(h.dispatch).not.toHaveBeenCalled()
    expect(h.write.mock.calls[0][0].create.data.seen).toEqual(['play:1', 'play:2'])
  })
  it('does not miss the first score after a scheduled-game baseline', async () => {
    await observeGameAlerts('MLB', { ...game, status: 'STATUS_SCHEDULED', period: 0, homeScore: null, awayScore: null }, null, ['u'])
    h.read.mockResolvedValue({ data: h.write.mock.calls[0][0].create.data })
    await observeGameAlerts('MLB', { ...game, period: 1, statusDetail: 'Top 1st' }, detail(['first']), ['u'])
    expect(h.dispatch).toHaveBeenCalledTimes(1)
    expect(h.dispatch.mock.calls[0][0].type).toBe('game_scoring_play')
  })
  it('delivers each new play once and the final independently', async () => {
    h.read.mockResolvedValue({ data: { observation: game, seen: ['play:1'], playsInitialized: true } })
    await observeGameAlerts('MLB', { ...game, completed: true }, detail(['1', '2', '3']), ['u'])
    expect(h.dispatch.mock.calls.map(c => c[0].type)).toEqual(['game_final', 'game_scoring_play', 'game_scoring_play'])
    expect(h.dispatch.mock.calls[1][0].dedupePrefix).not.toEqual(h.dispatch.mock.calls[2][0].dedupePrefix)
  })
  it('retains its cursor on delivery failures', async () => {
    h.read.mockResolvedValue({ data: { observation: game, seen: [], playsInitialized: true } })
    h.dispatch.mockResolvedValue({ delivered: 0, failed: 1 })
    await expect(observeGameAlerts('MLB', game, detail(['2']), ['u'])).rejects.toThrow('dispatch failed')
    expect(h.write).not.toHaveBeenCalled()
  })
  it('does not mistake a database outage for a bootstrap', async () => {
    h.read.mockRejectedValue(new Error('database down'))
    await expect(observeGameAlerts('MLB', game, detail(['2']), ['u'])).rejects.toThrow('database down')
    expect(h.write).not.toHaveBeenCalled()
  })
  it('baselines the first available play feed after a summary outage', async () => {
    h.read.mockResolvedValue({ data: { observation: game, seen: [], playsInitialized: false } })
    await observeGameAlerts('MLB', game, detail(['old1', 'old2']), ['u'])
    expect(h.dispatch).not.toHaveBeenCalled()
  })
})

describe('who hears what, and on which channel', () => {
  it('sends plays to the game audience only, never by email or text', async () => {
    h.read.mockResolvedValue({ data: { observation: game, seen: [], playsInitialized: true } })
    await observeGameAlerts('MLB', game, detail(['9']), { game: ['follower'], broad: ['follower', 'stranger'] })
    expect(h.dispatch).toHaveBeenCalledTimes(1)
    expect(h.dispatch.mock.calls[0][0]).toMatchObject({ userIds: ['follower'], category: 'performance_alerts', skipChannels: { sms: true, email: true } })
  })
  it('sends a close game to everyone in the sport, under the daily cap, without email', async () => {
    const before = { ...game, sport: 'NHL', period: 3, clock: '3:00', homeScore: 2, awayScore: 2 }
    h.read.mockResolvedValue({ data: { observation: before, seen: [], playsInitialized: true } })
    h.cap.mockImplementation(async (ids: string[]) => ids.filter(id => id !== 'capped'))
    await observeGameAlerts('NHL', { ...before, clock: '1:50', broadcast: 'TNT' }, null, { game: ['follower'], broad: ['follower', 'fan', 'capped'] })
    const call = h.dispatch.mock.calls[0][0]
    expect(call).toMatchObject({ type: 'game_close', category: 'live_game_alerts', skipChannels: { sms: true, email: true } })
    expect(call.userIds).toEqual(['follower', 'fan'])
    expect(call.body).toContain('Watch on TNT')
    expect(h.cap.mock.calls[0][0]).toEqual(['fan', 'capped'])
  })
  it('emails the final', async () => {
    h.read.mockResolvedValue({ data: { observation: game, seen: [], playsInitialized: true } })
    await observeGameAlerts('MLB', { ...game, completed: true }, null, ['u'])
    expect(h.dispatch.mock.calls[0][0].skipChannels).toEqual({ sms: true })
  })
  it('holds pushes over the hourly budget to the bell instead of buzzing the phone', async () => {
    h.read.mockResolvedValue({ data: { observation: game, seen: [], playsInitialized: true } })
    h.budget.mockResolvedValue({ push: ['a'], held: ['b'] })
    await observeGameAlerts('MLB', game, detail(['7']), { game: ['a', 'b'], broad: [] })
    expect(h.dispatch.mock.calls.map(c => [c[0].userIds, c[0].meta.pushBudget, !!c[0].skipChannels.push])).toEqual([[['a'], 'pushed', false], [['b'], 'held', true]])
  })
  it('honours each person’s live alert level', async () => {
    h.read.mockResolvedValue({ data: { observation: game, seen: [], playsInitialized: true } })
    h.profiles.mockResolvedValue([
      { userId: 'off', notificationPreferences: { liveAlertLevel: 'off' } },
      { userId: 'close', notificationPreferences: { liveAlertLevel: 'close_games' } },
      { userId: 'mine', notificationPreferences: { liveAlertLevel: 'my_teams' } },
    ])
    await observeGameAlerts('MLB', game, detail(['7']), { game: ['off', 'close', 'mine', 'default'], broad: [] })
    expect(h.dispatch.mock.calls[0][0].userIds).toEqual(['mine', 'default'])
    // A close game reaches "Close games only", and a sport-wide one skips "My teams & players".
    h.dispatch.mockClear()
    const before = { ...game, period: 3, clock: '3:00', homeScore: 2, awayScore: 2 }
    h.read.mockResolvedValue({ data: { observation: before, seen: [], playsInitialized: true } })
    await observeGameAlerts('NHL', { ...before, clock: '1:50' }, null, { game: [], broad: ['off', 'close', 'mine', 'default'] })
    expect(h.dispatch.mock.calls[0][0].userIds).toEqual(['close', 'default'])
  })
  it('skips managers starting a player named in the play — they already got the personal alert', () => {
    const out = recipientsFor({ key: 'play:1', type: 'game_scoring_play', title: '', body: '', athleteIds: ['qb'] },
      { game: ['starter', 'follower'], broad: [], startersByAthlete: new Map([['qb', new Set(['starter'])]]) })
    expect(out.game).toEqual(['follower'])
  })
})

it.each(['NBA', 'NHL'])('sends one %s interval alert across break and next-period polls, never scoring alerts', async sport => {
  const before = { ...game, period: 1, clock: '1:00', statusDetail: 'In progress' }
  const end = { ...before, clock: '0:00', statusDetail: 'End of period' }
  h.read.mockResolvedValue({ data: { observation: before, seen: [], playsInitialized: true } })
  const feed = { sport, drives: [], scoringPlays: [{ id: '1', text: 'Score' }], players: {}, basketball: { plays: [{ id: '2', scoring: true, athleteIds: [] }] } } as unknown as LiveGameDetail
  await observeGameAlerts(sport, end, feed, ['u'])
  expect(h.dispatch.mock.calls.map(c => c[0].type)).toEqual(['game_period_end'])
  expect(h.dispatch.mock.calls[0][0].skipChannels).toEqual({ sms: true, email: true })
  h.read.mockResolvedValue({ data: h.write.mock.calls[0][0].create.data })
  await observeGameAlerts(sport, { ...before, period: 2, homeLinescores: [10, 0], awayLinescores: [9, 0] }, feed, ['u'])
  expect(h.dispatch).toHaveBeenCalledTimes(1)
})

describe('one recap after every game', () => {
  const box = { sport: 'NFL', drives: [], scoringPlays: [], home: { id: 'h', abbrev: 'KC' }, away: { id: 'a', abbrev: 'BUF' },
    players: {
      qb: [{ name: 'Patrick Mahomes', group: 'passing', labels: ['C/ATT', 'YDS', 'AVG', 'TD', 'INT'], stats: ['22/32', '280', '8.8', '3', '0'] }],
      rb: [{ name: 'Isiah Pacheco', group: 'rushing', labels: ['CAR', 'YDS', 'AVG', 'TD'], stats: ['18', '92', '5.1', '1'] }],
    } } as unknown as LiveGameDetail
  it('turns the final into a personal recap of the starters, and keeps the plain final for everyone else', async () => {
    const live = { ...game, period: 4, statusDetail: 'Q4' }
    h.read.mockResolvedValue({ data: { observation: live, seen: [], playsInitialized: true } })
    await observeGameAlerts('NFL', { ...live, completed: true }, box, { game: ['starter', 'fan'], broad: [], startersByUser: new Map([['starter', ['qb', 'rb']]]) })
    const [recap, final] = h.dispatch.mock.calls.map(c => c[0])
    expect(recap).toMatchObject({ userIds: ['starter'], type: 'postgame_recap', skipChannels: { sms: true } })
    expect(recap.body).toContain('Patrick Mahomes: 22/32 C/ATT, 280 YDS, 3 TD')
    expect(recap.body).toContain('Isiah Pacheco: 92 YDS, 1 TD, 18 CAR')
    expect(recap.title).toContain('Recap — Final')
    expect(final).toMatchObject({ userIds: ['fan'], type: 'game_final' })
  })
  it('sends the plain final when no starter has a box-score line', async () => {
    h.read.mockResolvedValue({ data: { observation: game, seen: [], playsInitialized: true } })
    await observeGameAlerts('NFL', { ...game, completed: true }, box, { game: ['starter'], broad: [], startersByUser: new Map([['starter', ['nobody']]]) })
    expect(h.dispatch.mock.calls.map(c => c[0].type)).toEqual(['game_final'])
  })
})

describe('personal starter alerts', () => {
  it('go only to the managers starting that player, by push and the bell, and skip them on the game alert', async () => {
    const d = { ...detail([]), players: { b: [{ name: 'Aaron Judge', headshot: null, group: 'batting', labels: [], stats: [] }] },
      baseball: { atBats: [{ id: 'hr', batterId: 'b', scoring: true, resultType: 'Home Run', result: 'Judge homered', events: [] }] } } as unknown as LiveGameDetail
    h.read.mockResolvedValue({ data: { observation: game, seen: [], playsInitialized: true } })
    await observeGameAlerts('MLB', game, d, { game: ['owner', 'fan'], broad: [], startersByAthlete: new Map([['b', new Set(['owner'])]]) })
    const calls = h.dispatch.mock.calls.map(c => c[0])
    expect(calls.map(c => [c.type, c.userIds])).toEqual([['game_scoring_play', ['fan']], ['game_starter_play', ['owner']]])
    expect(calls[1].skipChannels).toEqual({ sms: true, email: true })
  })
  it('records a silent milestone without sending it', async () => {
    const line = [{ name: 'J', headshot: null, group: 'basketball', labels: ['PTS', 'REB', 'AST'], stats: ['41', '2', '2'] }]
    h.read.mockResolvedValue({ data: { observation: { ...game, period: 3 }, seen: [], playsInitialized: true } })
    await observeGameAlerts('NBA', { ...game, period: 3 }, { sport: 'NBA', drives: [], scoringPlays: [], players: { j: line } } as unknown as LiveGameDetail,
      { game: [], broad: [], startersByAthlete: new Map([['j', new Set(['owner'])]]) })
    expect(h.dispatch.mock.calls.map(c => c[0].title)).toEqual(['⭐ Your starter J: 40 points'])
    expect(h.write.mock.calls[0][0].create.data.seen).toEqual(expect.arrayContaining(['starter:pts20:j', 'starter:pts30:j', 'starter:pts40:j']))
  })
})
