/**
 * One key for a college team, whatever a feed decided to call it.
 *
 * WHY THIS EXISTS. The 10-day NCAAF slate names **1,527 distinct team strings**
 * for a sport with roughly 660 teams across all divisions, because three
 * conventions coexist in `SportsGame` at once:
 *
 *   abbreviation    ACU · AFA · AKR · ALA · ARIZ · ARMY
 *   school+mascot   Air Force Falcons · Abilene Christian Wildcats
 *   plain school    Adams State · Adrian
 *
 * `SportsTeam` has the same split: 231 TheSportsDB rows ("Vanderbilt", with a
 * logo) and 265 Rolling Insights rows ("Vanderbilt University", without one),
 * and only THREE names match exactly across the two. So only 277 of those 1,527
 * slate names can resolve to a logo today, and no amount of fetching more logos
 * changes that — the join is what is broken, not the coverage.
 *
 * 🛑 AN AMBIGUOUS ALIAS IS DROPPED, NEVER GUESSED. Mascots collide constantly
 * ("Wildcats" is a dozen schools) and short names collide dangerously — "San
 * Diego" is not "San Diego State". Any alias claimed by more than one team is
 * removed from the index entirely, so a lookup returns null rather than a
 * confident wrong badge. This is the same rule the player work needed: a blank
 * crest is honest, the wrong crest is not.
 */

export interface CollegeTeamRecord {
  /** ESPN team id, which is what CFBD's `id` actually is. */
  id: number
  school: string
  mascot?: string | null
  abbreviation?: string | null
  alternateNames?: string[] | null
  classification?: string | null
  logo?: string | null
}

export interface CollegeTeamIndex {
  /** normalized alias -> team, with every ambiguous alias removed */
  byAlias: Map<string, CollegeTeamRecord>
  /** aliases dropped for pointing at more than one team, for reporting */
  ambiguous: Map<string, number>
}

/**
 * Reduce a team string to a comparable token.
 *
 * Deliberately conservative. It strips only the wrappers that genuinely carry no
 * identity — punctuation, and the generic institution words that one feed writes
 * and another omits ("Vanderbilt University" vs "Vanderbilt"). It does NOT try
 * to expand "St" to "State": that rewrite turns "St. John's" into "State Johns"
 * and would fuse distinct schools. Where a feed uses "Adams St", CFBD already
 * supplies it in `alternateNames`, so the alias arrives as data rather than as a
 * guess.
 */
export function normalizeTeamToken(input: string | null | undefined): string {
  if (!input) return ''
  let s = String(input)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // Leading wrappers: "The Ohio State University", "University of San Diego".
  s = s.replace(/^the\s+/, '')
  s = s.replace(/^university\s+of\s+/, '')
  s = s.replace(/^college\s+of\s+/, '')

  // Trailing wrappers: "Vanderbilt University", "Boston College".
  // `college` is only stripped when something precedes it, so the school
  // literally named "College" — none exist, but the rule should not depend on
  // that — cannot normalize to an empty string.
  s = s.replace(/\s+(university|univ|college)$/, '')
  s = s.replace(/\s+state\s+university$/, ' state')

  return s.trim()
}

/**
 * Every string a feed might reasonably use for this team.
 *
 * Mascot ALONE is never an alias — it is the single most collision-prone form in
 * college sport and would map "Wildcats" to whichever school happened to be
 * indexed last.
 */
export function aliasesForTeam(team: CollegeTeamRecord): string[] {
  const out: string[] = []
  const push = (v: string | null | undefined) => {
    const n = normalizeTeamToken(v)
    if (n) out.push(n)
  }

  push(team.school)
  if (team.mascot) push(`${team.school} ${team.mascot}`)
  push(team.abbreviation)
  for (const alt of team.alternateNames ?? []) push(alt)

  return [...new Set(out)]
}

/**
 * Build the lookup, dropping any alias that more than one team claims.
 *
 * The drop is unconditional and does not prefer FBS over FCS: preferring the
 * "more important" team is exactly how "San Diego" quietly becomes San Diego
 * State on a scoreboard. If the string is ambiguous, the honest answer is that
 * we do not know which team it is.
 */
export function buildCollegeTeamIndex(teams: CollegeTeamRecord[]): CollegeTeamIndex {
  const claims = new Map<string, Set<number>>()
  const byId = new Map<number, CollegeTeamRecord>()

  for (const team of teams) {
    byId.set(team.id, team)
    for (const alias of aliasesForTeam(team)) {
      const set = claims.get(alias) ?? new Set<number>()
      set.add(team.id)
      claims.set(alias, set)
    }
  }

  const byAlias = new Map<string, CollegeTeamRecord>()
  const ambiguous = new Map<string, number>()

  for (const [alias, ids] of claims) {
    if (ids.size === 1) {
      const team = byId.get([...ids][0])
      if (team) byAlias.set(alias, team)
    } else {
      ambiguous.set(alias, ids.size)
    }
  }

  return { byAlias, ambiguous }
}

/** Resolve a feed's team string. Null when unknown or ambiguous — never a guess. */
export function resolveCollegeTeam(
  name: string | null | undefined,
  index: CollegeTeamIndex,
): CollegeTeamRecord | null {
  const token = normalizeTeamToken(name)
  if (!token) return null
  return index.byAlias.get(token) ?? null
}

/** The logo for a feed's team string, or null. */
export function resolveCollegeTeamLogo(
  name: string | null | undefined,
  index: CollegeTeamIndex,
): string | null {
  return resolveCollegeTeam(name, index)?.logo ?? null
}
