/**
 * When a lineup's player ids do not resolve, say WHY — once, not once per row.
 *
 * ⚠ NO 'server-only', NO PRISMA, NO IMPORTS. Both screens render this copy and
 * one of them is a client component; importing a constant from a `server-only`
 * loader typechecks and then fails at BUILD time, taking the whole `/core`
 * bundle with it. Same rule as `rosterSlots.ts` and `weekBoardRules.ts`.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * Measured on production 2026-08-29, distinct starting-slot ids by platform:
 *
 *     sleeper   680 of 680 resolve   (100%)
 *     manual     74 resolve + 24 descriptive `name:` ids = all accounted for
 *     espn        0 of 145 resolve   (0%)
 *
 * ESPN publishes its own athlete ids and this app holds no bridge for them:
 * `SportsPlayer` has ZERO rows sourced from ESPN, and `PlayerIdentityMap`
 * carries 21 espn ids in total against the 145 needed.
 *
 * 🛑 AND THE OBVIOUS BRIDGE IS A TRAP THAT SHIPS THE WRONG PLAYER. Joining ESPN
 * ids to `SportsPlayer.externalId` "resolves" 17 of 145 — and every one is a
 * NUMERIC COLLISION WITH A COLLEGE PLAYER. ESPN id `15847` matches Matthew
 * Jester, LB, Princeton; `4880281` matches Jordyn Tyson, WR, Arizona State —
 * both NCAAF rows from `rolling_insights`/`cfbd`. `externalId` is unique only
 * WITHIN a sport, so that join is not a partial bridge, it is a 17-player
 * fabrication. Name-matching is equally wrong here: `PlayerIdentityMap` holds
 * 178 NFL duplicate groups that no key separates.
 *
 * So the screens state the gap instead of filling it. A row that says
 * "Unresolved player" 12 times reads as twelve broken players; one sentence
 * naming the platform reads as what it is — a bridge this app has not built.
 */

export type IdentityCoverage = {
  /** Ids that resolved to a player row. */
  resolved: number
  /** Ids we tried to resolve. Empty slots are NOT counted — a hole is not a miss. */
  total: number
  /** `League.platform`, lowercased. Named in the copy, because it is the cause. */
  platform: string
}

/** Platforms whose ids this app can name, for copy that says what DOES work. */
const BRIDGED_PLATFORM_NOTE: Record<string, string> = {
  espn: 'ESPN publishes its own athlete ids and AllFantasy holds no bridge for them yet',
}

/**
 * One sentence explaining an identity gap, or null when there is nothing to say.
 *
 * ⚠ RETURNS NULL WHEN EVERYTHING RESOLVED, and null when nothing was attempted.
 * A note that appears on a healthy roster trains people to ignore it.
 */
export function identityGapNote(c: IdentityCoverage): string | null {
  if (c.total <= 0) return null
  if (c.resolved >= c.total) return null

  const platform = c.platform.trim().toLowerCase()
  const cause = BRIDGED_PLATFORM_NOTE[platform]
  const platformLabel = platform === 'espn' ? 'ESPN' : platform || 'this platform'

  /*
   * ⚠ TOTAL FAILURE AND PARTIAL FAILURE ARE DIFFERENT FACTS. Zero of twelve is a
   * statement about the PLATFORM; nine of twelve is a statement about three
   * players. Rendering them in the same words tells a manager to go looking for
   * a problem with their roster that does not exist.
   */
  if (c.resolved === 0) {
    const because = cause ?? `we hold no id bridge for ${platformLabel}`
    return (
      `None of the ${c.total} players in this lineup could be identified — ${because}. ` +
      `This is a gap in AllFantasy, not something wrong with your team, and it is why ` +
      `no name, headshot or projection appears below. Nothing here is being withheld ` +
      `because of your roster.`
    )
  }

  const missing = c.total - c.resolved
  return (
    `${missing} of ${c.total} players in this lineup could not be identified, so their ` +
    `rows carry no name or projection. The rest are unaffected.`
  )
}
