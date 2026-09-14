// @vitest-environment node
/**
 * Player news → followers (user decisions, 2026-09-14). The pending-news dispatcher already
 * told rostering managers; followers now hear about the same stories under their own
 * `followed_players` switch — minus anyone already told through a roster, so one story is
 * never two buzzes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  newsFind: vi.fn(),
  newsUpdate: vi.fn(),
  rosterFind: vi.fn(),
  dispatch: vi.fn(),
  classify: vi.fn(),
  followers: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerNewsRecord: { findMany: h.newsFind, updateMany: h.newsUpdate },
    redraftRosterPlayer: { findMany: h.rosterFind },
  },
}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))
vi.mock('@/lib/news/player-news-category', () => ({ classifyPlayerNewsCategory: h.classify }))
vi.mock('@/lib/follows/playerFollows', () => ({ listFollowerIdsForPlayer: h.followers }))

import { dispatchPendingPlayerNewsNotifications } from '@/lib/notifications/PlayerNewsNotificationService'

const ROW = {
  id: 'news-1',
  sport: 'NFL',
  playerName: 'Jahmyr Gibbs',
  team: 'DET',
  headline: 'Gibbs (hamstring) ruled out Sunday',
  body: null,
  impact: 'medium',
}

const roster = (ownerId: string, leagueId: string) => ({ roster: { ownerId, leagueId } })

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset()
  h.newsFind.mockResolvedValue([ROW])
  h.newsUpdate.mockResolvedValue({ count: 1 })
  h.dispatch.mockResolvedValue(undefined)
  h.classify.mockReturnValue('injury')
  h.rosterFind.mockResolvedValue([])
  h.followers.mockResolvedValue([])
})

const followerCalls = () => h.dispatch.mock.calls.map((c) => c[0]).filter((p) => p.category === 'followed_players')

describe('followers of a player in the news', () => {
  it('🛑 a follower who rosters him nowhere is told, under followed_players, with no league', async () => {
    h.followers.mockResolvedValue(['fan-1'])
    const out = await dispatchPendingPlayerNewsNotifications({ lookbackHours: 6 })

    expect(h.followers).toHaveBeenCalledWith('NFL', 'Jahmyr Gibbs')
    expect(followerCalls()).toHaveLength(1)
    expect(followerCalls()[0]).toMatchObject({
      userIds: ['fan-1'],
      category: 'followed_players',
      type: 'player_injury_update',
      leagueId: null,
      severity: 'high',
      dedupePrefix: 'player-news:news-1',
      meta: expect.objectContaining({ followed: true }),
    })
    expect(out).toMatchObject({ notified: 1, recipients: 1, followerRecipients: 1, noRoster: 0 })
  })

  it('🛑 a manager who rosters AND follows him gets the roster alert only — never two', async () => {
    h.rosterFind.mockResolvedValue([roster('mgr-1', 'lg-1'), roster('mgr-2', 'lg-1')])
    h.followers.mockResolvedValue(['mgr-1', 'fan-1'])
    const out = await dispatchPendingPlayerNewsNotifications()

    const roster1 = h.dispatch.mock.calls.map((c) => c[0]).find((p) => p.category === 'injury_alerts')
    expect(roster1.userIds.sort()).toEqual(['mgr-1', 'mgr-2'])
    expect(followerCalls()).toHaveLength(1)
    expect(followerCalls()[0].userIds).toEqual(['fan-1'])
    expect(out).toMatchObject({ recipients: 3, followerRecipients: 1 })
  })

  it('🛑 follows unavailable (null) sends to followers nobody and is not an error', async () => {
    h.rosterFind.mockResolvedValue([roster('mgr-1', 'lg-1')])
    h.followers.mockResolvedValue(null)
    const out = await dispatchPendingPlayerNewsNotifications()
    expect(followerCalls()).toHaveLength(0)
    expect(out).toMatchObject({ notified: 1, recipients: 1, followerRecipients: 0 })
  })

  it('a follower lookup that throws is treated like no followers, and roster managers are still told', async () => {
    h.rosterFind.mockResolvedValue([roster('mgr-1', 'lg-1')])
    h.followers.mockRejectedValue(new Error('db down'))
    await dispatchPendingPlayerNewsNotifications()
    expect(h.dispatch).toHaveBeenCalledTimes(1)
    expect(h.dispatch.mock.calls[0][0].category).toBe('injury_alerts')
  })

  it('low-impact news that is not an injury reaches neither roster nor followers', async () => {
    h.classify.mockReturnValue('player_news')
    h.followers.mockResolvedValue(['fan-1'])
    const out = await dispatchPendingPlayerNewsNotifications()
    expect(h.dispatch).not.toHaveBeenCalled()
    expect(h.followers).not.toHaveBeenCalled()
    expect(out.notified).toBe(0)
  })

  it('high-impact non-injury news goes to followers as player news, not an injury', async () => {
    h.newsFind.mockResolvedValue([{ ...ROW, impact: 'high', headline: 'Gibbs traded to Dallas' }])
    h.classify.mockReturnValue('trade')
    h.followers.mockResolvedValue(['fan-1'])
    await dispatchPendingPlayerNewsNotifications()
    expect(followerCalls()[0]).toMatchObject({ type: 'player_news_update', severity: 'medium' })
  })

  it('no roster and no follower counts as noRoster, and the row is still stamped', async () => {
    const out = await dispatchPendingPlayerNewsNotifications()
    expect(out).toMatchObject({ notified: 0, noRoster: 1, scanned: 1 })
    expect(h.newsUpdate).toHaveBeenCalledWith({ where: { id: { in: ['news-1'] } }, data: expect.any(Object) })
  })
})
