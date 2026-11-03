/**
 * League vibe tags: what it's LIKE to be in a league, which the format filters can't say.
 * Two 12-team PPR dynasty leagues can be a group chat of friends who trade every week or a
 * silent one that never trades, and which one a player wants decides whether they stay.
 *
 * The commissioner picks up to three (FindLeagueListingCard / ExternalListingCard), stored on
 * the league's settings. A fixed list, not free text: a filter needs values that match, and a
 * stranger's free-text tag is a moderation problem.
 */

export const LEAGUE_VIBES = [
  { id: "competitive", label: "Competitive" },
  { id: "casual", label: "Casual" },
  { id: "beginner_friendly", label: "Beginner friendly" },
  { id: "active_chat", label: "Active chat" },
  { id: "trash_talk", label: "Trash talk" },
  { id: "trade_happy", label: "Trade happy" },
  { id: "long_haul", label: "In it for years" },
  { id: "low_key", label: "Low-key" },
] as const

export type LeagueVibe = (typeof LEAGUE_VIBES)[number]["id"]
export type LeagueVibeFilter = "all" | LeagueVibe

export const LEAGUE_VIBES_KEY = "findLeagueVibes"
export const MAX_LEAGUE_VIBES = 3

const VIBE_IDS = new Set<string>(LEAGUE_VIBES.map((v) => v.id))

export function isLeagueVibe(value: unknown): value is LeagueVibe {
  return typeof value === "string" && VIBE_IDS.has(value)
}

export function vibeLabel(vibe: LeagueVibe): string {
  return LEAGUE_VIBES.find((v) => v.id === vibe)?.label ?? vibe
}

/** Valid, distinct, at most three, in the order given. */
export function normalizeLeagueVibes(raw: unknown): LeagueVibe[] {
  if (!Array.isArray(raw)) return []
  const out: LeagueVibe[] = []
  for (const value of raw) {
    if (isLeagueVibe(value) && !out.includes(value)) out.push(value)
    if (out.length === MAX_LEAGUE_VIBES) break
  }
  return out
}

export function readLeagueVibes(settings: unknown): LeagueVibe[] {
  const record = settings && typeof settings === "object" && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {}
  return normalizeLeagueVibes(record[LEAGUE_VIBES_KEY])
}
