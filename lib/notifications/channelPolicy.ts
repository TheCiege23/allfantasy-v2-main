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
 * Categories that can ever send a text, which is what Settings offers an SMS switch for: the league
 * operations above, plus `injury_alerts` for ONE event (2026-11-15) — the injury sweep's near-lock
 * FINAL CALL ("your starter is out and still in your lineup"), owner-approved 2026-10-17.
 *
 * 🛑 That text was written, wired and approved, and never sent: `injury_alerts` was not a league SMS
 * category, so `allowsLeagueEventSms` refused it every time and the dispatcher recorded the text as
 * `contact_or_consent_unavailable`. Settings hid the switch for the same reason, so nobody could see it.
 */
export function isSmsCategory(category: NotificationCategoryId): boolean {
  return isLeagueSmsCategory(category) || category === 'injury_alerts'
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
  /*
   * The near-lock injury final call. Only the alert sweep sends `chimmy_alert` under `injury_alerts`, and
   * it already decides which of its rows text (one shared text per sweep, the rest `skipChannels.sms`).
   * No league required: one text can cover a starter in several leagues. Player news, digests and the
   * lineup-impact alerts send other types under this category and stay text-free.
   */
  if (category === 'injury_alerts') return event.type === 'chimmy_alert' && event.severity === 'high'
  if (!allowsLeagueSms(category, leagueId)) return false
  if (category === 'draft_alerts') return event.type === 'draft_on_the_clock'
  if (category === 'lineup_reminders') return event.type === 'chimmy_slate_lock_check' && event.severity === 'high'
  return event.severity === 'high'
}
