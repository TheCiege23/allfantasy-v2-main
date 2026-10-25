// @vitest-environment node
/**
 * Player news, owner's ideas 1, 2, 3 and 5 (2026-10-22), after one day brought the owner 59 emails
 * about everyone from starters to deep bench players:
 *   1. starters get it now, everyone else waits for one daily digest;
 *   2. one alert per player (per status) per day, across every sender and league;
 *   3. only changes that matter — no practice reports, no news about a player already on IR;
 *   5. a Player news setting: Starters only / My whole roster / Off.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  newsFind: vi.fn(),
  newsUpdate: vi.fn(),
  rosterFind: vi.fn(),
  dispatch: vi.fn(),
  classify: vi.fn(),
  followers: vi.fn(),
  profiles: vi.fn(),
  told: new Set<string>(),
  injuryStatus: vi.fn(),
}))

const REGISTRY = [{ id: 'pim-gibbs', canonicalName: 'Jahmyr Gibbs', position: 'RB', currentTeam: 'DET', sleeperId: '9221' }]

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerNewsRecord: { findMany: h.newsFind, updateMany: h.newsUpdate },
    redraftRosterPlayer: { findMany: h.rosterFind },
    playerIdentityMap: {
      findMany: async ({ where }: { where: { OR: Array<{ canonicalName?: { contains: string } }> } }) =>
        REGISTRY.filter((p) => where.OR.some((c) => c.canonicalName && p.canonicalName.toLowerCase().includes(c.canonicalName.contains.toLowerCase()))),
    },
    userProfile: { findMany: h.profiles },
    sportsInjury: { findFirst: h.injuryStatus },
    sportsDataCache: {
      findMany: async ({ where }: { where: { cacheKey: { in: string[] } } }) => where.cacheKey.in.filter((k) => h.told.has(k)).map((cacheKey) => ({ cacheKey })),
      createMany: async ({ data }: { data: Array<{ cacheKey: string }> }) => { for (const d of data) h.told.add(d.cacheKey); return { count: data.length } },
    },
  },
}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))
vi.mock('@/lib/news/player-news-category', () => ({ classifyPlayerNewsCategory: h.classify }))
vi.mock('@/lib/follows/playerFollows', () => ({ listFollowerIdsForPlayerIdentity: h.followers }))

import { dispatchPendingPlayerNewsNotifications } from '@/lib/notifications/PlayerNewsNotificationService'
import { statusBucket, isMeaningfulStatusChange } from '@/lib/notifications/playerNewsStatus'
import { routePlayerNews, readPlayerNewsLevel, PLAYER_NEWS_LEVELS, PLAYER_NEWS_LEVEL_LABEL_KEYS } from '@/lib/notification-settings/playerNewsLevel'
import { planPlayerNews, playerNewsDispatches, toldKey } from '@/lib/notifications/playerNewsGate'
import { resolveNotificationPreferences, getNotificationPreferencesFingerprint } from '@/lib/notification-settings/NotificationPreferenceResolver'
import { buildResetNotificationPreferences } from '@/lib/notification-settings/resetNotificationPreferences'
import { translations } from '@/lib/i18n/translations'
import { translationsEsParity } from '@/lib/i18n/translations-es-parity'

const ROW = { id: 'news-1', sport: 'NFL', playerName: 'Jahmyr Gibbs', team: 'DET', headline: 'Gibbs (hamstring) ruled out Sunday', body: null, impact: 'medium' }
const rostered = (ownerId: string, leagueId: string, slotType: string) => ({ playerName: 'Jahmyr Gibbs', team: 'DET', sport: 'NFL', slotType, roster: { ownerId, leagueId } })
const calls = () => h.dispatch.mock.calls.map((c) => c[0])
const delivery = (userId: string) => calls().filter((c) => c.userIds.includes(userId)).map((c) => (c.meta?.playerNews as { delivery?: string } | undefined)?.delivery)

beforeEach(() => {
  for (const f of [h.newsFind, h.newsUpdate, h.rosterFind, h.dispatch, h.classify, h.followers, h.profiles, h.injuryStatus]) f.mockReset()
  h.told.clear()
  h.newsFind.mockResolvedValue([ROW])
  h.newsUpdate.mockResolvedValue({ count: 1 })
  h.dispatch.mockResolvedValue({ requested: 1, delivered: 1, suppressed: 0, failed: 0 })
  h.classify.mockReturnValue('injury')
  h.rosterFind.mockResolvedValue([])
  h.followers.mockResolvedValue([])
  h.profiles.mockResolvedValue([])
  h.injuryStatus.mockResolvedValue(null)
})

describe('what a story says (idea 3)', () => {
  it.each([
    ['Out', 'out'], ['Gibbs ruled out Sunday', 'out'], ['Cowboys rule out top cornerback', 'out'], ['Questionable', 'questionable'],
    ['Doubtful', 'doubtful'], ['Injured Reserve', 'ir'], ['placed on IR', 'ir'], ['activated off IR', 'active'],
    ['limited at practice Wednesday', 'practice'], ['did not practice Thursday', 'practice'],
    ['worked out with the team', 'other'], ['dealing with a sore hamstring', 'other'], ['suspended two games', 'suspended'],
  ])('%s → %s', (text, bucket) => {
    expect(statusBucket(text)).toBe(bucket)
  })
  it('only changes that matter: not the same status again, not practice, nothing about an IR player but his return', () => {
    expect(isMeaningfulStatusChange('questionable', 'out')).toBe(true)
    expect(isMeaningfulStatusChange('questionable', 'questionable')).toBe(false)
    expect(isMeaningfulStatusChange(null, 'practice')).toBe(false)
    expect(isMeaningfulStatusChange('ir', 'out')).toBe(false)
    expect(isMeaningfulStatusChange('ir', 'active')).toBe(true)
    expect(isMeaningfulStatusChange(null, 'out')).toBe(true)
  })
})

describe('the Player news level (idea 5)', () => {
  it('routes by level and relation', () => {
    const r = (level: 'starters' | 'roster' | 'off', rel: 'starter' | 'rostered' | 'player_follower' | 'team_follower', instantWorthy = true) => routePlayerNews(level, rel, { instantWorthy })
    expect([r('starters', 'starter'), r('starters', 'rostered'), r('starters', 'player_follower'), r('starters', 'team_follower')]).toEqual(['instant', 'digest', 'instant', 'digest'])
    expect([r('roster', 'starter'), r('roster', 'rostered'), r('roster', 'team_follower')]).toEqual(['instant', 'instant', 'digest'])
    expect(r('off', 'starter')).toBe('drop')
    // A story with no clear status is never worth a push.
    expect(r('roster', 'starter', false)).toBe('digest')
  })
  it('defaults to Starters only, and survives load, change detection and reset', () => {
    expect(readPlayerNewsLevel(null)).toBe('starters')
    expect(resolveNotificationPreferences({ playerNewsLevel: 'off' }).playerNewsLevel).toBe('off')
    expect(getNotificationPreferencesFingerprint({ playerNewsLevel: 'roster' })).not.toBe(getNotificationPreferencesFingerprint({}))
    expect(getNotificationPreferencesFingerprint({ playerNewsLevel: 'starters' })).toBe(getNotificationPreferencesFingerprint({}))
    expect(buildResetNotificationPreferences({ playerNewsLevel: 'off' }).playerNewsLevel).toBe('starters')
  })
  it('has a name and a definition for every choice in English and Spanish', () => {
    for (const level of PLAYER_NEWS_LEVELS) for (const key of Object.values(PLAYER_NEWS_LEVEL_LABEL_KEYS[level])) {
      expect(translations.en[key], key).toBeTruthy()
      expect(translations.es?.[key] ?? translationsEsParity[key], key).toBeTruthy()
    }
  })
})

describe('the gate', () => {
  it('splits people into push-now, digest and already-told — never an email', async () => {
    const now = new Date('2026-10-22T15:00:00Z')
    const subject = { playerKey: 'pim-gibbs', bucket: 'out' as const }
    const plan = await planPlayerNews(['s', 'b', 'told', 'off'], subject, (id) => (id === 's' ? 'starter' : 'rostered'), {
      now, readLevels: async () => new Map([['off', 'off' as const]]), readTold: async () => new Set([toldKey('told', subject, now)]),
    })
    expect(plan).toEqual({ instant: ['s'], digest: ['b'], suppressed: ['told', 'off'] })
    const out = playerNewsDispatches({ userIds: ['s', 'b'], category: 'injury_alerts', type: 'x', title: 't' }, plan, { playerName: 'Gibbs' }, (id) => id === 's')
    expect(out.map((o) => [o.userIds, o.skipChannels])).toEqual([[['s'], { sms: true, email: true }], [['b'], { sms: true, email: true, push: true }]])
    expect(out[0]!.meta?.playerNews).toMatchObject({ delivery: 'instant', starter: true })
  })
})

describe('the news feed sender, end to end', () => {
  it('a starter ruled out gets push + email with the lineup options; a bench player hurt is the bell only', async () => {
    h.rosterFind.mockResolvedValue([rostered('starter', 'L1', 'RB'), rostered('bench', 'L2', 'bench')])
    await dispatchPendingPlayerNewsNotifications()
    expect(delivery('starter')).toEqual(['instant'])
    expect(delivery('bench')).toEqual(['bell'])
    const starter = calls().find((c) => c.userIds.includes('starter'))!
    expect(starter.skipChannels).toEqual({ sms: true })
    expect(starter.title).toBe('🚨 Jahmyr Gibbs is OUT — your lineup options')
    expect(calls().find((c) => c.userIds.includes('bench'))!.skipChannels).toEqual({ sms: true, email: true, push: true })
    for (const c of calls()) expect((c.meta?.playerNews as { digest?: boolean }).digest).toBe(false)
  })
  it('idea 2: the same player and status the same day is one alert, even from a second story', async () => {
    h.rosterFind.mockResolvedValue([rostered('starter', 'L1', 'RB')])
    await dispatchPendingPlayerNewsNotifications()
    expect(calls()).toHaveLength(1)
    h.dispatch.mockClear()
    h.newsFind.mockResolvedValue([{ ...ROW, id: 'news-2', headline: 'Lions rule out Jahmyr Gibbs (hamstring) for Week 8' }])
    await dispatchPendingPlayerNewsNotifications()
    expect(calls()).toHaveLength(0)
  })
  it('idea 3: a practice report goes nowhere, and neither does news about a player already on IR', async () => {
    h.rosterFind.mockResolvedValue([rostered('starter', 'L1', 'RB')])
    h.newsFind.mockResolvedValue([{ ...ROW, headline: 'Gibbs (hamstring) limited at practice Wednesday' }])
    await dispatchPendingPlayerNewsNotifications()
    expect(calls()).toHaveLength(0)
    h.newsFind.mockResolvedValue([{ ...ROW, id: 'news-3', headline: 'Gibbs (hamstring) out again' }])
    h.injuryStatus.mockResolvedValue({ status: 'Injured Reserve' })
    await dispatchPendingPlayerNewsNotifications()
    expect(calls()).toHaveLength(0)
  })
  it('"Off" hears nothing; a bench injury is the bell only even on "My whole roster"', async () => {
    h.rosterFind.mockResolvedValue([rostered('quiet', 'L1', 'RB'), rostered('all', 'L2', 'bench')])
    h.profiles.mockResolvedValue([
      { userId: 'quiet', notificationPreferences: { playerNewsLevel: 'off' } },
      { userId: 'all', notificationPreferences: { playerNewsLevel: 'roster' } },
    ])
    await dispatchPendingPlayerNewsNotifications()
    expect(delivery('quiet')).toEqual([])
    expect(delivery('all')).toEqual(['bell'])
  })
})
