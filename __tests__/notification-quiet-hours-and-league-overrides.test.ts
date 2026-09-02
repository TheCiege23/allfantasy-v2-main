import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  hourInZone,
  isWithinQuietHours,
  quietHoursSuppression,
} from '@/lib/notifications/quietHours'
import {
  customisedLeagueIds,
  isCategoryAllowedForLeague,
} from '@/lib/notifications/leagueOverrides'
import { resolveNotificationPreferences } from '@/lib/notification-settings/NotificationPreferenceResolver'
import type { NotificationPreferences } from '@/lib/notification-settings/types'

/**
 * Quiet hours and per-league overrides — the two halves of spec items 15 and 16.
 *
 * 🛑 THE TIMEZONE CASE BELOW IS A REGRESSION TEST FOR A LIVE BUG, not a hypothetical.
 * `lib/chimmy-alerts/types.ts` declares `quietHours.timezone`,
 * `app/api/ai/alerts/preferences/route.ts` accepts and stores it, and the only consumer
 * — `ChimmyAlertDeliveryRouter.isWithinQuietHours` — calls `now.getHours()`, the SERVER
 * hour, which on Vercel is UTC. The field was read by nothing.
 *
 * That does not fail loudly. It silences the wrong half of the day: a US Eastern user
 * who sets 22:00–07:00 gets quiet hours applied 17:00–02:00 local, so their evening
 * goes silent and 3am does not. The two cases marked DISCRIMINATING are the ones where
 * UTC and the user's zone disagree — a timezone-blind implementation passes every other
 * test in this file.
 */

const NY = 'America/New_York' // UTC-5 in January, so the offset is stable for these dates
const WINDOW = { startHour: 22, endHour: 7, timezone: NY }

/*
 * 🛑 THESE USE A PAIR OF ZONES, NOT ONE, AND THAT IS THE WHOLE POINT.
 *
 * The first draft asserted `hourInZone(now, 'America/New_York') === 21` and called it a
 * regression test. It was not. This machine's local zone IS US Eastern, so the buggy
 * server-hour implementation returns 21 as well — the test passed against the very bug
 * it was written to catch, and only failed on a machine somewhere else. Proved by
 * mutating hourInZone to ignore the zone: these two tests stayed green.
 *
 * UTC and Asia/Tokyo are nine hours apart and neither observes DST, so a server can
 * coincide with at most ONE of them. A timezone-blind implementation must return the
 * same number for both, which is impossible when the correct answers differ by nine.
 * That makes the assertion independent of wherever the test happens to run.
 */
const UTC = 'UTC'
const TOKYO = 'Asia/Tokyo' // UTC+9, no DST

describe('quiet hours are evaluated in the user timezone', () => {
  it('DISCRIMINATING: reads two zones nine hours apart differently', () => {
    const now = new Date('2026-01-15T02:00:00Z')
    expect(hourInZone(now, UTC)).toBe(2)
    expect(hourInZone(now, TOKYO)).toBe(11)
    // The load-bearing line: equal here means the zone argument was ignored.
    expect(hourInZone(now, UTC)).not.toBe(hourInZone(now, TOKYO))
  })

  it('DISCRIMINATING: the same instant is inside the window in one zone and outside in the other', () => {
    const now = new Date('2026-01-15T02:00:00Z') // 02:00 UTC, 11:00 Tokyo
    const window = (timezone: string) => ({ startHour: 22, endHour: 7, timezone })
    expect(isWithinQuietHours(window(UTC), now)).toBe(true) // 02:00 is inside 22->07
    expect(isWithinQuietHours(window(TOKYO), now)).toBe(false) // 11:00 is not
  })

  it('reads a real user zone correctly (readability, not the regression guard)', () => {
    expect(hourInZone(new Date('2026-01-15T02:00:00Z'), NY)).toBe(21)
    expect(isWithinQuietHours(WINDOW, new Date('2026-01-15T07:00:00Z'))).toBe(true)
  })

  it('falls back to server local time when no zone is known, rather than throwing', () => {
    const now = new Date('2026-01-15T02:00:00Z')
    expect(hourInZone(now, null)).toBe(now.getHours())
    expect(hourInZone(now, undefined)).toBe(now.getHours())
  })

  it('survives an invalid zone instead of taking notifications down with it', () => {
    const now = new Date('2026-01-15T02:00:00Z')
    expect(hourInZone(now, 'Not/AZone')).toBe(now.getHours())
  })

  it('uses the profile timezone when the preference does not carry one', () => {
    const noZone = { startHour: 22, endHour: 7 }
    const now = new Date('2026-01-15T07:00:00Z') // 02:00 in NY
    expect(isWithinQuietHours(noZone, now, NY)).toBe(true)
  })
})

describe('window arithmetic', () => {
  /*
   * ⚠ A WRAPPING WINDOW IS THE NORMAL CASE, NOT THE EDGE CASE. Almost every real
   * quiet-hours setting looks like 22 -> 7. When start > end the window is the UNION of
   * [start,24) and [0,end); a naive `hour >= start && hour < end` is empty for all of them.
   */
  it('handles a window that wraps midnight', () => {
    const at = (h: number) => new Date(Date.UTC(2026, 0, 15, h))
    // Window expressed directly in UTC so this case tests the arithmetic, not the zone.
    const w = { startHour: 22, endHour: 7, timezone: 'UTC' }
    expect(isWithinQuietHours(w, at(23))).toBe(true)
    expect(isWithinQuietHours(w, at(3))).toBe(true)
    expect(isWithinQuietHours(w, at(6))).toBe(true)
    expect(isWithinQuietHours(w, at(7))).toBe(false) // end is exclusive
    expect(isWithinQuietHours(w, at(12))).toBe(false)
    expect(isWithinQuietHours(w, at(22))).toBe(true) // start is inclusive
  })

  it('handles a same-day window', () => {
    const at = (h: number) => new Date(Date.UTC(2026, 0, 15, h))
    const w = { startHour: 9, endHour: 17, timezone: 'UTC' }
    expect(isWithinQuietHours(w, at(8))).toBe(false)
    expect(isWithinQuietHours(w, at(9))).toBe(true)
    expect(isWithinQuietHours(w, at(16))).toBe(true)
    expect(isWithinQuietHours(w, at(17))).toBe(false)
  })

  it('treats a zero-width window as OFF, never as always-on', () => {
    // start === end has no sane reading, and "always on" would silence everything forever.
    const w = { startHour: 3, endHour: 3, timezone: 'UTC' }
    expect(isWithinQuietHours(w, new Date(Date.UTC(2026, 0, 15, 3)))).toBe(false)
  })

  it('ignores absent, disabled, and malformed windows', () => {
    const now = new Date(Date.UTC(2026, 0, 15, 3))
    expect(isWithinQuietHours(null, now)).toBe(false)
    expect(isWithinQuietHours(undefined, now)).toBe(false)
    expect(isWithinQuietHours({ startHour: 22, endHour: 7, enabled: false }, now)).toBe(false)
    expect(isWithinQuietHours({ startHour: -1, endHour: 7 }, now)).toBe(false)
    expect(isWithinQuietHours({ startHour: 22, endHour: 99 }, now)).toBe(false)
    expect(isWithinQuietHours({ startHour: 1.5, endHour: 7 } as never, now)).toBe(false)
  })
})

describe('what quiet hours actually suppress', () => {
  const inside = new Date('2026-01-15T07:00:00Z') // 02:00 NY
  const outside = new Date('2026-01-15T02:00:00Z') // 21:00 NY

  /*
   * 🛑 PUSH AND SMS ONLY. The in-app row is a LOG. Suppressing it would mean the user
   * wakes to no record that anything happened, and the unread badge — which counts
   * stored rows — under-reports their night. Quiet hours defer a buzz; they must not
   * delete history.
   */
  it('suppresses the channels that buzz a phone', () => {
    expect(quietHoursSuppression(WINDOW, inside, 'medium')).toEqual({ push: true, sms: true })
  })

  it('suppresses nothing outside the window', () => {
    expect(quietHoursSuppression(WINDOW, outside, 'medium')).toEqual({ push: false, sms: false })
  })

  it('lets high severity through when allowCritical is set', () => {
    const w = { ...WINDOW, allowCritical: true }
    expect(quietHoursSuppression(w, inside, 'high')).toEqual({ push: false, sms: false })
    // ...but only high. Medium still waits until morning.
    expect(quietHoursSuppression(w, inside, 'medium')).toEqual({ push: true, sms: true })
  })

  it('does not exempt high severity when allowCritical is absent', () => {
    expect(quietHoursSuppression(WINDOW, inside, 'high')).toEqual({ push: true, sms: true })
  })
})

describe('the resolver carries these settings through to the dispatcher', () => {
  /*
   * 🛑 THIS IS THE TEST THAT CAUGHT THE FEATURE BEING DEAD ON ARRIVAL.
   *
   * `resolveNotificationPreferences` used to `return { globalEnabled, categories }` —
   * rebuilding a fresh object and discarding every other key. NotificationDispatcher
   * reads `prefs.quietHours` and `prefs.leagues` off THAT return value, so both would
   * have been permanently undefined regardless of what the user saved.
   *
   * ⚠ AND NOTHING ELSE WOULD HAVE SHOWN IT. The write path merges correctly, so the JSON
   * column genuinely contained the settings. The pure functions above were all correct.
   * The source-level check that the dispatcher calls the right helpers passed. The only
   * way to see it is to put a preference in one end and look at what comes out.
   */
  it('preserves quietHours and leagues through a resolve', () => {
    const saved: NotificationPreferences = {
      globalEnabled: true,
      categories: { trade_proposals: { enabled: true, inApp: true, email: false, sms: false } },
      quietHours: { startHour: 22, endHour: 7, enabled: true },
      leagues: { lg1: { enabled: false } },
    }
    const resolved = resolveNotificationPreferences(saved)
    expect(resolved.quietHours).toEqual({ startHour: 22, endHour: 7, enabled: true })
    expect(resolved.leagues).toEqual({ lg1: { enabled: false } })
  })

  it('preserves them on the no-categories path too, which dropped them as well', () => {
    // The early `if (!saved?.categories) return defaults` was a second discard site.
    const resolved = resolveNotificationPreferences({
      quietHours: { startHour: 1, endHour: 2, enabled: true },
      leagues: { lg2: { mutedCategories: ['chat_mentions'] } },
    })
    expect(resolved.quietHours?.startHour).toBe(1)
    expect(resolved.leagues?.lg2?.mutedCategories).toEqual(['chat_mentions'])
    // ...without losing the defaults it is there to supply.
    expect(resolved.globalEnabled).toBe(true)
    expect(resolved.categories?.trade_proposals?.enabled).toBe(true)
  })

  it('leaves them absent when nothing was saved, rather than inventing a window', () => {
    const resolved = resolveNotificationPreferences(null)
    expect(resolved.quietHours).toBeUndefined()
    expect(resolved.leagues).toBeUndefined()
  })
})

describe('per-league overrides', () => {
  const CAT = 'trade_proposals' as const

  /*
   * 🛑 ABSENCE INHERITS. IT IS NOT A DECISION. Every notificationPreferences row in
   * production predates this feature and has no `leagues` key, so a resolver that read
   * a missing entry as "off" would silence every league in the product on deploy —
   * silently, because an unsent notification raises nothing.
   */
  it('allows everything when no override exists', () => {
    expect(isCategoryAllowedForLeague(null, CAT, 'lg1')).toBe(true)
    expect(isCategoryAllowedForLeague({}, CAT, 'lg1')).toBe(true)
    expect(isCategoryAllowedForLeague({ leagues: {} }, CAT, 'lg1')).toBe(true)
    expect(isCategoryAllowedForLeague({ leagues: { lg1: {} } }, CAT, 'lg1')).toBe(true)
    expect(isCategoryAllowedForLeague({ globalEnabled: true }, CAT, null)).toBe(true)
  })

  it('silences a league that opted out', () => {
    const prefs: NotificationPreferences = { leagues: { lg1: { enabled: false } } }
    expect(isCategoryAllowedForLeague(prefs, CAT, 'lg1')).toBe(false)
    // ...and only that league.
    expect(isCategoryAllowedForLeague(prefs, CAT, 'lg2')).toBe(true)
    expect(isCategoryAllowedForLeague(prefs, CAT, null)).toBe(true)
  })

  it('mutes one category for one league without touching the others', () => {
    const prefs: NotificationPreferences = {
      leagues: { lg1: { mutedCategories: [CAT] } },
    }
    expect(isCategoryAllowedForLeague(prefs, CAT, 'lg1')).toBe(false)
    expect(isCategoryAllowedForLeague(prefs, 'chat_mentions', 'lg1')).toBe(true)
    expect(isCategoryAllowedForLeague(prefs, CAT, 'lg2')).toBe(true)
  })

  /*
   * ⚠ THE MASTER SWITCH IS NOT OVERRIDABLE UPWARD. A stale per-league `enabled: true`
   * must not resurrect notifications for someone who switched them off globally — that
   * turns the global control into a suggestion, and it is the shape a user would report
   * as "I turned notifications off and still got one".
   */
  it('never lets a league override re-enable a globally disabled account', () => {
    const prefs: NotificationPreferences = {
      globalEnabled: false,
      leagues: { lg1: { enabled: true } },
    }
    expect(isCategoryAllowedForLeague(prefs, CAT, 'lg1')).toBe(false)
  })

  it('the DISPATCHER actually applies both, so the settings are not decorative', () => {
    /*
     * 🛑 A PREFERENCE THE SERVER IGNORES IS WORSE THAN NO PREFERENCE. The user is told
     * they chose something, the choice is stored, and notifications arrive anyway — which
     * is indistinguishable from a bug in the notification system itself and impossible
     * for them to diagnose. The pure functions above can all be correct while nothing
     * calls them, so this asserts the wiring in NotificationDispatcher.
     *
     * Matched on call-site tokens that do not appear in any comment in that file.
     */
    const src = readFileSync(
      join(process.cwd(), 'lib/notifications/NotificationDispatcher.ts'),
      'utf8',
    )
    expect(src).toContain('isCategoryAllowedForLeague(')
    expect(src).toContain('quietHoursSuppression(')
    // The gates themselves, on the two channels that buzz a phone.
    expect(src).toContain('!quiet.push')
    expect(src).toContain('!quiet.sms')
    // The profile timezone is the fallback; without it the stored zone is all we have.
    expect(src).toMatch(/profile\.timezone/)
  })

  it('lists only the leagues actually customised', () => {
    const prefs: NotificationPreferences = {
      leagues: {
        untouched: {},
        off: { enabled: false },
        muted: { mutedCategories: [CAT] },
        emptyMute: { mutedCategories: [] },
      },
    }
    expect(customisedLeagueIds(prefs).sort()).toEqual(['muted', 'off'])
    expect(customisedLeagueIds(null)).toEqual([])
  })
})
