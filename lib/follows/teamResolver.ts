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
 * or for college football CFBD's directory — see teamFollows.ts), so the same function is testable
 * against real fixtures.
 *
 * ⚠ AMBIGUITY RESOLVES TO NULL, NEVER TO A GUESS. "Multiple (Ravens, Falcons)", "Various", "Free
 * Agent", "League-wide" name no single team; a wrong team alert is worse than none, because the
 * follower learns to ignore the category.
 */

export type CanonicalTeam = {
  abbr: string
  name: string
  /** College only: the mascot ("Crimson Tide"). When known, a "<School> <Mascot>" prefix must carry it. */
  mascot?: string | null
  /** College only: other names the school goes by ("Miami (FL)", "UL Lafayette"). Codes are ignored. */
  aliases?: readonly string[] | null
}

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
 *
 * Values are codes in whichever team list is loaded — `sports_core_teams` for NCAAB, CFBD's directory
 * for NCAAF (teamFollows.ts) — and an alias whose code that list lacks is simply dropped. For NCAAF
 * that loses nothing: CFBD's school name IS the short form ("NC State", "Air Force"). ⚠ The risk is a
 * code meaning a DIFFERENT school in the other list (CFBD's SDSU is San Diego State; the core
 * table's is South Dakota State). Checked 2026-10-03 against all 266 CFBD FBS+FCS codes: every code
 * below that CFBD uses names the intended school. Re-check when adding one.
 */
const COLLEGE_PREFIX_ALIASES: Record<string, string | readonly string[]> = {
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
  // Schools whose NAME is an acronym — every provider writes "UCLA", never "California, Los Angeles".
  // Listed as names on purpose: a bare CODE never matches exactly (providers do not share codes —
  // see resolveTeam), so without these "UCLA" would resolve nowhere. Measured on the 2026-09-26 slate:
  // UCLA, VMI, UTSA, UTEP, UNLV, TCU and UCF games each lost their alert until they were listed.
  UCLA: "UCLA", VMI: "VMI", UTSA: "UTSA", UTEP: "UTEP", UNLV: "UNLV", TCU: "TCU", UCF: "UCF", SMU: "SMU",
  BYU: "BYU", LSU: "LSU", USC: "USC", UAB: "UAB", FAU: "FAU", FIU: "FIU", ETSU: "ETSU", NIU: "NIU",
  UTRGV: ["UTRGV", "RGV"], // CFBD codes UT Rio Grande Valley "RGV"
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
    // "Texas A and M", "North Carolina A and T", "William and Mary" (provider spellings, 2026-10-03)
    .replace(/\bA (AND|&) ([MT])\b/g, 'A&$2')
    .replace(/ AND /g, ' & ')
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
  /** College only: [core, abbr, isCode] sorted longest core first, for prefix matching. */
  schoolCores: Array<[string, string, boolean]>
  /** College only: abbr → cleaned mascot, where the team list knows it. */
  mascots: Map<string, string>
}

/** "AAMU", "UL", "SDSU": an all-caps token with no space is a code, and codes never match exactly. */
function looksLikeCode(alias: string): boolean {
  return !/[a-z]/.test(alias) && !alias.trim().includes(' ')
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
    // A one-word college name ("Alabama", as CFBD writes it) stays off the exact table: in NEWS a bare
    // school name is not trusted (resolveTeam's `exactNames`), and it still resolves through its core.
    if (!COLLEGE_SPORTS.has(S) || clean(t.name).includes(' ')) put(t.name, t.abbr)
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
  const mascots = new Map<string, string>()
  if (COLLEGE_SPORTS.has(S)) {
    const have = new Set(teams.map((t) => t.abbr))
    for (const [alias, codes] of Object.entries(COLLEGE_PREFIX_ALIASES)) {
      const abbr = (typeof codes === 'string' ? [codes] : codes).find((c) => have.has(c))
      if (abbr) prefixes.push([clean(alias), abbr, 0])
    }
    for (const t of teams) if (clean(t.abbr).length >= 2) prefixes.push([clean(t.abbr), t.abbr, 1])
    const cores = new Set<string>()
    for (const t of teams) {
      const core = schoolCore(t.name)
      cores.add(core)
      if (core.length >= 3) prefixes.push([core, t.abbr, 2])
      if (t.mascot && clean(t.mascot)) mascots.set(t.abbr, clean(t.mascot))
    }
    // The team list's own other names ("Miami (FL)", "UL Lafayette", "Dixie State"). 🛑 An alias two
    // schools claim is DROPPED, never guessed, and so is one equal to another school's name; codes
    // in the list ("AAMU", "UL") are skipped — codes never match exactly.
    const owners = new Map<string, Set<string>>()
    for (const t of teams) {
      for (const alias of t.aliases ?? []) {
        const k = clean(alias)
        if (k.length < 3 || looksLikeCode(alias) || k === clean(t.abbr)) continue
        owners.set(k, (owners.get(k) ?? new Set()).add(t.abbr))
      }
    }
    for (const [k, who] of owners) {
      const [abbr] = [...who]
      if (who.size !== 1 || (cores.has(k) && schoolCore(teams.find((t) => t.abbr === abbr)!.name) !== k)) continue
      prefixes.push([k, abbr, 0])
    }
  }
  prefixes.sort((a, b) => b[0].length - a[0].length || a[2] - b[2])
  const schoolCores: Array<[string, string, boolean]> = prefixes.map(([c, a, p]) => [c, a, p === 1])
  return { sport: S, byAlias, schoolCores, mascots }
}

/** The canonical abbreviation, or null when the string names no single team of this sport. */
/**
 * `exactNames`: the input is a SCHEDULE field (a game's home/away), which always names exactly one
 * team, so a bare school NAME ("ALABAMA", "Akron") is trustworthy there — but not a code (below) — most game
 * providers write college teams that way (measured 2026-10-03). In NEWS text it is not: the college
 * feed carries NFL noise ("CIN") and so news keeps the stricter default.
 *
 * `noPrefix`: EXACT matches only — never "starts with a school name". Schedule sources that write
 * bare school names also list hundreds of lower-division schools, and a prefix would turn "Texas
 * Lutheran" into Texas, "Ohio Wesleyan" into Ohio and "Kentucky Wesleyan" into Kentucky — an alert to
 * the wrong team's followers. Only a source that always writes "<School> <Mascot>" (ESPN) may prefix.
 */
export function resolveTeam(
  index: TeamIndex,
  raw: string | null | undefined,
  opts: { exactNames?: boolean; noPrefix?: boolean } = {},
): string | null {
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
  //
  // ⚠ A BARE CODE NEVER MATCHES EXACTLY, not even in a schedule field: providers do not share codes.
  // Measured on the 2026-09-26 slate, ESPN's live feed wrote "SDSU" for San Diego State, and our
  // canonical SDSU is South Dakota State — Toledo's one game became two alerts, one to the wrong
  // team's followers. A code still counts as a prefix ("LSU TIGERS"), where a mascot follows it.
  //
  // ⚠ IN A SCHEDULE FIELD, A "<School> <Mascot>" PREFIX MUST CARRY THAT SCHOOL'S MASCOT when the team
  // list knows it. Otherwise "Southern Arkansas Muleriders" — a D-II school outside the list — is the
  // Southern Jaguars, the same wrong-team alert as Texas Lutheran, reached through ESPN's prefix path.
  // "University of Alabama" against a list that says "Alabama": with its wrapper stripped the text is
  // still a FULL school name, so it may match exactly even in news (it did when the list was official names).
  // ⚠ LEADING wrappers only: "Miami University" is Miami (OH), and stripping a trailing "University"
  // would make it the Hurricanes.
  const wrapped = c.replace(/^THE /, '').replace(/^UNIVERSITY OF /, '')
  for (const [core, abbr, isCode] of index.schoolCores) {
    if (c === core && !isCode && (core.includes(' ') || opts.exactNames)) return abbr
    if (wrapped !== c && wrapped === core && !isCode) return abbr
    if (!opts.noPrefix && c.startsWith(core + ' ')) {
      const mascot = opts.exactNames ? index.mascots.get(abbr) : undefined
      if (mascot && !c.slice(core.length + 1).startsWith(mascot)) continue
      return abbr
    }
  }
  return null
}
