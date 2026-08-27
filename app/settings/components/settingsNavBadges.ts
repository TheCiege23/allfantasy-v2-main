import {
  NOTIFICATION_CATEGORY_IDS,
  type NotificationPreferences,
} from '@/lib/notification-settings/types'
import { resolveNotificationPreferences } from '@/lib/notification-settings/NotificationPreferenceResolver'
import type { SettingsProfile } from './sections/settings-types'

/**
 * Status badges for the settings nav (38a·12).
 *
 * The 38a handoff replaces this sidebar with a nine-card grid. The grid's real
 * insight is not its shape — it is that a setting's STATE should be visible
 * without opening it: "Notifications OFF" is the thing you need to know, and
 * today it is three clicks deep. That insight is delivered here; the grid is
 * not, because the existing chrome carries translated labels and a working
 * search filter that the mock has neither of, and dropping both to match a
 * layout would be a straight loss.
 *
 * ⚠ EVERY BADGE READS REAL STATE OR IS ABSENT. A hardcoded "OFF" is worse than
 * no badge — it is a confident claim about the user's own configuration, on the
 * screen where they would go to check it. There is no placeholder branch in
 * this file.
 *
 * ⚠ AND IT IS A PURE DERIVATION, NOT A FETCH. Both badges come off the same
 * `profile` object the chrome already receives and the two sections already
 * read — `notificationPreferences` and the linked-account columns. A nav badge
 * is not worth a round trip, and a second source would drift from the section
 * it summarises.
 */

export type SettingsNavBadge = {
  text: string
  /** `warn` is for a state the user probably did not intend to be in. */
  tone: 'warn' | 'count'
}

/**
 * Notifications: OFF only when genuinely nothing can reach the user.
 *
 * ⚠ THE GLOBAL FLAG ALONE IS NOT THE ANSWER. `globalEnabled` can be true while
 * every category has its channels switched off, which delivers exactly as many
 * notifications as the global toggle being off. Both routes to silence produce
 * the badge, because the user's question is "will anything reach me", not
 * "which flag is set".
 */
function notificationsBadge(profile: SettingsProfile): SettingsNavBadge | null {
  if (!profile) return null

  const saved = profile.notificationPreferences as NotificationPreferences | null

  /*
   * ⚠ THE RAW FLAG IS CHECKED BEFORE THE RESOLVED ONE, AND THAT IS NOT
   * BELT-AND-BRACES. `resolveNotificationPreferences` returns the defaults
   * early when `saved.categories` is absent — and that early return drops
   * `saved.globalEnabled` on the way past. A user who switched notifications
   * off globally without ever touching an individual category therefore
   * resolves to `globalEnabled: true`, and a badge trusting only the resolved
   * value would tell them notifications were on while nothing reached them.
   *
   * Reading the stored flag directly is correct here and needs no change to the
   * resolver, which has other callers and its own reasons.
   */
  if (saved?.globalEnabled === false) return { text: 'OFF', tone: 'warn' }

  const prefs = resolveNotificationPreferences(saved)

  if (prefs.globalEnabled === false) return { text: 'OFF', tone: 'warn' }

  const anyChannelOn = NOTIFICATION_CATEGORY_IDS.some((id) => {
    const c = prefs.categories?.[id]
    if (!c || c.enabled === false) return false
    return c.inApp === true || c.email === true || c.sms === true
  })

  return anyChannelOn ? null : { text: 'OFF', tone: 'warn' }
}

/**
 * Connected accounts: how many are linked.
 *
 * ⚠ ONLY THE THREE THAT LIVE ON THE PROFILE. Sleeper, Discord and Spotify are
 * account-level links with columns here. ESPN and Yahoo are connected
 * per-league, not per-account, so counting them would mean a different number
 * from the one the Connected Accounts section itself shows — and the badge
 * exists to summarise that section, not to disagree with it.
 *
 * Zero renders no badge rather than "0": an untouched integration is a default,
 * not a problem, and the section says so in full when opened.
 */
function connectedBadge(profile: SettingsProfile): SettingsNavBadge | null {
  if (!profile) return null

  const linked = [
    profile.sleeperUserId,
    profile.discordUserId,
    profile.spotifyConnectedAt,
  ].filter(Boolean).length

  return linked > 0 ? { text: String(linked), tone: 'count' } : null
}

/**
 * Badges by nav tab id. Absent key = no badge, which is the normal case for
 * most tabs and must stay cheap to express.
 */
export function settingsNavBadges(
  profile: SettingsProfile,
): Partial<Record<string, SettingsNavBadge>> {
  const out: Partial<Record<string, SettingsNavBadge>> = {}

  const notifications = notificationsBadge(profile)
  if (notifications) out.notifications = notifications

  const connected = connectedBadge(profile)
  if (connected) out.connected = connected

  return out
}
