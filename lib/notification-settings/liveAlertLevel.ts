/**
 * Live game alert LEVEL — one setting that decides how much a person hears during games.
 * Owner's call, 2026-10-22: "make the changes active and give a definition of what each means".
 *
 * Stored as `notificationPreferences.liveAlertLevel` in the existing UserProfile JSON. No migration:
 * `mergeNotificationPreferences` carries unknown top-level keys through, and an absent value reads
 * as DEFAULT_LIVE_ALERT_LEVEL — which is exactly what everyone received before this setting existed.
 *
 * Pure and client-safe: the settings screen renders the definitions from here, and the senders
 * (lib/engagement-alerts/gameAlertService.ts, lib/live/bigPlayNotifier.ts, the starter alerts and the
 * game recap) enforce the same table through `liveAlertAllowed`, so the words and the behaviour
 * cannot drift apart.
 */

export type LiveAlertLevel = 'everything' | 'my_teams' | 'close_games' | 'off'

export const LIVE_ALERT_LEVELS: readonly LiveAlertLevel[] = ['everything', 'my_teams', 'close_games', 'off']

export const DEFAULT_LIVE_ALERT_LEVEL: LiveAlertLevel = 'everything'

/**
 * What a live alert is, for the level table.
 *   starter_play — "your starter scored": a play by a player in your starting lineup.
 *   play         — a scoring or big play in a game you follow or have a starter in.
 *   checkpoint   — halftime, end of a period or inning, the seventh-inning stretch.
 *   final        — the final score of a game you follow or have a starter in.
 *   recap        — the one summary after each of your games.
 *   close        — a close game, overtime or a playoff moment.
 */
export type LiveAlertKind = 'starter_play' | 'play' | 'checkpoint' | 'final' | 'recap' | 'close'

/**
 * May this person get this alert at this level?
 * `inGame` = they follow a team in it or start a player in it. A close game with no such tie is the
 * "across the sport" alert that only Everything sends.
 */
export function liveAlertAllowed(level: LiveAlertLevel, kind: LiveAlertKind, opts: { inGame: boolean }): boolean {
  switch (level) {
    case 'off':
      return false
    case 'close_games':
      return kind === 'close'
    case 'my_teams':
      return opts.inGame || kind === 'starter_play' || kind === 'recap'
    case 'everything':
    default:
      return true
  }
}

export function readLiveAlertLevel(prefs: unknown): LiveAlertLevel {
  const raw = prefs && typeof prefs === 'object' ? (prefs as { liveAlertLevel?: unknown }).liveAlertLevel : undefined
  return typeof raw === 'string' && (LIVE_ALERT_LEVELS as readonly string[]).includes(raw) ? (raw as LiveAlertLevel) : DEFAULT_LIVE_ALERT_LEVEL
}

/** i18n keys for each level's name and definition (lib/i18n/translations.ts). */
export const LIVE_ALERT_LEVEL_LABEL_KEYS: Record<LiveAlertLevel, { name: string; definition: string }> = {
  everything: { name: 'settings.notifications.liveLevel.everything', definition: 'settings.notifications.liveLevel.everythingHint' },
  my_teams: { name: 'settings.notifications.liveLevel.myTeams', definition: 'settings.notifications.liveLevel.myTeamsHint' },
  close_games: { name: 'settings.notifications.liveLevel.closeGames', definition: 'settings.notifications.liveLevel.closeGamesHint' },
  off: { name: 'settings.notifications.liveLevel.off', definition: 'settings.notifications.liveLevel.offHint' },
}
