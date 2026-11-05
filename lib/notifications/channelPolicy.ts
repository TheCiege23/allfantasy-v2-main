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
