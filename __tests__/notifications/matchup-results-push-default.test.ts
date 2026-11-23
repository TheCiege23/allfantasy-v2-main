/**
 * Scoring alerts for a manager's own starters (`matchup_results`) push by default. They were push-off by
 * default from 2026-11-03, so they reached the bell but not the phone for everyone who never saved a
 * choice — 62 of 63 managers on the 2026-11-22 slate. An explicit choice is still honoured.
 */
import { describe, expect, it } from 'vitest'
import { getDefaultCategoryPreferences, resolveNotificationPreferences } from '@/lib/notification-settings/NotificationPreferenceResolver'
import { decidePush } from '@/lib/notifications/pushGate'

const scoring = { category: 'matchup_results' as const, severity: 'high' as const, now: new Date('2026-11-22T18:40:00Z') }

describe('matchup_results push default', () => {
  it('🛑 a manager who never opened notification settings gets scoring pushes', () => {
    expect(getDefaultCategoryPreferences('matchup_results').push).toBe(true)
    expect(decidePush(null, scoring)).toEqual({ allowed: true })
    expect(decidePush({ globalEnabled: true, categories: {} } as never, scoring)).toEqual({ allowed: true })
  })

  it('a saved "push off" is still honoured', () => {
    const saved = { globalEnabled: true, categories: { matchup_results: { enabled: true, inApp: true, email: false, sms: false, push: false } } }
    expect(resolveNotificationPreferences(saved as never).categories.matchup_results?.push).toBe(false)
    expect(decidePush(saved as never, scoring)).toEqual({ allowed: false, reason: 'push_off' })
  })

  it('[control] the other live categories keep their push-off default', () => {
    expect(getDefaultCategoryPreferences('live_game_alerts').push).toBe(false)
    expect(getDefaultCategoryPreferences('followed_team_scores').push).toBe(false)
  })
})
