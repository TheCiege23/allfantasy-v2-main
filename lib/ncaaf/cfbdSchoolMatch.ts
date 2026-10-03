/**
 * Maps a CFBD school ("Alabama") onto the Rolling Insights `SportsTeam` row whose name the NCAAF
 * player pool uses as its team string ("University of Alabama").
 *
 * Pure — no Prisma, no fetch — so the hand-run `scripts/refresh-ncaaf-pool-cfbd.ts` and the
 * scheduled `lib/ncaaf/cfbdRosterPool.ts` share ONE implementation. They were one copy in the
 * script until the scheduled job needed it; two copies of a matching rule drift.
 *
 * 🛑 THE CANDIDATE TEAMS MUST BE ROLLING INSIGHTS ROWS ONLY. Since 2026-09-30 `SportsTeam` NCAAF
 * also holds 1,933 `source = 'cfbd'` rows from `ingestCollegeTeams`, named exactly as CFBD names
 * them. Offered those, the first candidate tried — the school's own name — hits CFBD's "Alabama"
 * row before Rolling Insights' "University of Alabama", and every refreshed player's team string
 * silently changes, splitting the pool from every RI-keyed team, logo and stat. Callers filter;
 * `matchSchoolToRi` cannot tell the sources apart from a name.
 */

export type CfbdSchool = {
  school: string
  abbreviation: string | null
  alternateNames: string[] | null
}

export type RiTeam = { externalId: string; name: string; shortName: string | null }

/** Normalize a team name for matching across providers. */
export function normTeam(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,&]/g, ' ')
    .replace(/\b(university|the|of|at|college)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Manual aliases for CFBD schools whose name doesn't normalize to the RI name. */
const SCHOOL_ALIASES: Record<string, string> = {
  'NC State': 'North Carolina State',
}

/**
 * Direct RI-externalId overrides for schools the name rules cannot place safely: Miami FL [19]
 * vs Miami OH [112] normalize identically, and CFBD's "Louisiana" (UL Lafayette) shares no
 * normalized name with RI's "University of Louisiana at Lafayette" — its alternates are
 * "UL Lafayette" and "UL" — so it fell through to containment, which put its roster under
 * Louisiana Tech in the 2026-06-26 run.
 */
const SCHOOL_TO_RI_EXTERNAL_ID: Record<string, string> = {
  Miami: '19', // Miami (FL) — University of Miami
  'Miami (OH)': '112', // Miami (OH) — Miami University
  Louisiana: '247', // UL Lafayette — University of Louisiana at Lafayette
}

export type RiTeamIndex = {
  byNorm: Map<string, RiTeam>
  byShort: Map<string, RiTeam>
  byExtId: Map<string, RiTeam>
}

export function indexRiTeams(teams: readonly RiTeam[]): RiTeamIndex {
  const index: RiTeamIndex = { byNorm: new Map(), byShort: new Map(), byExtId: new Map() }
  for (const t of teams) {
    index.byNorm.set(normTeam(t.name), t)
    if (t.shortName) index.byShort.set(t.shortName.toUpperCase(), t)
    index.byExtId.set(t.externalId, t)
  }
  return index
}

export function matchSchoolToRi(team: CfbdSchool, index: RiTeamIndex): RiTeam | null {
  const override = SCHOOL_TO_RI_EXTERNAL_ID[team.school]
  if (override && index.byExtId.has(override)) return index.byExtId.get(override)!
  const alias = SCHOOL_ALIASES[team.school]
  const candidates = [team.school, ...(alias ? [alias] : []), ...(team.alternateNames ?? [])]
  for (const c of candidates) {
    const hit = index.byNorm.get(normTeam(c))
    if (hit) return hit
  }
  // Abbreviation ↔ shortName
  if (team.abbreviation) {
    const hit = index.byShort.get(team.abbreviation.toUpperCase())
    if (hit) return hit
  }
  /*
   * Containment fallback (one normalized name contains the other) — but only when exactly ONE
   * team qualifies. "louisiana" is contained in four RI names; returning the first one the Map
   * happened to yield is how a whole roster lands at the wrong school with nothing reporting it.
   * Unmatched is visible (`unmatchedSchools`); a wrong match is not.
   */
  const target = normTeam(team.school)
  const contained = [...index.byNorm].filter(([norm]) => norm && (norm.includes(target) || target.includes(norm)))
  return contained.length === 1 ? contained[0]![1] : null
}
