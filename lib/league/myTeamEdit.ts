import { isOffensiveDisplayName } from "@/lib/moderation/offensiveName"

/**
 * A member editing their own team in a league — the rules, kept pure so the route and the panel
 * agree and a test can pin them.
 */

/** Long enough for "The Mahomes Supremacy Clause", short enough to fit a standings row. */
export const MAX_TEAM_NAME_LENGTH = 40

export type TeamNameCheck = { ok: true; teamName: string } | { ok: false; message: string }

/**
 * Trim and validate a team name.
 *
 * Team names are user-generated content other managers read on every standings row, matchup and
 * trade — the same App Store 1.2 reasoning that put `isOffensiveDisplayName` on display names. The
 * WHOLE-WORD filter, not the substring one: a team called "Dickerson Dynasty" is fine.
 */
export function checkTeamName(raw: unknown): TeamNameCheck {
  const teamName = String(raw ?? "").replace(/\s+/g, " ").trim()
  if (!teamName) return { ok: false, message: "Enter a team name." }
  if (teamName.length > MAX_TEAM_NAME_LENGTH) {
    return { ok: false, message: `Keep it to ${MAX_TEAM_NAME_LENGTH} characters.` }
  }
  if (isOffensiveDisplayName(teamName)) return { ok: false, message: "Please choose a different team name." }
  return { ok: true, teamName }
}
