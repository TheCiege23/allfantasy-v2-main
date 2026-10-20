import type { NotificationCategoryId } from '@/lib/notification-settings/types'

/** Texts are reserved for league operations; sports/news alerts use email and push. */
export function isLeagueSmsCategory(category: NotificationCategoryId): boolean {
  return [
    'draft_alerts', 'trade_proposals', 'trade_accept_reject', 'waiver_processing',
    'league_announcements', 'commissioner_alerts',
  ].includes(category)
}

export function allowsLeagueSms(category: NotificationCategoryId, leagueId?: string | null): boolean {
  return !!leagueId && isLeagueSmsCategory(category)
}
