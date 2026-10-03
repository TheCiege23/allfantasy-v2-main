// @vitest-environment node
/**
 * Player news → TEAM followers (owner's call, 2026-10-03). Someone who follows a team hears its
 * news and injuries under `followed_teams` — minus anyone already told through a roster or a player
 * follow (one story, one buzz), only for a story that maps to ONE team, and within the daily cap.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  newsFind: vi.fn(),
  newsUpdate: vi.fn(),
  rosterFind: vi.fn(),
  dispatch: vi.fn(),
  classify: vi.fn(),
  playerFollowers: vi.fn(),
  teamFollowers: vi.fn(),
  resolveTeam: vi.fn(),
  cap: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerNewsRecord: { findMany: h.newsFind, updateMany: h.newsUpdate },
    redraftRosterPlayer: { findMany: h.rosterFind },
  },
}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))
vi.mock('@/lib/news/player-news-category', () => ({ classifyPlayerNewsCategory: h.classify }))
vi.mock('@/lib/follows/playerFollows', () => ({ listFollowerIdsForPlayer: h.playerFollowers }))
vi.mock('@/lib/follows/teamFollows', () => ({ listFollowerIdsForTeam: h.teamFollowers }))
vi.mock('@/lib/follows/teamFollowAlerts', () => ({ resolveNewsTeam: h.resolveTeam, withinTeamFollowDailyCap: h.cap }))
vi.mock('@/lib/notifications/playerNewsRepeatGuard', () => ({
  alreadyToldAbout: async () => new Set<string>(),
  recordToldAbout: async () => undefined,
}))

import { dispatchPendingPlayerNewsNotifications } from '@/lib/notifications/PlayerNewsNotificationService'

const ROW = {
  id: 'news-1',
  sport: 'NFL',
  playerName: 'Jordan Love',
  team: 'Packers',
  headline: 'Love (knee) limited at practice',
  body: null,
  impact: 'medium',
}

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset()
  h.newsFind.mockResolvedValue([ROW])
  h.newsUpdate.mockResolvedValue({ count: 1 })
  h.dispatch.mockResolvedValue(undefined)
  h.classify.mockReturnValue('injury')
  h.rosterFind.mockResolvedValue([])
  h.playerFollowers.mockResolvedValue([])
  h.teamFollowers.mockResolvedValue([])
  h.resolveTeam.mockResolvedValue('GB')
  h.cap.mockImplementation(async (ids: string[]) => ids)
})

const teamCalls = () => h.dispatch.mock.calls.map((c) => c[0]).filter((p) => p.category === 'followed_teams')

describe('team followers', () => {
  it('a team follower is told under followed_teams, with no league, keyed to the resolved team', async () => {
    h.teamFollowers.mockResolvedValue(['fan-1'])
    const out = await dispatchPendingPlayerNewsNotifications()
    expect(h.resolveTeam).toHaveBeenCalledWith('NFL', 'Packers', 'Jordan Love')
    expect(h.teamFollowers).toHaveBeenCalledWith('NFL', 'GB')
    expect(teamCalls()).toHaveLength(1)
    expect(teamCalls()[0]).toMatchObject({
      userIds: ['fan-1'],
      category: 'followed_teams',
      leagueId: null,
      severity: 'high',
      dedupePrefix: 'player-news:news-1',
      meta: expect.objectContaining({ followedTeam: 'GB' }),
    })
    expect(out).toMatchObject({ notified: 1, teamFollowerRecipients: 1, noRoster: 0 })
  })

  it('🛑 someone who rosters the player, or follows him, is told ONCE — by that path, not again as a team fan', async () => {
    h.rosterFind.mockResolvedValue([{ roster: { ownerId: 'mgr-1', leagueId: 'lg-1' } }])
    h.playerFollowers.mockResolvedValue(['pfan-1'])
    h.teamFollowers.mockResolvedValue(['mgr-1', 'pfan-1', 'tfan-1'])
    await dispatchPendingPlayerNewsNotifications()
    expect(teamCalls()).toHaveLength(1)
    expect(teamCalls()[0].userIds).toEqual(['tfan-1'])
    const everyone = h.dispatch.mock.calls.flatMap((c) => c[0].userIds)
    expect(everyone.sort()).toEqual(['mgr-1', 'pfan-1', 'tfan-1'])
  })

  it('a story that maps to no single team tells no team follower', async () => {
    h.resolveTeam.mockResolvedValue(null)
    h.teamFollowers.mockResolvedValue(['fan-1'])
    const out = await dispatchPendingPlayerNewsNotifications()
    expect(h.teamFollowers).not.toHaveBeenCalled()
    expect(teamCalls()).toHaveLength(0)
    expect(out.noRoster).toBe(1)
  })

  it('people over today\'s cap are not told, and are counted', async () => {
    h.teamFollowers.mockResolvedValue(['fan-1', 'fan-2'])
    h.cap.mockImplementation(async (ids: string[]) => ids.filter((id) => id !== 'fan-2'))
    const out = await dispatchPendingPlayerNewsNotifications()
    expect(teamCalls()[0].userIds).toEqual(['fan-1'])
    expect(out).toMatchObject({ teamFollowerRecipients: 1, teamFollowCapped: 1 })
  })

  it('low-impact, non-injury news is never sent to team followers (the sender\'s own filter)', async () => {
    h.classify.mockReturnValue('general')
    h.teamFollowers.mockResolvedValue(['fan-1'])
    await dispatchPendingPlayerNewsNotifications()
    expect(teamCalls()).toHaveLength(0)
  })

  it('follows unavailable (null) is skipped, not an error', async () => {
    h.teamFollowers.mockResolvedValue(null)
    const out = await dispatchPendingPlayerNewsNotifications()
    expect(teamCalls()).toHaveLength(0)
    expect(out.noRoster).toBe(1)
  })
})
