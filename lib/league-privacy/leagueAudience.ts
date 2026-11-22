/**
 * Every league made on AllFantasy is either PUBLIC or PRIVATE. This is the one rule for which.
 *
 * Public means the commissioner chose it: `league_privacy_visibility` is "public" (the create
 * wizard and the Find a League listing card write it), or the league has a public dashboard.
 * Everything else is private — including the ~20 leagues that never had the key written, because
 * they predate the create wizard writing it or came from a path that doesn't (Exile Island,
 * tournaments, transfers). Reading "unset" as private matches LeaguePrivacyResolver's default and
 * is the safe direction: a league nobody chose to open stays closed.
 *
 * Pure and client-safe. Find a League (DiscoveryQueryLayer) and My Leagues both read it, so the
 * label on a card can never disagree with whether the league is listed.
 */

export type LeagueAudience = "public" | "private"

export const LEAGUE_VISIBILITY_KEY = "league_privacy_visibility"
export const LEAGUE_PUBLIC_DASHBOARD_KEY = "publicDashboard"

export function leagueAudience(settings: unknown): LeagueAudience {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return "private"
  const record = settings as Record<string, unknown>
  const visibility = String(record[LEAGUE_VISIBILITY_KEY] ?? "").trim().toLowerCase()
  return visibility === "public" || record[LEAGUE_PUBLIC_DASHBOARD_KEY] === true ? "public" : "private"
}
