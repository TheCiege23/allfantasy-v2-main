import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Notification controls that actually control (user decisions, 2026-09-14):
 *   - every push follows the user's settings — no sender reaches a phone around them;
 *   - push has its own switch per alert type, and a row without one keeps the push it had;
 *   - a high-severity push passes quiet hours only when the user allows critical alerts;
 *   - a won waiver claim is announced once.
 *
 * 🛑 THE BUG THIS FILE EXISTS FOR. The push service checks nothing but the device
 * subscription, and the injured-starter sweep and the trade sweep called it directly. The
 * dispatcher withheld the bell entry and the email for a muted league or a switched-off
 * alert type; the phone buzzed anyway.
 */

const h = vi.hoisted(() => ({ getSettingsProfile: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/user-settings', () => ({ getSettingsProfile: h.getSettingsProfile }))

import { decidePush, decidePushForUser } from '@/lib/notifications/pushGate'
import {
  getDefaultNotificationPreferences,
  getNotificationPreferencesFingerprint,
  resolveNotificationPreferences,
} from '@/lib/notification-settings/NotificationPreferenceResolver'
import type { NotificationPreferences } from '@/lib/notification-settings/types'

const ON = { enabled: true, inApp: true, email: false, sms: false }
const NOON_UTC = new Date('2026-01-15T12:00:00Z')
const THREE_AM_UTC = new Date('2026-01-15T03:00:00Z')
const QUIET_UTC = { startHour: 22, endHour: 7, timezone: 'UTC', enabled: true }

function prefsWith(over: Partial<NotificationPreferences> = {}): NotificationPreferences {
  return {
    globalEnabled: true,
    categories: { injury_alerts: { ...ON }, trade_proposals: { ...ON }, waiver_processing: { ...ON } },
    ...over,
  }
}

function decide(prefs: NotificationPreferences | null, over: Partial<Parameters<typeof decidePush>[1]> = {}) {
  return decidePush(prefs, {
    category: 'injury_alerts',
    leagueId: 'lg1',
    severity: 'medium',
    now: NOON_UTC,
    ...over,
  })
}

describe('push has its own switch, and a row without one keeps the push it had', () => {
  it('🛑 absent push follows in-app in BOTH directions, so nobody’s delivery changes on deploy', () => {
    const r = resolveNotificationPreferences({
      categories: {
        chat_mentions: { enabled: true, inApp: true, email: false, sms: false },
        ai_alerts: { enabled: true, inApp: false, email: true, sms: false },
      },
    })
    expect(r.categories?.chat_mentions?.push).toBe(true)
    expect(r.categories?.ai_alerts?.push).toBe(false)
  })

  it('an explicit push switch wins over in-app either way', () => {
    const r = resolveNotificationPreferences({
      categories: {
        chat_mentions: { enabled: true, inApp: true, email: false, sms: false, push: false },
        ai_alerts: { enabled: true, inApp: false, email: false, sms: false, push: true },
      },
    })
    expect(r.categories?.chat_mentions).toMatchObject({ inApp: true, push: false })
    expect(r.categories?.ai_alerts).toMatchObject({ inApp: false, push: true })
  })

  it('defaults push on, like in-app', () => {
    expect(getDefaultNotificationPreferences().categories?.injury_alerts?.push).toBe(true)
  })

  it('the fingerprint moves when ONLY push changes, or Save would never notice the edit', () => {
    const defaults = getDefaultNotificationPreferences()
    const changed: NotificationPreferences = {
      ...defaults,
      categories: { ...defaults.categories, injury_alerts: { ...defaults.categories!.injury_alerts!, push: false } },
    }
    expect(getNotificationPreferencesFingerprint(changed)).not.toBe(getNotificationPreferencesFingerprint(defaults))
  })
})

describe('decidePush — one rule for every push sender', () => {
  it('allows a push when nothing says otherwise', () => {
    expect(decide(prefsWith())).toEqual({ allowed: true })
    expect(decide(null)).toEqual({ allowed: true })
  })

  it('🛑 honours "notifications off" even on a row with no categories saved', () => {
    // The resolver's no-categories path reports globalEnabled: true for this row.
    expect(decide({ globalEnabled: false })).toEqual({ allowed: false, reason: 'global_off' })
  })

  it('stops a push for an alert type that is switched off', () => {
    const prefs = prefsWith({ categories: { injury_alerts: { ...ON, enabled: false } } })
    expect(decide(prefs)).toEqual({ allowed: false, reason: 'category_off' })
  })

  it('🛑 the push switch alone stops the phone, while the bell keeps the alert', () => {
    const prefs = prefsWith({ categories: { injury_alerts: { ...ON, inApp: true, push: false } } })
    expect(decide(prefs)).toEqual({ allowed: false, reason: 'push_off' })
  })

  it('a push can stay on with the bell entry switched off', () => {
    const prefs = prefsWith({ categories: { injury_alerts: { ...ON, inApp: false, push: true } } })
    expect(decide(prefs)).toEqual({ allowed: true })
  })

  it('never pushes a category that is not push-capable', () => {
    expect(decide(prefsWith(), { category: 'waiver_processing' })).toEqual({
      allowed: false,
      reason: 'not_push_category',
    })
  })

  it('🛑 a league mute stops the push for that league only', () => {
    const muted = prefsWith({ leagues: { lg1: { mutedCategories: ['injury_alerts'] } } })
    expect(decide(muted, { leagueId: 'lg1' })).toEqual({ allowed: false, reason: 'league_muted' })
    expect(decide(muted, { leagueId: 'lg2' })).toEqual({ allowed: true })

    const silenced = prefsWith({ leagues: { lg1: { enabled: false } } })
    expect(decide(silenced, { leagueId: 'lg1' })).toEqual({ allowed: false, reason: 'league_muted' })
  })

  it('🛑 quiet hours hold a medium push until morning', () => {
    const prefs = prefsWith({ quietHours: QUIET_UTC })
    expect(decide(prefs, { now: THREE_AM_UTC })).toEqual({ allowed: false, reason: 'quiet_hours' })
    expect(decide(prefs, { now: NOON_UTC })).toEqual({ allowed: true })
  })

  it('🛑 a high-severity push passes quiet hours ONLY when the user allows critical alerts', () => {
    const strict = prefsWith({ quietHours: QUIET_UTC })
    const lenient = prefsWith({ quietHours: { ...QUIET_UTC, allowCritical: true } })
    expect(decide(strict, { now: THREE_AM_UTC, severity: 'high' })).toEqual({ allowed: false, reason: 'quiet_hours' })
    expect(decide(lenient, { now: THREE_AM_UTC, severity: 'high' })).toEqual({ allowed: true })
    expect(decide(lenient, { now: THREE_AM_UTC, severity: 'medium' })).toEqual({
      allowed: false,
      reason: 'quiet_hours',
    })
  })
})

describe('decidePushForUser', () => {
  beforeEach(() => {
    h.getSettingsProfile.mockReset()
  })

  it('refuses when there is no profile, rather than sending blind', async () => {
    h.getSettingsProfile.mockResolvedValue(null)
    await expect(
      decidePushForUser('u1', { category: 'injury_alerts', leagueId: 'lg1', severity: 'medium', now: NOON_UTC }),
    ).resolves.toEqual({ allowed: false, reason: 'no_profile' })
  })

  it('DISCRIMINATING: reads quiet hours in the profile timezone when the window carries none', async () => {
    // 14:00 UTC is 23:00 in Tokyo (inside 22->07) and 14:00 in UTC (outside). A zone-blind
    // implementation must answer both the same way; the correct answers differ.
    const now = new Date('2026-01-15T14:00:00Z')
    const prefs = prefsWith({ quietHours: { startHour: 22, endHour: 7, enabled: true } })
    const input = { category: 'injury_alerts' as const, leagueId: 'lg1', severity: 'medium' as const, now }

    h.getSettingsProfile.mockResolvedValue({ notificationPreferences: prefs, timezone: 'Asia/Tokyo' })
    await expect(decidePushForUser('u1', input)).resolves.toEqual({ allowed: false, reason: 'quiet_hours' })

    h.getSettingsProfile.mockResolvedValue({ notificationPreferences: prefs, timezone: 'UTC' })
    await expect(decidePushForUser('u1', input)).resolves.toEqual({ allowed: true })
  })
})

const src = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('🛑 every direct push asks the gate first', () => {
  it.each(['app/api/cron/alert-sweep/route.ts', 'lib/trade-intel/tradeNotifyService.ts'])(
    '%s decides before it sends',
    (path) => {
      const text = src(path)
      const gate = text.indexOf('decidePushForUser(')
      const send = text.indexOf('sendPushToUser(')
      expect(gate).toBeGreaterThan(-1)
      expect(send).toBeGreaterThan(gate)
    },
  )

  it('the dispatcher uses the same rule', () => {
    expect(src('lib/notifications/NotificationDispatcher.ts')).toContain('decidePush(')
  })
})

describe('🛑 a won waiver claim is announced once', () => {
  it('the waiver job no longer queues its own bell entries', () => {
    expect(src('lib/automation/jobs/waivers/processLeagueWaiversJob.ts')).not.toContain('enqueueUserNotification(')
  })

  it('the run hook announces every claim that did not go through, not three outcome codes', () => {
    const text = src('lib/waiver-wire/run-hooks.ts')
    expect(text).toContain('type: "waiver_claim_lost"')
    expect(text).not.toMatch(/outcomeCode === "insufficient_faab"/)
  })
})
