/**
 * Player news LEVEL — how much a person hears about the players on their rosters.
 * Owner's call, 2026-10-22, after one day brought the owner 59 emails about everyone from starters
 * to deep bench players: "more notifications is not what users need".
 *
 * Stored as `notificationPreferences.playerNewsLevel` in the existing UserProfile JSON (no migration;
 * absent = DEFAULT_PLAYER_NEWS_LEVEL). Pure and client-safe: the settings screen renders the
 * definitions from here and every player-news sender routes through `routePlayerNews`.
 *
 * THE TABLE
 *                              starter   rostered (bench/IR/taxi)   follows player   follows team
 *   Starters only (default)    instant   digest                     instant          digest
 *   My whole roster            instant   instant                    instant          digest
 *   Off                        —         —                          —                —
 *
 *   instant = a push and the bell, right away. Never an email.
 *   digest  = the bell only, then ONE "Roster news" email a day (lib/notifications/playerNewsDigest).
 * A story with no clear status ("dealing with a sore hamstring") is digest-only at every level:
 * instant is for news that changes a lineup decision.
 */

export type PlayerNewsLevel = 'starters' | 'roster' | 'off'
export const PLAYER_NEWS_LEVELS: readonly PlayerNewsLevel[] = ['starters', 'roster', 'off']
export const DEFAULT_PLAYER_NEWS_LEVEL: PlayerNewsLevel = 'starters'

/** How a person is connected to the player the news is about. */
export type PlayerNewsRelation = 'starter' | 'rostered' | 'player_follower' | 'team_follower'
export type PlayerNewsRoute = 'instant' | 'digest' | 'drop'

export function routePlayerNews(level: PlayerNewsLevel, relation: PlayerNewsRelation, opts: { instantWorthy: boolean }): PlayerNewsRoute {
  if (level === 'off') return 'drop'
  if (!opts.instantWorthy || relation === 'team_follower') return 'digest'
  if (relation === 'starter' || relation === 'player_follower') return 'instant'
  return level === 'roster' ? 'instant' : 'digest'
}

export function readPlayerNewsLevel(prefs: unknown): PlayerNewsLevel {
  const raw = prefs && typeof prefs === 'object' ? (prefs as { playerNewsLevel?: unknown }).playerNewsLevel : undefined
  return typeof raw === 'string' && (PLAYER_NEWS_LEVELS as readonly string[]).includes(raw) ? (raw as PlayerNewsLevel) : DEFAULT_PLAYER_NEWS_LEVEL
}

export const PLAYER_NEWS_LEVEL_LABEL_KEYS: Record<PlayerNewsLevel, { name: string; definition: string }> = {
  starters: { name: 'settings.notifications.playerNews.starters', definition: 'settings.notifications.playerNews.startersHint' },
  roster: { name: 'settings.notifications.playerNews.roster', definition: 'settings.notifications.playerNews.rosterHint' },
  off: { name: 'settings.notifications.playerNews.off', definition: 'settings.notifications.playerNews.offHint' },
}
