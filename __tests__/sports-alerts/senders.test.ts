// @vitest-environment node
/**
 * The two senders end to end, with the database and dispatcher mocked: who is told, under which
 * category, and what is never sent twice or sent stale.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

const h = vi.hoisted(() => ({
  newsFind: vi.fn(),
  ledgerCreate: vi.fn(),
  ledgerCreateMany: vi.fn(),
  ledgerFindUnique: vi.fn(),
  followers: vi.fn(),
  players: vi.fn(),
  dispatch: vi.fn(),
  liveScores: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsNews: { findMany: h.newsFind },
    sportsDataCache: { create: h.ledgerCreate, createMany: h.ledgerCreateMany, findUnique: h.ledgerFindUnique },
  },
}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))
vi.mock('@/lib/notifications/sportAudience', () => ({ listUserIdsPlayingSport: h.players, listSportsAlertAudience: h.players }))
vi.mock('@/lib/follows/teamFollowAlerts', () => ({ withinDailyCap: async (ids: string[]) => ids }))
vi.mock('@/lib/follows/teamScoreAlerts', () => ({ TEAM_SCORE_ALERTS_PER_DAY: 20 }))
vi.mock('@/lib/follows/teamFollows', () => ({
  isTeamFollowSport: (s: string) => ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB'].includes(s),
  getTeamIndex: async () => ({}),
  listTeamsForSport: async (s: string) =>
    s === 'NFL'
      ? [
          { abbr: 'ARI', name: 'Arizona Cardinals' },
          { abbr: 'HOU', name: 'Houston Texans' },
        ]
      : [],
  listFollowerIdsForTeam: h.followers,
}))
vi.mock('@/lib/follows/teamResolver', () => ({
  resolveTeam: (_i: unknown, name: string) => ({ 'New York Knicks': 'NY', 'Boston Celtics': 'BOS', 'Kansas City Chiefs': 'KC' })[name] ?? null,
}))
vi.mock('@/lib/sports-live-scores-service', () => ({ getLiveScoresForSport: h.liveScores }))

import { dispatchBreakingNewsAlerts } from '@/lib/news/breakingNewsAlerts'
import { audienceFor, dispatchGameMomentAlerts } from '@/lib/live/gameMomentAlerts'

const NOW = new Date('2026-10-15T20:00:00Z')

function news(over: Record<string, unknown> = {}) {
  return {
    id: 'n1',
    sport: 'NFL',
    title: 'Sources: Cardinals trade Marvin Harrison Jr. to Texans',
    description: null,
    source: 'espn',
    sourceUrl: 'https://www.espn.com/nfl/story/_/id/1',
    team: null,
    publishedAt: new Date('2026-10-15T19:40:00Z'),
    fetchedAt: new Date('2026-10-15T19:42:00Z'),
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.ledgerCreate.mockResolvedValue({})
  h.ledgerCreateMany.mockResolvedValue({ count: 1 })
  h.dispatch.mockResolvedValue(undefined)
  h.players.mockResolvedValue(['u-player-1', 'u-player-2'])
  h.followers.mockImplementation(async (_s: string, team: string) => (team === 'HOU' || team === 'NY' ? ['u-fan'] : []))
})

describe('breaking news', () => {
  it('sends the MHJ trade once, to everyone who plays NFL plus the teams’ followers', async () => {
    h.newsFind.mockResolvedValue([news(), news({ id: 'n2', source: 'newsapi_everything', sourceUrl: 'https://apnews.com/a', title: 'Cardinals trade Marvin Harrison Jr. to Texans' })])
    const r = await dispatchBreakingNewsAlerts({ now: NOW })
    expect(r.sent).toBe(1)
    expect(h.dispatch).toHaveBeenCalledTimes(1)
    const call = h.dispatch.mock.calls[0][0]
    expect(call.category).toBe('breaking_news')
    expect(new Set(call.userIds)).toEqual(new Set(['u-fan', 'u-player-1', 'u-player-2']))
    expect(call.body).toContain('via ESPN')
    expect(call.title).toContain('(report)')
  })

  it('does not resend a story another run already claimed', async () => {
    h.newsFind.mockResolvedValue([news()])
    h.ledgerCreate.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }))
    const r = await dispatchBreakingNewsAlerts({ now: NOW })
    expect(r.alreadySent).toBe(1)
    expect(h.dispatch).not.toHaveBeenCalled()
  })

  it('ignores untrusted outlets and opinion pieces', async () => {
    h.newsFind.mockResolvedValue([
      news({ sourceUrl: 'https://nfltraderumors.co/x' }),
      news({ id: 'n3', title: 'Why the Texans traded for Marvin Harrison Jr.' }),
    ])
    const r = await dispatchBreakingNewsAlerts({ now: NOW })
    expect(r.candidates).toBe(0)
    expect(h.dispatch).not.toHaveBeenCalled()
  })

  it('sends an ordinary signing to the team’s followers only', async () => {
    h.newsFind.mockResolvedValue([news({ title: 'Texans sign veteran long snapper' })])
    await dispatchBreakingNewsAlerts({ now: NOW })
    expect(h.players).not.toHaveBeenCalled()
    expect(h.dispatch.mock.calls[0][0].userIds).toEqual(['u-fan'])
  })
})

function scoreRow(over: Record<string, unknown> = {}) {
  return {
    gameId: '401',
    homeTeam: 'BOS',
    homeTeamFull: 'Boston Celtics',
    awayTeam: 'NY',
    awayTeamFull: 'New York Knicks',
    homeScore: 101,
    awayScore: 99,
    status: 'STATUS_IN_PROGRESS',
    statusDetail: '2:10 - 4th',
    period: 4,
    clock: '2:10',
    completed: false,
    eventName: 'New York Knicks at Boston Celtics',
    ...over,
  }
}

describe('live game moments', () => {
  it('a close Knicks finish reaches Knicks followers and NBA players, under separate categories', async () => {
    h.liveScores.mockResolvedValue({ source: 'espn_live', scores: [scoreRow()] })
    await dispatchGameMomentAlerts({ now: NOW, sports: ['NBA'] })
    const cats = h.dispatch.mock.calls.map((c) => [c[0].category, c[0].userIds])
    expect(cats).toEqual([
      ['followed_team_scores', ['u-fan']],
      ['live_game_alerts', ['u-player-1', 'u-player-2']],
    ])
    expect(h.dispatch.mock.calls[0][0].title).toContain('Close game')
  })

  it('a regular-season halftime goes to followers only', async () => {
    h.liveScores.mockResolvedValue({ source: 'espn_live', scores: [scoreRow({ status: 'STATUS_HALFTIME', period: 2, clock: '0.0' })] })
    await dispatchGameMomentAlerts({ now: NOW, sports: ['NBA'] })
    expect(h.dispatch).toHaveBeenCalledTimes(1)
    expect(h.dispatch.mock.calls[0][0].category).toBe('followed_team_scores')
  })

  it('never announces a final the job did not see live (first deploy, restart)', async () => {
    h.liveScores.mockResolvedValue({ source: 'espn_live', scores: [scoreRow({ completed: true, status: 'STATUS_FINAL' })] })
    h.ledgerFindUnique.mockResolvedValue(null)
    await dispatchGameMomentAlerts({ now: NOW, sports: ['NBA'] })
    expect(h.dispatch).not.toHaveBeenCalled()

    h.ledgerFindUnique.mockResolvedValue({ cacheKey: 'seen' })
    await dispatchGameMomentAlerts({ now: NOW, sports: ['NBA'] })
    expect(h.dispatch).toHaveBeenCalledTimes(1)
  })

  it('ignores cached fallback rows, which carry no clock', async () => {
    h.liveScores.mockResolvedValue({ source: 'db_cache', scores: [scoreRow()] })
    await dispatchGameMomentAlerts({ now: NOW, sports: ['NBA'] })
    expect(h.dispatch).not.toHaveBeenCalled()
  })

  it('one sport failing does not stop the next', async () => {
    h.liveScores.mockRejectedValueOnce(new Error('ESPN down')).mockResolvedValueOnce({ source: 'espn_live', scores: [scoreRow()] })
    const r = await dispatchGameMomentAlerts({ now: NOW, sports: ['NHL', 'NBA'] })
    expect(r.sports.NHL.error).toContain('ESPN down')
    expect(r.sports.NBA.sent).toBe(1)
  })

  it('leaves football halftime and final to teamScoreAlerts, but playoff checkpoints still reach players', () => {
    const fans = new Set(['u-fan'])
    expect(audienceFor({ kind: 'halftime', sport: 'NFL', gameId: '1', postseason: false }, fans, ['p'])).toEqual({ followers: [], broad: [] })
    expect(audienceFor({ kind: 'final', sport: 'NFL', gameId: '1', postseason: true }, fans, ['p', 'u-fan'])).toEqual({ followers: [], broad: ['p'] })
    expect(audienceFor({ kind: 'seventh_inning', sport: 'MLB', gameId: '1', postseason: true }, fans, ['p', 'u-fan'])).toEqual({
      followers: ['u-fan'],
      broad: ['p'],
    })
  })
})
