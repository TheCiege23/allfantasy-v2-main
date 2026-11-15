import type { NotificationCategoryId } from '@/lib/notification-settings/types'

/** Texts are reserved for league operations; sports/news alerts use email and push. */
export function isLeagueSmsCategory(category: NotificationCategoryId): boolean {
  return [
    'draft_alerts', 'lineup_reminders', 'league_announcements', 'commissioner_alerts',
  ].includes(category)
}

export function allowsLeagueSms(category: NotificationCategoryId, leagueId?: string | null): boolean {
  return !!leagueId && isLeagueSmsCategory(category)
}

/**
 * An event that emails by DEFAULT although its category's email starts off (2026-11-15).
 *
 * Only Chimmy's WEEKLY lineup check under `lineup_reminders`. It is sent at most once a week, only when
 * a lineup has a fix to make (a clean week sends nothing), hours before the main slate, and it carries
 * its own designed email (`renderLineupCheck` → `emailOverride`) — which, with the category's email
 * off by default, almost nobody ever received. The category's other events stay off: the daily NBA/NHL
 * waiver tip and the best-ball depth check would be an email a day.
 *
 * ⚠ NOT THE SLATE-LOCK "FINAL CALL". `runSlateLockCheck` skips email on purpose: it lands 20–90 min
 * before a lock, and an email read after kickoff is advice nobody can take. Its header says the weekly
 * check is the one that emails; this is what makes that true by default.
 *
 * ⚠ A DEFAULT, NOT AN OVERRIDE. The caller asks this only when the person has NOT saved an `email`
 * value for the category: an explicit "email off" is never second-guessed.
 */
export function emailsByDefaultForEvent(category: NotificationCategoryId, event: { type: string }): boolean {
  return category === 'lineup_reminders' && event.type === 'chimmy_lineup_check'
}

export function allowsLeagueEventSms(
  category: NotificationCategoryId,
  leagueId: string | null | undefined,
  event: { type: string; severity: 'low' | 'medium' | 'high' },
): boolean {
  if (!allowsLeagueSms(category, leagueId)) return false
  if (category === 'draft_alerts') return event.type === 'draft_on_the_clock'
  if (category === 'lineup_reminders') return event.type === 'chimmy_slate_lock_check' && event.severity === 'high'
  return event.severity === 'high'
}
