/**
 * Resolve a free-text team string (as news providers write it) to ONE canonical team abbreviation
 * for a sport — the key a team follow is stored under.
 *
 * WHY THIS EXISTS. `player_news.team` is written by several providers and an LLM summariser, so one
 * NFL team arrives as "GB", "Green Bay Packers", "Packers", "GB (Packers)" and "Packers (former)".
 * Measured on 30 days of production news (2026-10-03): ~50% of rows carry a team at all, and the
 * ones that do mix all of those spellings. A follow keyed on exact text would miss most of them.
 *
 * Pure and table-driven: callers pass the canonical teams for the sport (from `sports_core_teams`,
 * see teamFollows.ts), so the same function is testable against real fixtures.
 *
 * ⚠ AMBIGUITY RESOLVES TO NULL, NEVER TO A GUESS. "Multiple (Ravens, Falcons)", "Various", "Free
 * Agent", "League-wide" name no single team; a wrong team alert is worse than none, because the
 * follower learns to ignore the category.
 */

export type CanonicalTeam = { abbr: string; name: string }

/** Pro leagues whose team names are "<City> <Nickname>"; college matches on the school instead. */
const COLLEGE_SPORTS = new Set(['NCAAF', 'NCAAB'])

/** Provider spellings the canonical table does not carry. Keyed by sport, then UPPERCASE alias. */
const EXTRA_ALIASES: Record<string, Record<string, string>> = {
  NFL: { WSH: 'WAS', JAC: 'JAX', LA: 'LAR', OAK: 'LV', SD: 'LAC', STL: 'LAR' },
  NBA: { 'LA CLIPPERS': 'LAC', GSW: 'GS', NYK: 'NY', NOP: 'NO', SAS: 'SA', UTA: 'UTAH', PHO: 'PHX', BRK: 'BKN', WAS: 'WSH' },
  MLB: { ARI: 'AZ', OAK: 'ATH', 'OAKLAND ATHLETICS': 'ATH', CHW: 'CWS', WAS: 'WSH', TBR: 'TB', KCR: 'KC', SDP: 'SD', SFG: 'SF' },
  NHL: { LAK: 'LA', NJD: 'NJ', SJS: 'SJ', TBL: 'TB', 'UTAH HOCKEY CLUB': 'UTA', ARI: 'UTA' },
}

/**
 * College short names news uses that the canonical school name does not start with. Matched as
 * PREFIXES (a mascot follows), longest first, ahead of an equal-length school core — so "MIAMI"
 * means the Hurricanes, and "MIAMI (OH)" the RedHawks, although both schools reduce to "MIAMI".
 */
const COLLEGE_PREFIX_ALIASES: Record<string, string> = {
  "OLE MISS": "MISS", "NC STATE": "NCST", "PENN STATE": "PSU", "MIAMI (OH)": "M-OH", MIAMI: "MIA",
  PITTSBURGH: "PITT", UCONN: "CONN", HAWAII: "HAW", "UL MONROE": "ULM", LOUISIANA: "ULL", "APP STATE": "APP",
  "SAN JOSE STATE": "SJSU", "SOUTHERN MISS": "USM", "FLORIDA INTERNATIONAL": "FIU", ARMY: "ARMY", NAVY: "NAVY",
  "AIR FORCE": "AFA", BUFFALO: "BUFF", "SAM HOUSTON": "SHSU", TEXAS: "TEX", MASSACHUSETTS: "UMASS", NEBRASKA: "NEB",
  WISCONSIN: "WIS", COLORADO: "COLO", CALIFORNIA: "CAL", "FRESNO STATE": "FRES", "SACRAMENTO STATE": "SAC",
  "UC DAVIS": "UCD", "WILLIAM & MARY": "W&M", "HOLY CROSS": "HC", "NORTH CAROLINA": "UNC", NEVADA: "NEV",
  CHARLOTTE: "CHAR", CHATTANOOGA: "CHAT", "ARKANSAS-PINE BLUFF": "ARPB", "NORTH CAROLINA A&T": "NCAT",
  "STEPHEN F AUSTIN": "SFA", MCNEESE: "MCNS", NICHOLLS: "NICH", "AUSTIN PEAY": "PEAY", "UTAH TECH": "UT",
  // Measured misses/mismatches on production news 2026-10-03: the official name does not START with
  // the short form, so a shorter school won ("GEORGIA TECH" became Georgia, "TENNESSEE TECH" Tennessee).
  "GEORGIA TECH": "GT", "TENNESSEE TECH": "TNTC", "BOWLING GREEN": "BGSU", "MIDDLE TENNESSEE": "MTSU",
}

/** Words that mean "not one team". */
const NOT_ONE_TEAM = /\b(multiple|various|league-wide|free agent|unknown|several|others?)\b|^(nfl|nba|mlb|nhl|fa)$/i

function clean(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\((FORMER|FORMERLY)[^)]*\)/g, ' ')
    .replace(/\b(FORMER|FORMERLY)\b/g, ' ')
    .replace(/[.’']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** "University of Alabama" → "ALABAMA"; "Alabama State University" → "ALABAMA STATE". */
function schoolCore(name: string): string {
  return clean(name)
    .replace(/^THE /, '')
    .replace(/^UNIVERSITY OF /, '')
    .replace(/ UNIVERSITY$/, '')
    .replace(/ COLLEGE$/, '')
    .trim()
}

export type TeamIndex = {
  sport: string
  byAlias: Map<string, string>
  /** College only: [core, abbr] sorted longest core first, for prefix matching. */
  schoolCores: Array<[string, string]>
}

export function buildTeamIndex(sport: string, teams: readonly CanonicalTeam[]): TeamIndex {
  const S = sport.toUpperCase()
  const byAlias = new Map<string, string>()
  const nicknameCount = new Map<string, number>()
  const put = (alias: string, abbr: string) => {
    const k = clean(alias)
    if (k && !byAlias.has(k)) byAlias.set(k, abbr)
  }
  for (const t of teams) {
    // ⚠ NO BARE-ABBREVIATION MATCH FOR COLLEGE. The college feed carries NFL noise ("CIN", "DET",
    // "PHI"), and "CIN" is also Cincinnati's code — the Bengals would become the Bearcats. A
    // college abbreviation only counts as a PREFIX with a mascot after it ("LSU TIGERS"), below.
    if (!COLLEGE_SPORTS.has(S)) put(t.abbr, t.abbr)
    put(t.name, t.abbr)
  }
  if (!COLLEGE_SPORTS.has(S)) {
    // Nickname = the name minus its city. Count first: a nickname two teams share ("Cardinals" in
    // NFL is only one team, but "Giants"/"Rangers"-style clashes exist across sports) is dropped.
    const nick = (name: string) => {
      const words = clean(name).split(' ')
      // Two-word nicknames that are a unit: "Red Sox", "White Sox", "Blue Jays", "Maple Leafs"…
      const two = words.slice(-2).join(' ')
      return ['RED SOX', 'WHITE SOX', 'BLUE JAYS', 'MAPLE LEAFS', 'RED WINGS', 'BLUE JACKETS', 'GOLDEN KNIGHTS', 'TRAIL BLAZERS'].includes(two)
        ? two
        : words[words.length - 1]
    }
    for (const t of teams) nicknameCount.set(nick(t.name), (nicknameCount.get(nick(t.name)) ?? 0) + 1)
    for (const t of teams) {
      const n = nick(t.name)
      if (n && nicknameCount.get(n) === 1) put(n, t.abbr)
    }
  }
  for (const [alias, abbr] of Object.entries(EXTRA_ALIASES[S] ?? {})) {
    if (teams.some((t) => t.abbr === abbr)) byAlias.set(alias, abbr)
  }
  // College prefixes: aliases (priority 0), abbreviations (1), school cores (2). Longest first; an
  // equal-length tie goes to the lower priority number, so an alias beats a colliding school core.
  const prefixes: Array<[string, string, number]> = []
  if (COLLEGE_SPORTS.has(S)) {
    const have = new Set(teams.map((t) => t.abbr))
    for (const [alias, abbr] of Object.entries(COLLEGE_PREFIX_ALIASES)) if (have.has(abbr)) prefixes.push([clean(alias), abbr, 0])
    for (const t of teams) if (clean(t.abbr).length >= 2) prefixes.push([clean(t.abbr), t.abbr, 1])
    for (const t of teams) {
      const core = schoolCore(t.name)
      if (core.length >= 3) prefixes.push([core, t.abbr, 2])
    }
  }
  prefixes.sort((a, b) => b[0].length - a[0].length || a[2] - b[2])
  const schoolCores: Array<[string, string]> = prefixes.map(([c, a]) => [c, a])
  return { sport: S, byAlias, schoolCores }
}

/** The canonical abbreviation, or null when the string names no single team of this sport. */
export function resolveTeam(index: TeamIndex, raw: string | null | undefined): string | null {
  if (!raw) return null
  const text = String(raw)
  if (NOT_ONE_TEAM.test(text.trim())) return null
  // "Chargers (to Seahawks)" / "Chargers (from Panthers)": a move names two teams — skip it.
  if (/\((TO|FROM) /i.test(text)) return null
  // "Baltimore Ravens (former)", "Titans (or former team)": the player is NOT on that team now, so a
  // follower of it must not be told. Measured on production news 2026-10-03, these resolved to the
  // old team before this line.
  if (/\bformer(ly)?\b/i.test(text)) return null
  const c = clean(text)
  if (!c) return null
  const direct = index.byAlias.get(c)
  if (direct) return direct
  // "LV (Raiders)" / "DAL (Cowboys)": try the part before the parenthesis, then inside it.
  const paren = /^(.*?)\s*\((.*)\)\s*$/.exec(c)
  if (paren) {
    const a = index.byAlias.get(paren[1].trim()) ?? index.byAlias.get(paren[2].trim())
    if (a) return a
  }
  // College: "ALABAMA CRIMSON TIDE" starts with the school core "ALABAMA". Longest core first, so
  // "ALABAMA STATE HORNETS" matches "ALABAMA STATE", not "ALABAMA". A prefix needs a mascot after
  // it (or to be the whole school name) — never a bare code, see the note in buildTeamIndex.
  for (const [core, abbr] of index.schoolCores) {
    if (c.startsWith(core + ' ') || (c === core && core.includes(' '))) return abbr
  }
  return null
}
