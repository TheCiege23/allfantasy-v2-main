// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** /api/user/team-follows and the `followed_teams` notification category. */

const h = vi.hoisted(() => ({
  userId: 'u-1' as string | null,
  follow: vi.fn(async () => 'followed'),
  unfollow: vi.fn(async () => 'unfollowed'),
  list: vi.fn(async () => [] as unknown[] | null),
  teams: vi.fn(async () => [{ abbr: 'GB', name: 'Green Bay Packers' }]),
  seen: vi.fn(async () => undefined),
}))

vi.mock('@/lib/auth-guard', () => ({
  requireAuth: async () =>
    h.userId
      ? { ok: true, userId: h.userId, session: {} }
      : { ok: false, response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }) },
}))
vi.mock('@/lib/follows/teamFollows', () => ({
  MAX_TEAM_FOLLOWS: 30,
  TEAM_FOLLOW_SPORTS: ['NFL', 'NBA'],
  isTeamFollowSport: (s: string) => ['NFL', 'NBA'].includes(s),
  followTeam: h.follow,
  unfollowTeam: h.unfollow,
  listTeamFollows: h.list,
  listTeamsForSport: h.teams,
  markTeamFollowPromptSeen: h.seen,
}))

import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/user/team-follows/route'
import { NOTIFICATION_CATEGORY_IDS, NOTIFICATION_CATEGORY_LABELS } from '@/lib/notification-settings/types'
import { isPushCategory } from '@/lib/push-notifications/categories'
import { resolveNotificationPreferences } from '@/lib/notification-settings/NotificationPreferenceResolver'

const get = (q = '') => GET(new NextRequest(`https://x.test/api/user/team-follows${q}`))
const post = (body: unknown) =>
  POST(new NextRequest('https://x.test/api/user/team-follows', { method: 'POST', body: JSON.stringify(body) }))

let n = 0
beforeEach(() => {
  h.userId = `u-${++n}`
  for (const f of [h.follow, h.unfollow, h.list, h.teams, h.seen]) f.mockClear()
  h.follow.mockImplementation(async () => 'followed')
  h.list.mockImplementation(async () => [])
})

describe('GET', () => {
  it('returns the sports, that sport\'s teams and the follows', async () => {
    const res = await get('?sport=NFL')
    expect(await res.json()).toMatchObject({ sports: ['NFL', 'NBA'], max: 30, teams: [{ abbr: 'GB' }], follows: [] })
  })
  it('follows: null when the table is missing — so the UI hides, not claims "none"', async () => {
    h.list.mockImplementation(async () => null)
    expect((await (await get('?sport=NFL')).json()).follows).toBeNull()
  })
  it('refuses without a session', async () => {
    h.userId = null
    expect((await get()).status).toBe(401)
  })
})

describe('POST', () => {
  it('follows and unfollows', async () => {
    expect((await post({ action: 'follow', sport: 'NFL', teamAbbr: 'GB' })).status).toBe(200)
    expect(h.follow).toHaveBeenCalledWith(expect.any(String), 'NFL', 'GB')
    expect((await post({ action: 'unfollow', sport: 'NFL', teamAbbr: 'GB' })).status).toBe(200)
    expect(h.unfollow).toHaveBeenCalled()
  })
  it('maps invalid / limit / unavailable to 400 / 409 / 503', async () => {
    h.follow.mockImplementation(async () => 'invalid')
    expect((await post({ action: 'follow', sport: 'NFL', teamAbbr: 'XX' })).status).toBe(400)
    h.follow.mockImplementation(async () => 'limit')
    expect((await post({ action: 'follow', sport: 'NFL', teamAbbr: 'GB' })).status).toBe(409)
    h.follow.mockImplementation(async () => 'unavailable')
    expect((await post({ action: 'follow', sport: 'NFL', teamAbbr: 'GB' })).status).toBe(503)
  })
  it('records the prompt as seen', async () => {
    expect((await post({ action: 'dismissPrompt' })).status).toBe(200)
    expect(h.seen).toHaveBeenCalled()
  })
  it('rejects an unknown action and a missing team', async () => {
    expect((await post({ action: 'hack' })).status).toBe(400)
    expect((await post({ action: 'follow', sport: 'NFL' })).status).toBe(400)
  })
})

describe('the followed_teams category', () => {
  it('is a real, push-capable setting, on by default, with its own label', () => {
    expect(NOTIFICATION_CATEGORY_IDS).toContain('followed_teams')
    expect(NOTIFICATION_CATEGORY_LABELS.followed_teams).toMatch(/teams you follow/i)
    expect(isPushCategory('followed_teams')).toBe(true)
    expect(resolveNotificationPreferences(null).categories?.followed_teams).toMatchObject({ enabled: true, inApp: true, push: true })
  })
})
