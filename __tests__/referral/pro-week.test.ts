// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

/*
 * "Give a week, get a week" (2026-11-15): a referred friend's import earns them and their referrer a
 * week of AF Pro each. Once per friend, the referrer capped at 4 in 30 days, weeks stacking, nothing
 * advertised in the iOS app, and a reminder the day before a week ends.
 */

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: vi.fn(async () => {}) }))

import {
  friendProWeekNotice,
  PRO_WEEK_REASON_FRIEND,
  PRO_WEEK_REASON_REFERRER,
  proWeekDaysFromEnv,
  proWeekPersonName,
  proWeekWindow,
  referrerCapReached,
  REFERRER_WEEKS_PER_WINDOW,
} from '@/lib/referral/proWeek'
import { awardReferralProWeekOnImport } from '@/lib/referral/proWeekGrant'
import { runProWeekEndingReminderPass } from '@/lib/referral/proWeekReminders'
import { countConvertedToPaid } from '@/lib/referral/proWeekStats'
import { parseProWeekOffer } from '@/lib/referral/useProWeekOffer'

const NOW = new Date('2026-11-15T12:00:00Z')
const DAY = 86_400_000

describe('the rules', () => {
  it('7 days by default; AF_REFERRAL_PRO_WEEK_DAYS dials it or switches it off', () => {
    expect(proWeekDaysFromEnv({})).toBe(7)
    expect(proWeekDaysFromEnv({ AF_REFERRAL_PRO_WEEK_DAYS: '14' })).toBe(14)
    expect(proWeekDaysFromEnv({ AF_REFERRAL_PRO_WEEK_DAYS: '99' })).toBe(30)
    expect(proWeekDaysFromEnv({ AF_REFERRAL_PRO_WEEK_DAYS: '0' })).toBe(0)
    expect(proWeekDaysFromEnv({ AF_REFERRAL_PRO_WEEK_DAYS: 'off' })).toBe(0)
    expect(proWeekDaysFromEnv({ AF_REFERRAL_PRO_WEEK_DAYS: 'lots' })).toBe(0)
  })

  it('a second week starts when the first ends, never alongside it', () => {
    expect(proWeekWindow(NOW, null, 7).expiresAt.getTime()).toBe(NOW.getTime() + 7 * DAY)
    const running = new Date(NOW.getTime() + 3 * DAY)
    expect(proWeekWindow(NOW, running, 7).expiresAt.getTime()).toBe(NOW.getTime() + 10 * DAY)
    // A week that already ended does not push the new one out.
    expect(proWeekWindow(NOW, new Date(NOW.getTime() - DAY), 7).expiresAt.getTime()).toBe(NOW.getTime() + 7 * DAY)
  })

  it('the referrer cap is 4 in 30 days', () => {
    expect(REFERRER_WEEKS_PER_WINDOW).toBe(4)
    expect(referrerCapReached(3)).toBe(false)
    expect(referrerCapReached(4)).toBe(true)
  })

  it('names the other person, never an empty string', () => {
    expect(proWeekPersonName({ displayName: ' Sam ', username: 'sam1' })).toBe('Sam')
    expect(proWeekPersonName({ displayName: null, username: 'sam1' })).toBe('sam1')
    expect(proWeekPersonName(null)).toBe('A friend')
    expect(friendProWeekNotice('Sam', 7, 'Nov 22').body).toContain('No card and nothing to cancel')
  })
})

type Grant = { id: string; userId: string; reason: string; expiresAt: Date; createdAt: Date; revokedAt: null }

function fakeDb(opts: { referral?: { id: string; referrerId: string } | null; referrerWeeks?: number; running?: Record<string, Date>; failCreate?: boolean } = {}) {
  let claimed = false
  const grants: Grant[] = []
  const sql: string[] = []
  const events: unknown[] = []
  const tx = {
    $executeRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const text = strings.join('?')
      sql.push(text)
      if (text.includes('UPDATE "referrals"')) {
        if (claimed) return 0
        claimed = true
        return 1
      }
      return 0
    }),
    adminSubscriptionGrant: {
      findFirst: vi.fn(async ({ where }: { where: { userId: string } }) =>
        opts.running?.[where.userId] ? { expiresAt: opts.running[where.userId] } : null,
      ),
      count: vi.fn(async () => opts.referrerWeeks ?? 0),
      create: vi.fn(async ({ data }: { data: Omit<Grant, 'id' | 'createdAt' | 'revokedAt'> }) => {
        if (opts.failCreate) throw new Error('db down')
        const g = { ...data, id: `g${grants.length + 1}`, createdAt: NOW, revokedAt: null } as Grant
        grants.push(g)
        return { id: g.id, expiresAt: g.expiresAt }
      }),
    },
    referralEvent: { create: vi.fn(async (a: unknown) => { events.push(a); return {} }) },
  }
  const db = {
    referral: { findFirst: vi.fn(async () => (opts.referral === undefined ? { id: 'ref1', referrerId: 'referrer' } : opts.referral)) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => {
      const before = claimed
      try {
        return await fn(tx)
      } catch (e) {
        claimed = before // a rolled-back transaction un-claims
        throw e
      }
    }),
    appUser: { findMany: vi.fn(async () => [{ id: 'friend', displayName: 'Jo', username: 'jo' }, { id: 'referrer', displayName: 'Sam', username: 'sam' }]) },
    ...tx,
  }
  return { db, grants, sql, events, isClaimed: () => claimed }
}

describe('the award', () => {
  let notify: ReturnType<typeof vi.fn>
  beforeEach(() => {
    notify = vi.fn(async () => {})
  })
  const award = (db: unknown, env: Record<string, string> = {}) =>
    awardReferralProWeekOnImport('friend', { db: db as never, now: NOW, env: env as never, notify: notify as never })

  it("a referred friend's import gives both a week, and tells both of them by email", async () => {
    const f = fakeDb()
    const r = await award(f.db)
    expect(r).toMatchObject({ awarded: true, days: 7, referrerCapped: false })
    expect(f.grants.map((g) => [g.userId, g.reason, g.expiresAt.getTime() - NOW.getTime()])).toEqual([
      ['friend', PRO_WEEK_REASON_FRIEND, 7 * DAY],
      ['referrer', PRO_WEEK_REASON_REFERRER, 7 * DAY],
    ])
    expect(f.grants.every((g) => g.tier === 'pro')).toBe(true)
    expect(notify).toHaveBeenCalledTimes(2)
    for (const [params] of notify.mock.calls) {
      expect(params.category).toBe('system_account')
      expect(params.skipChannels).toEqual({ sms: true })
    }
    expect(notify.mock.calls[0][0].body).toContain('Sam invited you')
    expect(notify.mock.calls[1][0].title).toContain('Jo joined')
  })

  it('🛑 once per friend: a second import (or a racing one) grants nothing more', async () => {
    const f = fakeDb()
    await award(f.db)
    const again = await award(f.db)
    expect(again).toEqual({ awarded: false, reason: 'already_claimed' })
    expect(f.grants).toHaveLength(2)
    // The claim is a conditional UPDATE, so the database — not this process — decides who won.
    const claim = f.sql.find((s) => s.includes('UPDATE "referrals"'))!
    expect(claim).toMatch(/IS NULL/)
    expect(f.sql.some((s) => s.includes('pg_advisory_xact_lock'))).toBe(true)
  })

  it('the referrer cap: the friend still gets their week; the referrer gets a thank-you in the bell only', async () => {
    const f = fakeDb({ referrerWeeks: 4 })
    const r = await award(f.db)
    expect(r).toMatchObject({ awarded: true, referrerGrantId: null, referrerCapped: true })
    expect(f.grants.map((g) => g.userId)).toEqual(['friend'])
    const capped = notify.mock.calls[1][0]
    expect(capped.type).toBe('referral_pro_week_capped')
    expect(capped.skipChannels).toEqual({ sms: true, email: true, push: true })
  })

  it('weeks stack on a week still running', async () => {
    const f = fakeDb({ running: { referrer: new Date(NOW.getTime() + 3 * DAY) } })
    await award(f.db)
    expect(f.grants.find((g) => g.userId === 'referrer')!.expiresAt.getTime()).toBe(NOW.getTime() + 10 * DAY)
    expect(f.grants.find((g) => g.userId === 'friend')!.expiresAt.getTime()).toBe(NOW.getTime() + 7 * DAY)
  })

  it('nothing for someone nobody referred, nothing when switched off', async () => {
    expect(await award(fakeDb({ referral: null }).db)).toEqual({ awarded: false, reason: 'not_referred' })
    expect(await award(fakeDb().db, { AF_REFERRAL_PRO_WEEK_DAYS: '0' })).toEqual({ awarded: false, reason: 'disabled' })
    expect(notify).not.toHaveBeenCalled()
  })

  it('a failed grant never throws, and rolls the claim back so a later import can still earn it', async () => {
    const f = fakeDb({ failCreate: true })
    expect(await award(f.db)).toEqual({ awarded: false, reason: 'error' })
    expect(f.isClaimed()).toBe(false)
    expect(notify).not.toHaveBeenCalled()
  })
})

describe('the import commit route fires it after both successful paths', () => {
  it('source: rewardReferredImport follows each recordImportCompleted', () => {
    const src = readFileSync('app/api/leagues/import/commit/route.ts', 'utf8')
    const completed = [...src.matchAll(/^\s*await recordImportCompleted\(/gm)].length
    const rewarded = [...src.matchAll(/^\s*await recordImportCompleted\([^\n]*\n\s*rewardReferredImport\(/gm)].length
    expect(completed).toBe(2)
    expect(rewarded).toBe(2)
    expect(src).toMatch(/import\('@\/lib\/referral\/proWeekGrant'\)/)
  })
})

describe('the day-before reminder', () => {
  it('reminds a week that really ends; skips one with another week or a paid plan behind it', async () => {
    const ending = [
      { id: 'gA', userId: 'a', expiresAt: new Date(NOW.getTime() + 20 * 3_600_000) },
      { id: 'gB', userId: 'b', expiresAt: new Date(NOW.getTime() + 20 * 3_600_000) },
      { id: 'gC', userId: 'c', expiresAt: new Date(NOW.getTime() + 20 * 3_600_000) },
    ]
    const db = {
      adminSubscriptionGrant: {
        findMany: vi.fn(async () => ending),
        count: vi.fn(async ({ where }: { where: { userId: string } }) => (where.userId === 'b' ? 1 : 0)),
      },
      userSubscription: { count: vi.fn(async ({ where }: { where: { userId: string } }) => (where.userId === 'c' ? 1 : 0)) },
    }
    const notify = vi.fn(async () => {})
    const r = await runProWeekEndingReminderPass({ db: db as never, now: NOW, notify: notify as never })
    expect(r).toEqual({ ran: true, candidates: 3, sent: 1, stillCovered: 2, failed: 0 })
    const [params] = notify.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(params.userIds).toEqual(['a'])
    // Keyed on the grant: hourly runs re-see it, the transport sends once.
    expect(params.dedupePrefix).toBe('referral-pro-week-ending:gA')
    expect(params.actionHref).toBe('/pricing?from=referral_week_ending')
  })
})

describe('admin: who went on to pay', () => {
  it('counts a paid store subscription started AFTER the first referral week, once per person', () => {
    const t = (d: number) => new Date(NOW.getTime() + d * DAY)
    const grants = [
      { userId: 'a', createdAt: t(0) },
      { userId: 'a', createdAt: t(5) },
      { userId: 'b', createdAt: t(0) },
      { userId: 'c', createdAt: t(0) },
      { userId: 'd', createdAt: t(0) },
    ]
    const subs = [
      { userId: 'a', createdAt: t(8), status: 'active', source: 'stripe' },
      { userId: 'a', createdAt: t(9), status: 'active', source: 'apple' },
      { userId: 'b', createdAt: t(-30), status: 'active', source: 'stripe' }, // paying before the week
      { userId: 'c', createdAt: t(3), status: 'trialing', source: 'stripe' }, // not paying yet
      { userId: 'd', createdAt: t(3), status: 'active', source: 'admin' }, // a grant, not a store
    ]
    expect(countConvertedToPaid(grants, subs)).toEqual({ peopleWithWeek: 4, convertedToPaid: 1 })
  })
})

describe('the offer endpoint and its reader', () => {
  const session = vi.hoisted(() => vi.fn())
  const count = vi.hoisted(() => vi.fn())
  beforeEach(() => {
    vi.resetModules()
    session.mockReset()
    count.mockReset()
    vi.doMock('next-auth', () => ({ getServerSession: session }))
    vi.doMock('@/lib/auth', () => ({ authOptions: {} }))
    vi.doMock('@/lib/prisma', () => ({ prisma: { adminSubscriptionGrant: { count } } }))
    delete process.env.AF_REFERRAL_PRO_WEEK_DAYS
  })
  const get = async (ua = 'Mozilla/5.0 (Macintosh)') => {
    const { GET } = await import('@/app/api/referral/pro-week-offer/route')
    return (await GET(new Request('https://x.test/api/referral/pro-week-offer', { headers: { 'user-agent': ua } }))).json()
  }

  it("signed out → the offer; signed in → the offer and this month's count", async () => {
    session.mockResolvedValue(null)
    expect(await get()).toEqual({ days: 7, cap: 4, earnedInWindow: null })
    session.mockResolvedValue({ user: { id: 'u1' } })
    count.mockResolvedValue(2)
    expect(await get()).toEqual({ days: 7, cap: 4, earnedInWindow: 2 })
  })

  it('🛑 the iOS app is never told about the offer (App Store 3.1.1 / 3.1.3)', async () => {
    vi.doMock('@/lib/monetization/isAppleIosShellRequest', () => ({ isAppleIosShellRequest: () => true }))
    session.mockResolvedValue({ user: { id: 'u1' } })
    expect(await get()).toEqual({ days: 0, cap: 0, earnedInWindow: null })
    expect(count).not.toHaveBeenCalled()
  })

  it('the client reader says nothing for anything it cannot trust', () => {
    expect(parseProWeekOffer({ days: 7, cap: 4, earnedInWindow: 1 })).toEqual({ days: 7, cap: 4, earnedInWindow: 1 })
    expect(parseProWeekOffer({ days: 0, cap: 4 })).toEqual({ days: 0, cap: 0, earnedInWindow: null })
    expect(parseProWeekOffer({ days: '7' })).toEqual({ days: 0, cap: 0, earnedInWindow: null })
    expect(parseProWeekOffer(null)).toEqual({ days: 0, cap: 0, earnedInWindow: null })
  })
})
