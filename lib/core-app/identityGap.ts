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
  /**
   * Filled starting slots we attempted.
   *
   * ⚠ AN EMPTY SLOT IS NOT COUNTED. A hole in someone's lineup is their
   * decision, not our failure to identify anyone.
   */
  total: number
  /** Of those, how many carry a name — from ANY source. */
  named: number
  /**
   * Of those, how many carry a projection, i.e. are usable by anything
   * downstream.
   *
   * ⚠ NAMED AND PRICED CAME APART THE MOMENT A PROVIDER-NAME FALLBACK EXISTED.
   * `sports_core_player_provider_identities` names an ESPN athlete but carries
   * no position and no club (0 of 1,257), so those rows produce a name and
   * nothing else — no projection, no headshot, no bench-check eligibility.
   * Keying this note on identity alone would fall silent exactly then, and a
   * roster of named players with no numbers looks COMPLETE, which is a worse
   * silence than a roster of blanks.
   */
  priced: number
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

  const platform = c.platform.trim().toLowerCase()
  const cause = BRIDGED_PLATFORM_NOTE[platform]
  const platformLabel = platform === 'espn' ? 'ESPN' : platform || 'this platform'

  /*
   * ⚠ THREE FAILURES, THREE SENTENCES. "Nobody is named" is a statement about
   * the PLATFORM; "three are missing" is a statement about three players; and
   * "everyone is named but nobody can be priced" is a third thing again.
   * Collapsing any two of them sends a manager looking for a problem with their
   * roster that does not exist.
   */

  /* 1. Nothing resolved at all — no bridge for this platform. */
  if (c.named === 0) {
    const because = cause ?? `we hold no id bridge for ${platformLabel}`
    return (
      `None of the ${c.total} players in this lineup could be identified — ${because}. ` +
      `This is a gap in AllFantasy, not something wrong with your team, and it is why ` +
      `no name, headshot or projection appears below. Nothing here is being withheld ` +
      `because of your roster.`
    )
  }

  /*
   * 2. Everyone named, nobody priceable.
   *
   * ⚠ DELIBERATELY NARROW — `named === total` AND `priced === 0`. A roster where
   * the feed simply misses one or two players is normal and must stay silent, or
   * the note fires on healthy lineups and gets ignored. This shape is the
   * systematic one: a provider-name fallback that carries a name and nothing
   * else.
   */
  if (c.named === c.total && c.priced === 0) {
    /*
     * ⚠ THE CAUSE IS ONLY NAMED WHERE IT IS KNOWN. The provider-record
     * explanation is true for ESPN, whose identity rows carry a name and nothing
     * else. On any other platform the same SHAPE — everyone named, nobody priced
     * — has a different cause (most often scoring settings we cannot read), and
     * asserting ESPN's reason there would be a confident wrong answer about why
     * a manager's screen is empty. So the observable fact is stated either way
     * and the mechanism only when we hold it.
     */
    return cause
      ? `All ${c.total} players here are named from ${platformLabel}'s own athlete records, ` +
        `which carry no position or club — so none of them can be projected, given a ` +
        `headshot, or checked against your bench. The names are real; everything measured ` +
        `beside them is missing for the same single reason.`
      : `All ${c.total} players here are named, but none of them could be priced under this ` +
        `league's scoring — so there are no projections and no bench check. That is one ` +
        `cause affecting the whole lineup, not ${c.total} separate gaps.`
  }

  /* 3. A few players, not the platform. */
  if (c.named < c.total) {
    const missing = c.total - c.named
    return (
      `${missing} of ${c.total} players in this lineup could not be identified, so their ` +
      `rows carry no name or projection. The rest are unaffected.`
    )
  }

  return null
}
