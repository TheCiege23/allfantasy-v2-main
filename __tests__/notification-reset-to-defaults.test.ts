import { describe, expect, it } from 'vitest'

import { getDefaultNotificationPreferences, resolveNotificationPreferences } from '@/lib/notification-settings/NotificationPreferenceResolver'
import { mergeNotificationPreferences } from '@/lib/notification-settings/mergeNotificationPreferences'
import { buildResetNotificationPreferences } from '@/lib/notification-settings/resetNotificationPreferences'
import type { NotificationPreferences } from '@/lib/notification-settings/types'
import { customisedLeagueIds, isCategoryAllowedForLeague } from '@/lib/notifications/leagueOverrides'
import { isWithinQuietHours } from '@/lib/notifications/quietHours'

/**
 * Settings › Notifications › "Reset to defaults".
 *
 * 🛑 EVERY ASSERTION GOES THROUGH THE REAL SERVER MERGE AND THE REAL DISPATCHER CHECKS. The bug
 * this guards was invisible from the client: the reset draft on screen was correct, the save
 * succeeded, and the server merge kept the stored quiet hours and league mutes because the payload
 * omitted them — still enforced, and back on screen after the refetch.
 */

const MUTED = 'league-muted'
const PARTIAL = 'league-partial'

/** A user who set quiet hours 22→7 and muted one league, plus one category in another. */
const STORED: NotificationPreferences = {
  ...getDefaultNotificationPreferences(),
  globalEnabled: true,
  quietHours: { enabled: true, startHour: 22, endHour: 7, allowCritical: true, timezone: 'UTC' },
  leagues: {
    [MUTED]: { enabled: false },
    [PARTIAL]: { mutedCategories: ['trade_proposals'] },
  },
}

/** What the server stores and the dispatcher reads after the client sends `sent`. */
function saved(sent: NotificationPreferences): NotificationPreferences {
  const merged = mergeNotificationPreferences(
    STORED as unknown as Record<string, unknown>,
    sent as unknown as Record<string, unknown>,
  ) as unknown as NotificationPreferences
  return resolveNotificationPreferences(merged)
}

/** 03:00 UTC — inside a 22→7 window. */
const NIGHT = new Date('2026-10-02T03:00:00Z')

describe('reset to defaults, after the save round-trip', () => {
  const draftOnScreen = resolveNotificationPreferences(STORED)
  const after = saved(buildResetNotificationPreferences(draftOnScreen))

  it('turns quiet hours off', () => {
    expect(after.quietHours?.enabled).toBe(false)
    expect(isWithinQuietHours(after.quietHours, NIGHT)).toBe(false)
  })

  it('clears every league override, so nothing stays muted', () => {
    expect(customisedLeagueIds(after)).toEqual([])
    expect(isCategoryAllowedForLeague(after, 'matchup_results', MUTED)).toBe(true)
    expect(isCategoryAllowedForLeague(after, 'trade_proposals', PARTIAL)).toBe(true)
  })

  it('restores the category defaults', () => {
    expect(after.globalEnabled).toBe(true)
    expect(after.categories).toEqual(getDefaultNotificationPreferences().categories)
  })
})

describe('CONTROL: the reset that shipped before 2026-10-02', () => {
  /*
   * Bare defaults are what "Reset to defaults" used to send. If this ever starts passing as a
   * reset, the merge changed and the helper above may be doing work for nothing — re-check it.
   */
  const after = saved(getDefaultNotificationPreferences())

  it('kept quiet hours on — the bug', () => {
    expect(after.quietHours?.enabled).toBe(true)
    expect(isWithinQuietHours(after.quietHours, NIGHT)).toBe(true)
  })

  it('kept both league mutes — the bug', () => {
    expect(customisedLeagueIds(after).sort()).toEqual([MUTED, PARTIAL].sort())
  })

  it('and `leagues: {}` alone would not have cleared them either (the merge is one level deep)', () => {
    const shallow = saved({ ...buildResetNotificationPreferences(resolveNotificationPreferences(STORED)), leagues: {} })
    expect(customisedLeagueIds(shallow).sort()).toEqual([MUTED, PARTIAL].sort())
  })
})
