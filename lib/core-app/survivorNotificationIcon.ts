/**
 * The small Survivor icon a notification row wears on the /core notifications screen.
 *
 * Every Survivor notification reaches `PlatformNotification` with `type = 'survivor:<kind>'`:
 * the Survivor queue (lib/survivor/notificationEngine.ts) dispatches each `SurvivorNotification` row
 * as `survivor:${n.type}`, commissioner alerts (lib/survivor/survivorCommissionerAlerts.ts) are
 * queued as `commissioner_<alertKind>` and go out the same way, and Steal Three
 * (lib/survivor/survivorStealThree.ts) writes `survivor:steal_three` directly. The loader
 * (lib/core-app/notificationsCenter.ts) passes the part after `survivor:` as `survivorType`.
 *
 * Pure and client-safe. Decides the icon only — never the copy, the category or the delivery.
 */

export type SurvivorNotificationIcon =
  | 'ballot'
  | 'torch'
  | 'skull'
  | 'immunity'
  | 'idol'
  | 'swap'
  | 'exile'
  | 'merge'
  | 'jury'
  | 'crown'
  | 'challenge'
  | 'chimmy'
  | 'raid'
  | 'alert'

export const SURVIVOR_NOTIFICATION_TYPE_PREFIX = 'survivor:'

/** Exact kinds, from the writers named above. Anything else Survivor falls back by family below. */
const ICON_BY_KIND: Readonly<Record<string, SurvivorNotificationIcon>> = {
  // Tribal Council
  votes_close_soon: 'ballot',
  vote_reminder: 'ballot',
  council_read: 'torch',
  elimination: 'skull',
  torch_out: 'skull',
  // Immunity, idols, challenges
  immunity_won: 'immunity',
  idol_found: 'idol',
  challenge_posted: 'challenge',
  challenge_closing: 'challenge',
  // The island changing shape
  tribe_swap: 'swap',
  tribe_shuffle_recommendation: 'swap',
  commissioner_tribes_rebalanced: 'swap',
  merge_announced: 'merge',
  back_from_exile: 'exile',
  commissioner_exile_setup_failed: 'exile',
  // The end game
  jury_vote_open: 'jury',
  commissioner_jury_overdue: 'jury',
  season_champion: 'crown',
  // Chimmy and the commissioner
  commissioner_chimmy_weekly_report: 'chimmy',
  steal_three: 'raid',
  sit_out_nomination: 'ballot',
  phase_change: 'torch',
}

/** The kind part of a stored notification type, when it is a Survivor one. */
export function survivorNotificationKind(type: string | null | undefined): string | null {
  if (typeof type !== 'string' || !type.startsWith(SURVIVOR_NOTIFICATION_TYPE_PREFIX)) return null
  const kind = type.slice(SURVIVOR_NOTIFICATION_TYPE_PREFIX.length).trim()
  return kind || null
}

/**
 * The icon for a Survivor notification kind (the part after `survivor:`). Null for no kind, so a
 * non-Survivor row draws nothing extra. An unknown commissioner alert is an alert; any other
 * unknown Survivor kind gets the torch, the show's own mark.
 */
export function survivorNotificationIcon(kind: string | null | undefined): SurvivorNotificationIcon | null {
  if (typeof kind !== 'string' || !kind) return null
  const exact = ICON_BY_KIND[kind]
  if (exact) return exact
  if (kind.startsWith('commissioner_') || kind.startsWith('draft_')) return 'alert'
  return 'torch'
}
