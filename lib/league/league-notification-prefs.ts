/**
 * League-level notification toggles stored on `League.settings.leagueNotificationPrefs`.
 * User account categories still apply; this gates league-scoped fanouts when the league opts out.
 */

export type LeagueNotificationPrefs = {
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

/**
 * Whether a league fanout notification should be dispatched for this event type.
 * Unknown / unlisted event types remain enabled so we do not silently drop new flows.
 */
export function leagueFanoutNotificationsAllowed(eventType: string, prefs: LeagueNotificationPrefs): boolean {
  const t = String(eventType)
  if (t.startsWith('af_trade_')) return isLeaguePrefEnabled(prefs, 'tradeAlerts')
  if (t === 'waiver_processed') return isLeaguePrefEnabled(prefs, 'waiverResults')
  if (t === 'settings_changed') return isLeaguePrefEnabled(prefs, 'commissionerBroadcasts')
  if (t === 'playoff_advancement' || t.startsWith('playoff_')) return isLeaguePrefEnabled(prefs, 'playoffRace')
  return true
}

