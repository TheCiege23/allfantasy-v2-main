import type { NotificationCategoryId } from '@/lib/notification-settings/types'

/**
 * The /core home sections a person can switch off from Settings → Home page (2026-10-24).
 *
 * A user loved the app and said the home was "way too much information". Each switch here turns off
 * ONE visual on the home AND the notifications that come from the same thing — so "off" means the
 * whole topic goes quiet, not just its card.
 *
 * WHERE IT IS STORED. `UserProfile.notificationPreferences.hiddenHomeSections`, an array of the ids
 * below. One key drives both halves on purpose: the home reads it when it renders, and every send
 * path reads it through `isCategoryHiddenByHomeSection`. Two stores would drift, and a card that is
 * gone while its alerts still buzz is exactly the confusion this exists to remove.
 *
 * ⚠ IT IS NOT FOLDED INTO `resolveNotificationPreferences`. The Notifications tab saves the RESOLVED
 * object back wholesale, so forcing `enabled: false` there would write those categories off for good
 * — turning the section back on would no longer bring its alerts back. The mute is applied at send
 * time instead, and the stored category switches are never touched.
 *
 * ⚠ ALERTS THAT NEED YOU TO ACT ARE NOT MAPPED, even where they share a topic with a card:
 *   - `draft_alerts` (you are on the clock) — hiding the drafts card must never cost someone a pick.
 *   - `trade_proposals` (an offer sent TO you) — the trades card is league trade news, not your inbox.
 * The Settings copy says so on those two rows.
 */

export type HomeSectionId =
  | 'streak'
  | 'decisions'
  | 'since-last-visit'
  | 'live-games'
  | 'drafts'
  | 'injuries'
  | 'league-trades'
  | 'lock-brief'
  | 'league-focus'
  | 'schedule'
  | 'routine'
  | 'matchups'
  | 'chimmy'
  | 'career'
  | 'rivals'
  | 'following'
  | 'insights'

export type HomeSectionGroup = 'top' | 'week' | 'side' | 'more'

export type HomeSectionDef = {
  id: HomeSectionId
  group: HomeSectionGroup
  /** The `HomeCardName`s (components/core-app/home/HomeCards.tsx) this switch hides. */
  cards: readonly string[]
  /** Notification categories muted while the section is hidden. Empty = a visual only. */
  categories: readonly NotificationCategoryId[]
}

/** In the order the home draws them, so the Settings list reads top to bottom like the page. */
export const HOME_SECTIONS: readonly HomeSectionDef[] = [
  { id: 'streak', group: 'top', cards: ['streak'], categories: [] },
  { id: 'decisions', group: 'top', cards: ['issues'], categories: [] },
  { id: 'since-last-visit', group: 'top', cards: ['since-last-visit'], categories: [] },
  { id: 'live-games', group: 'top', cards: ['game-day'], categories: ['live_game_alerts', 'performance_alerts'] },
  { id: 'drafts', group: 'top', cards: ['drafts'], categories: ['draft_intel_alerts'] },
  { id: 'injuries', group: 'top', cards: ['triage'], categories: ['injury_alerts', 'lineup_alerts'] },
  // League trade news is sent under trade_accept_reject (lib/provider-trades/notifyProviderLeagueTrades.ts).
  { id: 'league-trades', group: 'top', cards: ['trade-band'], categories: ['trade_accept_reject'] },
  { id: 'lock-brief', group: 'top', cards: ['carryover'], categories: [] },
  { id: 'league-focus', group: 'top', cards: ['user-os'], categories: [] },
  { id: 'schedule', group: 'top', cards: ['schedule'], categories: [] },
  { id: 'routine', group: 'week', cards: ['routine'], categories: ['lineup_reminders'] },
  { id: 'matchups', group: 'week', cards: ['matchups'], categories: ['matchup_results'] },
  { id: 'chimmy', group: 'side', cards: ['chimmy'], categories: ['ai_alerts'] },
  { id: 'career', group: 'side', cards: ['career'], categories: ['career_milestones'] },
  { id: 'rivals', group: 'side', cards: ['rivals'], categories: [] },
  {
    id: 'following',
    group: 'more',
    cards: ['following'],
    categories: ['followed_players', 'followed_teams', 'followed_team_scores'],
  },
  { id: 'insights', group: 'more', cards: ['portfolio-chart', 'exposure', 'receipts'], categories: [] },
]

export const HOME_SECTION_GROUPS: readonly HomeSectionGroup[] = ['top', 'week', 'side', 'more']

/** The stored key inside `notificationPreferences`. */
export const HIDDEN_HOME_SECTIONS_KEY = 'hiddenHomeSections'

const KNOWN = new Set<string>(HOME_SECTIONS.map((s) => s.id))

/**
 * The hidden section ids from a stored `notificationPreferences` value. Unknown ids are dropped, so a
 * section renamed or removed later can never hide something it no longer names.
 */
export function readHiddenHomeSections(saved: unknown): Set<HomeSectionId> {
  const out = new Set<HomeSectionId>()
  if (!saved || typeof saved !== 'object') return out
  const raw = (saved as Record<string, unknown>)[HIDDEN_HOME_SECTIONS_KEY]
  if (!Array.isArray(raw)) return out
  for (const id of raw) if (typeof id === 'string' && KNOWN.has(id)) out.add(id as HomeSectionId)
  return out
}

/** Every home card hidden by those sections. */
export function hiddenHomeCards(hidden: ReadonlySet<HomeSectionId>): Set<string> {
  const cards = new Set<string>()
  for (const section of HOME_SECTIONS) if (hidden.has(section.id)) for (const c of section.cards) cards.add(c)
  return cards
}

/** The hidden section that silences this category, or null when none does. */
export function homeSectionMutingCategory(
  saved: unknown,
  category: NotificationCategoryId,
): HomeSectionId | null {
  const hidden = readHiddenHomeSections(saved)
  if (hidden.size === 0) return null
  for (const section of HOME_SECTIONS) {
    if (hidden.has(section.id) && section.categories.includes(category)) return section.id
  }
  return null
}

/**
 * Send-time check: is this category silenced because its home section is hidden? Takes the RAW
 * stored `notificationPreferences` — the resolver does not carry this key (see the header).
 */
export function isCategoryHiddenByHomeSection(saved: unknown, category: NotificationCategoryId): boolean {
  return homeSectionMutingCategory(saved, category) !== null
}

/** The next stored list after one switch flips. Kept in `HOME_SECTIONS` order so saves are stable. */
export function toggleHomeSection(
  hidden: ReadonlySet<HomeSectionId>,
  id: HomeSectionId,
  visible: boolean,
): HomeSectionId[] {
  const next = new Set(hidden)
  if (visible) next.delete(id)
  else next.add(id)
  return HOME_SECTIONS.map((s) => s.id).filter((s) => next.has(s))
}
