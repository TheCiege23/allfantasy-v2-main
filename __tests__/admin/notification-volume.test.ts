import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ raw: vi.fn(), count: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: h.raw, emailPreference: { count: h.count } } }))
import { getNotificationVolume } from '@/lib/admin-dashboard/NotificationVolumeService'

const sqlOf = (args: unknown[]) => (Array.isArray(args[0]) ? (args[0] as string[]).join('?') : String(args[0]))
const day = new Date('2026-10-21T00:00:00Z')

beforeEach(() => {
  vi.resetAllMocks()
  h.count.mockResolvedValueOnce(12).mockResolvedValueOnce(3)
  h.raw.mockImplementation(async (...args: unknown[]) => {
    const sql = sqlOf(args)
    if (sql.includes('FROM platform_notifications')) return [{ day, c: 40n, held: 5n }]
    if (sql.includes('WITH per AS')) return [{ channel: 'push', user_days: 10n, avg: 6.25, p50: 4, p90: 18, max: 61n, over20: 2n }]
    if (sql.includes('LEFT JOIN app_users')) return [{ userId: 'u1', email: 'a@b.co', push: 50n, email_: 9n, sms: 2n, total: 61n }]
    if (sql.includes("status = 'failed'")) return [{ c: 4n }]
    if (sql.includes('count(DISTINCT "userId") AS c')) return [{ c: 25n }]
    if (sql.includes('FROM user_profiles')) return [{ level: 'everything', c: 90n, master_off: 6n, sms_revoked: 1n }, { level: 'off', c: 10n, master_off: 2n, sms_revoked: 0n }]
    if (sql.includes('"eventType" AS type')) return [{ type: 'player_injury_update', channel: 'email', c: 59n, users: 1n }]
    if (sql.includes("metadata->>'notificationCategory'")) return [{ category: 'injury_alerts', channel: 'email', c: 59n, users: 1n }, { category: 'injury_alerts', channel: 'push', c: 30n, users: 4n }, { category: null, channel: 'sms', c: 2n, users: 2n }]
    if (sql.includes("date_trunc('day', \"sentAt\")")) return [{ day, channel: 'push', c: 120n }, { day, channel: 'email', c: 60n }, { day, channel: 'sms', c: 2n }]
    throw new Error('unexpected query: ' + sql.slice(0, 80))
  })
})

describe('admin notification volume', () => {
  it('adds up sends per day, category and person, and the opt-outs', async () => {
    const v = await getNotificationVolume({ days: 7, now: new Date('2026-10-22T12:00:00Z') })
    expect(v.totals).toEqual({ push: 120, email: 60, sms: 2, inApp: 40, heldPush: 5, failed: 4, recipients: 25 })
    expect(v.daily).toEqual([{ day: '2026-10-21', push: 120, email: 60, sms: 2, inApp: 40, heldPush: 5 }])
    expect(v.categories[0]).toEqual({ category: 'injury_alerts', push: 30, email: 59, sms: 0, users: 4 })
    expect(v.categories[1]!.category).toBe('(uncategorised)')
    expect(v.perUser[0]).toMatchObject({ channel: 'push', p90: 18, over20: 2, max: 61 })
    expect(v.topUsers[0]).toMatchObject({ email: 'a@b.co', total: 61 })
    expect(v.optOuts).toEqual({ profiles: 100, masterSwitchOff: 8, smsConsentRevoked: 1, liveLevels: { everything: 90, off: 10 }, emailUnsubscribedTotal: 12, emailUnsubscribedInWindow: 3 })
  })
  it('clamps the window to 1-30 days', async () => {
    expect((await getNotificationVolume({ days: 400 })).days).toBe(30)
  })
})
