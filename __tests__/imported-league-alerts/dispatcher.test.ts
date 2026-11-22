// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IMPORTED_NOTIFICATION_CATEGORY_IDS } from '@/lib/notification-settings/types'
const h = vi.hoisted(() => ({ profile: vi.fn(), inApp: vi.fn(), push: vi.fn(), email: vi.fn(), durable: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/user-settings', () => ({ getSettingsProfile: h.profile }))
vi.mock('@/lib/platform/notification-service', () => ({ createPlatformNotification: h.inApp }))
vi.mock('@/lib/push-notifications', () => ({ sendPushToUser: h.push }))
vi.mock('@/lib/resend-client', () => ({ sendNotificationEmail: h.email, sendTemplatedEmail: vi.fn() }))
vi.mock('@/lib/twilio-client', () => ({ sendSms: vi.fn() }))
vi.mock('@/lib/notifications/durableTransport', () => ({ deliverDurably: h.durable }))
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
const enabled = { enabled: true, inApp: true, push: true, email: true, sms: false }
function profile(overrides: Record<string, unknown> = {}) {
  return { userId: 'u1', email: 'manager@allfantasy.ai', timezone: 'UTC', notificationPreferences: {
    categories: Object.fromEntries(IMPORTED_NOTIFICATION_CATEGORY_IDS.map((id) => [id, { ...enabled }])), ...overrides,
  } }
}
function send(category: (typeof IMPORTED_NOTIFICATION_CATEGORY_IDS)[number] = 'imported_scoring') {
  return dispatchNotification({ userIds: ['u1'], category, leagueId: 'l1', type: category, title: 'Sleeper · Test: update',
    body: 'New league activity.', dedupePrefix: 'stable-event', actionHref: '/league/l1' })
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-17T12:00:00Z'))
  h.profile.mockResolvedValue(profile())
  h.inApp.mockResolvedValue(true)
  h.push.mockResolvedValue([{ ok: true }])
  h.email.mockResolvedValue({ ok: true })
  h.durable.mockImplementation(async (_message, send) => send({ outboxId: 'test', idempotencyKey: 'test' }))
})
afterEach(() => vi.useRealTimers())
describe('Imported alerts through the real AF dispatcher', () => {
  it.each(IMPORTED_NOTIFICATION_CATEGORY_IDS)('delivers %s to the bell, push and email through existing channels', async (category) => {
    expect(await send(category)).toMatchObject({ delivered: 1, failed: 0 })
    expect(h.inApp).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', sourceKey: 'stable-event:u1' }))
    expect(h.push).toHaveBeenCalledTimes(1)
    expect(h.email).toHaveBeenCalledTimes(1)
    expect(h.durable).toHaveBeenCalledWith(expect.objectContaining({ eventKey: 'stable-event' }), expect.any(Function))
  })
  it('keeps imported notifications silent until the user opts in', async () => {
    h.profile.mockResolvedValue(profile({ categories: {} }))
    expect(await send()).toMatchObject({ suppressed: 1, delivered: 0 })
    expect(h.inApp).not.toHaveBeenCalled()
    expect(h.push).not.toHaveBeenCalled()
    expect(h.email).not.toHaveBeenCalled()
  })
  it('suppresses all channels when the imported category or league is disabled', async () => {
    h.profile.mockResolvedValue(profile({ categories: { imported_scoring: { ...enabled, enabled: false } } }))
    expect(await send()).toMatchObject({ suppressed: 1 })
    h.profile.mockResolvedValue(profile({ leagues: { l1: { enabled: false } } }))
    expect(await send()).toMatchObject({ suppressed: 1 })
    h.profile.mockResolvedValue(profile({ globalEnabled: false }))
    expect(await send()).toMatchObject({ suppressed: 1 })
    expect(h.inApp).not.toHaveBeenCalled()
    expect(h.durable).not.toHaveBeenCalled()
  })
  it('keeps the bell while production quiet hours suppress push and email', async () => {
    h.profile.mockResolvedValue(profile({ quietHours: { enabled: true, startHour: 11, endHour: 13, timezone: 'UTC' } }))
    expect(await send()).toMatchObject({ delivered: 1 })
    expect(h.inApp).toHaveBeenCalledTimes(1)
    expect(h.email).not.toHaveBeenCalled()
    expect(h.push).not.toHaveBeenCalled()
  })
  it('honors independent bell, push and email channel choices', async () => {
    h.profile.mockResolvedValue(profile({ categories: { imported_scoring: { ...enabled, inApp: false, email: false } } }))
    expect(await send()).toMatchObject({ delivered: 1 })
    expect(h.inApp).not.toHaveBeenCalled()
    expect(h.email).not.toHaveBeenCalled()
    expect(h.push).toHaveBeenCalledTimes(1)
  })
})
