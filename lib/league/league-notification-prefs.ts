/**
 * League-level notification toggles stored on `League.settings.leagueNotificationPrefs`.
 * User account categories still apply; this gates league-scoped fanouts when the league opts out.
 */

type LeagueNotificationPrefs = {
  tradeAlerts?: boolean
  waiverResults?: boolean
  lineupLockReminders?: boolean
  playoffRace?: boolean
  commissionerBroadcasts?: boolean
}

export function parseLeagueNotificationPrefs(settings: unknown): LeagueNotificationPrefs {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return {}
  const raw = (settings as Record<string, unknown>).leagueNotificationPrefs
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return raw as LeagueNotificationPrefs
}

/** Default when unset: enabled (same as NotificationsSettingsPanel initial state). */
export function isLeaguePrefEnabled(prefs: LeagueNotificationPrefs, key: keyof LeagueNotificationPrefs): boolean {
  return prefs[key] !== false
}

