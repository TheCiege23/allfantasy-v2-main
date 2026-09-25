// @vitest-environment node
/**
 * Player news must not repeat itself to the same person. Measured in production 2026-09-25: one
 * manager got "🏥 Injury Update: Puka Nacua" seven times in two days, four of them the SAME ESPN
 * headline re-ingested under fresh timestamps. The headlines below are those real rows.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  news: [] as Array<Record<string, unknown>>,
  roster: [] as Array<{ roster: { ownerId: string; leagueId: string } }>,
  followers: [] as string[],
  cache: new Map<string, Date>(),
  cacheDown: false,
  dispatch: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerNewsRecord: { findMany: async () => h.news, updateMany: async () => ({ count: 1 }) },
    redraftRosterPlayer: { findMany: async () => h.roster },
    sportsDataCache: {
      findMany: async ({ where }: { where: { cacheKey: { in: string[] }; expiresAt: { gt: Date } } }) => {
        if (h.cacheDown) throw new Error('db down')
        return where.cacheKey.in
          .filter((k) => (h.cache.get(k)?.getTime() ?? 0) > where.expiresAt.gt.getTime())
          .map((cacheKey) => ({ cacheKey }))
      },
      deleteMany: async ({ where }: { where: { cacheKey: { in: string[] }; expiresAt: { lte: Date } } }) => {
        for (const k of where.cacheKey.in) if ((h.cache.get(k)?.getTime() ?? Infinity) <= where.expiresAt.lte.getTime()) h.cache.delete(k)
        return { count: 0 }
      },
      createMany: async ({ data }: { data: Array<{ cacheKey: string; expiresAt: Date }> }) => {
        if (h.cacheDown) throw new Error('db down')
        for (const r of data) if (!h.cache.has(r.cacheKey)) h.cache.set(r.cacheKey, r.expiresAt)
        return { count: data.length }
      },
    },
  },
}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))
vi.mock('@/lib/follows/playerFollows', () => ({ listFollowerIdsForPlayer: async () => h.followers }))

import { dispatchPendingPlayerNewsNotifications } from '@/lib/notifications/PlayerNewsNotificationService'
import { injuryStatusTag, storyKey, topicKey } from '@/lib/notifications/playerNewsRepeatGuard'

const MCVAY = "McVay says Nacua's injury not 'long-term' concern, but Rams being cautious"
const row = (id: string, headline: string) => ({
  id, sport: 'NFL', playerName: 'Puka Nacua', team: 'LAR', headline, body: null, impact: 'high',
})
const roster = (ownerId: string, leagueId: string) => ({ roster: { ownerId, leagueId } })
const toldUsers = () => h.dispatch.mock.calls.flatMap((c) => (c[0] as { userIds: string[] }).userIds)

async function run(...rows: Array<Record<string, unknown>>) {
  h.dispatch.mockClear()
  h.news = rows
  return dispatchPendingPlayerNewsNotifications()
}

beforeEach(() => {
  h.cache.clear()
  h.cacheDown = false
  h.followers = []
  h.roster = [roster('mgr', 'lg-1')]
  h.dispatch.mockReset()
  h.dispatch.mockResolvedValue(undefined)
})

describe('the same story, re-ingested', () => {
  it('🛑 is sent once — the four identical ESPN rows become one alert', async () => {
    await run(row('n1', MCVAY))
    expect(toldUsers()).toEqual(['mgr'])
    for (const id of ['n2', 'n3', 'n4']) {
      const out = await run(row(id, MCVAY))
      expect(h.dispatch).not.toHaveBeenCalled()
      expect(out.repeatsSuppressed).toBe(1)
    }
  })

  it('🛑 still once when the copy lands after the one-day status window has passed', async () => {
    await run(row('n1', MCVAY))
    // Age every status (topic) key past its 24h life; the story keys keep their 7 days.
    for (const k of h.cache.keys()) if (k.includes(':topic:')) h.cache.set(k, new Date(Date.now() - 1000))
    await run(row('n4', MCVAY))
    expect(h.dispatch).not.toHaveBeenCalled()
    // A genuinely new story about him after that window is still news.
    await run(row('n5', 'Puka Nacua Injury Update: Rams WR’s Week 3 Status Revealed'))
    expect(toldUsers()).toEqual(['mgr'])
  })

  it('matches through case, punctuation and curly quotes', () => {
    const a = { sport: 'NFL', playerName: 'Puka Nacua', headline: MCVAY, category: 'injury' }
    const b = { ...a, headline: 'MCVAY SAYS NACUA’S INJURY NOT “LONG-TERM” CONCERN — BUT RAMS BEING CAUTIOUS!' }
    expect(storyKey('u', a)).toBe(storyKey('u', b))
    expect(storyKey('u', a)).not.toBe(storyKey('other', a))
  })
})

describe('the same status, different outlets', () => {
  it('a second "questionable" story inside a day is dropped; "ruled out" still goes through', async () => {
    await run(row('q1', 'Puka Nacua questionable for Sunday with hip injury'))
    expect(toldUsers()).toEqual(['mgr'])

    await run(row('q2', 'Rams list Nacua as questionable vs. 49ers'))
    expect(h.dispatch).not.toHaveBeenCalled()

    await run(row('o1', 'Puka Nacua ruled out for Week 3'))
    expect(toldUsers()).toEqual(['mgr'])
  })

  it('reads the status the way a manager would', () => {
    expect(injuryStatusTag('Puka Nacua ruled out after limited practice')).toBe('out')
    expect(injuryStatusTag("Puka Nacua injury update from Rams leaves WR's Week 3 status in doubt")).toBe('doubtful')
    expect(injuryStatusTag('All-Pro Rams WR Puka Nacua to be limited in practice again this week')).toBe('limited')
    expect(injuryStatusTag('Nacua placed on injured reserve')).toBe('ir')
    expect(injuryStatusTag('Nacua cleared, will play Sunday')).toBe('active')
    expect(injuryStatusTag(MCVAY)).toBeNull()
  })

  it('a different status is a different topic; the same status is the same topic', () => {
    const n = (headline: string) => ({ sport: 'NFL', playerName: 'Puka Nacua', headline, category: 'injury' })
    expect(topicKey('u', n('Nacua questionable'))).toBe(topicKey('u', n('Rams: Nacua is questionable')))
    expect(topicKey('u', n('Nacua questionable'))).not.toBe(topicKey('u', n('Nacua ruled out')))
  })
})

describe('one alert per person per story', () => {
  it('🛑 a manager with the player in three leagues is told once, under one league', async () => {
    h.roster = [roster('mgr', 'lg-1'), roster('mgr', 'lg-2'), roster('mgr', 'lg-3'), roster('other', 'lg-2')]
    await run(row('n1', 'Puka Nacua ruled out for Week 3'))
    expect(toldUsers().sort()).toEqual(['mgr', 'other'])
  })

  it('someone already told is dropped while the rest of the league still hears it', async () => {
    await run(row('n1', 'Puka Nacua ruled out for Week 3'))
    h.roster = [roster('mgr', 'lg-1'), roster('new-mgr', 'lg-1')]
    const out = await run(row('n2', 'Puka Nacua ruled out for Week 3'))
    expect(toldUsers()).toEqual(['new-mgr'])
    expect(out.repeatsSuppressed).toBe(1)
  })

  it('followers are guarded the same way', async () => {
    h.roster = []
    h.followers = ['fan']
    await run(row('n1', MCVAY))
    expect(toldUsers()).toEqual(['fan'])
    await run(row('n2', MCVAY))
    expect(h.dispatch).not.toHaveBeenCalled()
  })
})

describe('fails open', () => {
  it('🛑 an unreadable store sends the alert rather than swallowing it', async () => {
    h.cacheDown = true
    await run(row('n1', 'Puka Nacua ruled out for Week 3'))
    await run(row('n2', 'Puka Nacua ruled out for Week 3'))
    expect(h.dispatch).toHaveBeenCalledTimes(1)
    expect(toldUsers()).toEqual(['mgr'])
  })
})
