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

/**
 * The identity registry the sender binds a story to (lib/notifications/newsPlayerBinding). Filtered
 * by the name asked for, so a lookup that asks the wrong question finds nobody.
 */
const REGISTRY = [
  { id: 'pim-gibbs', canonicalName: 'Jahmyr Gibbs', position: 'RB', currentTeam: 'DET', sleeperId: '9221' },
  { id: 'pim-jj-wr', canonicalName: 'Justin Jefferson', position: 'WR', currentTeam: 'MIN', sleeperId: '6794' },
  { id: 'pim-jj-lb', canonicalName: 'Justin Jefferson', position: 'LB', currentTeam: 'CLE', sleeperId: '13524' },
]

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerNewsRecord: { findMany: h.newsFind, updateMany: h.newsUpdate },
    redraftRosterPlayer: { findMany: h.rosterFind },
    playerIdentityMap: {
      findMany: async ({ where }: { where: { OR: Array<{ canonicalName?: { contains: string } }> } }) =>
        REGISTRY.filter((p) => where.OR.some((c) => c.canonicalName && p.canonicalName.toLowerCase().includes(c.canonicalName.contains.toLowerCase()))),
    },
  },
}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))
vi.mock('@/lib/news/player-news-category', () => ({ classifyPlayerNewsCategory: h.classify }))
vi.mock('@/lib/follows/playerFollows', () => ({ listFollowerIdsForPlayerIdentity: h.followers }))

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

const roster = (ownerId: string, leagueId: string) => ({ playerName: 'Jahmyr Gibbs', team: 'DET', sport: 'NFL', roster: { ownerId, leagueId } })

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset()
  h.newsFind.mockResolvedValue([ROW])
  h.newsUpdate.mockResolvedValue({ count: 1 })
  h.dispatch.mockResolvedValue({ requested: 1, delivered: 1, suppressed: 0, failed: 0 })
  h.classify.mockReturnValue('injury')
  h.rosterFind.mockResolvedValue([])
  h.followers.mockResolvedValue([])
})

const followerCalls = () => h.dispatch.mock.calls.map((c) => c[0]).filter((p) => p.category === 'followed_players')

describe('followers of a player in the news', () => {
  it('🛑 a follower who rosters him nowhere is told, under followed_players, with no league', async () => {
    h.followers.mockResolvedValue(['fan-1'])
    const out = await dispatchPendingPlayerNewsNotifications({ lookbackHours: 6 })

    // Keyed on the bound identity (his Sleeper id), not on the name the story spelled.
    expect(h.followers).toHaveBeenCalledWith(
      'NFL',
      expect.objectContaining({ identity: expect.objectContaining({ sleeperId: '9221' }), newsName: 'Jahmyr Gibbs' }),
    )
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

  it('a MEDIUM-impact signing still reaches followers (the old impact gate dropped every one)', async () => {
    h.newsFind.mockResolvedValue([{ ...ROW, impact: 'medium', headline: 'Gibbs signs four-year extension' }])
    h.classify.mockReturnValue('signing')
    h.followers.mockResolvedValue(['fan-1'])
    await dispatchPendingPlayerNewsNotifications()
    expect(followerCalls()[0]).toMatchObject({ type: 'player_news_update' })
  })

  it('an unconfirmed trade rumour is held, however high its impact', async () => {
    h.newsFind.mockResolvedValue([{ ...ROW, impact: 'high', headline: 'Gibbs reportedly traded to Dallas' }])
    h.classify.mockReturnValue('trade')
    h.followers.mockResolvedValue(['fan-1'])
    await dispatchPendingPlayerNewsNotifications()
    expect(followerCalls()).toHaveLength(0)
  })

  it('no roster and no follower counts as noRoster, and the row is still stamped', async () => {
    const out = await dispatchPendingPlayerNewsNotifications()
    expect(out).toMatchObject({ notified: 0, noRoster: 1, scanned: 1 })
    expect(h.newsUpdate).toHaveBeenCalledWith({ where: { id: { in: ['news-1'] } }, data: expect.any(Object) })
  })
})

/*
 * 🛑 The roster lookup was `playerName CONTAINS …` with no sport or club (2026-10-11), so a story
 * about the Browns' LB Justin Jefferson buzzed every manager of the Vikings WR.
 */
describe('which rostered player a story is about', () => {
  it("a namesake on another club, or in another sport, is not told", async () => {
    h.newsFind.mockResolvedValue([{ ...ROW, playerName: 'Justin Jefferson', team: 'CLE', headline: 'Jefferson (hamstring) ruled out' }])
    h.rosterFind.mockResolvedValue([
      { playerName: 'Justin Jefferson', team: 'MIN', sport: 'NFL', roster: { ownerId: 'vikings-wr-mgr', leagueId: 'lg-1' } },
      { playerName: 'Justin Jefferson', team: 'CLE', sport: 'NFL', roster: { ownerId: 'browns-lb-mgr', leagueId: 'lg-2' } },
      { playerName: 'Justin Jefferson Jr.', team: null, sport: 'NBA', roster: { ownerId: 'nba-mgr', leagueId: 'lg-3' } },
    ])
    await dispatchPendingPlayerNewsNotifications({ lookbackHours: 6 })
    const told = h.dispatch.mock.calls.flatMap((c) => c[0].userIds ?? [])
    expect(told).toContain('browns-lb-mgr')
    expect(told).not.toContain('vikings-wr-mgr')
    expect(told).not.toContain('nba-mgr')
  })
})
