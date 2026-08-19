const CANONICAL_TEAMS: Record<string, { canonical: string; fullName: string; city: string; mascot: string }> = {
  ARI: { canonical: 'ARI', fullName: 'Arizona Cardinals', city: 'Arizona', mascot: 'Cardinals' },
  ATL: { canonical: 'ATL', fullName: 'Atlanta Falcons', city: 'Atlanta', mascot: 'Falcons' },
  BAL: { canonical: 'BAL', fullName: 'Baltimore Ravens', city: 'Baltimore', mascot: 'Ravens' },
  BUF: { canonical: 'BUF', fullName: 'Buffalo Bills', city: 'Buffalo', mascot: 'Bills' },
  CAR: { canonical: 'CAR', fullName: 'Carolina Panthers', city: 'Carolina', mascot: 'Panthers' },
  CHI: { canonical: 'CHI', fullName: 'Chicago Bears', city: 'Chicago', mascot: 'Bears' },
  CIN: { canonical: 'CIN', fullName: 'Cincinnati Bengals', city: 'Cincinnati', mascot: 'Bengals' },
  CLE: { canonical: 'CLE', fullName: 'Cleveland Browns', city: 'Cleveland', mascot: 'Browns' },
  DAL: { canonical: 'DAL', fullName: 'Dallas Cowboys', city: 'Dallas', mascot: 'Cowboys' },
  DEN: { canonical: 'DEN', fullName: 'Denver Broncos', city: 'Denver', mascot: 'Broncos' },
  DET: { canonical: 'DET', fullName: 'Detroit Lions', city: 'Detroit', mascot: 'Lions' },
  GB: { canonical: 'GB', fullName: 'Green Bay Packers', city: 'Green Bay', mascot: 'Packers' },
  HOU: { canonical: 'HOU', fullName: 'Houston Texans', city: 'Houston', mascot: 'Texans' },
  IND: { canonical: 'IND', fullName: 'Indianapolis Colts', city: 'Indianapolis', mascot: 'Colts' },
  JAX: { canonical: 'JAX', fullName: 'Jacksonville Jaguars', city: 'Jacksonville', mascot: 'Jaguars' },
  KC: { canonical: 'KC', fullName: 'Kansas City Chiefs', city: 'Kansas City', mascot: 'Chiefs' },
  LAC: { canonical: 'LAC', fullName: 'Los Angeles Chargers', city: 'Los Angeles', mascot: 'Chargers' },
  LAR: { canonical: 'LAR', fullName: 'Los Angeles Rams', city: 'Los Angeles', mascot: 'Rams' },
  LV: { canonical: 'LV', fullName: 'Las Vegas Raiders', city: 'Las Vegas', mascot: 'Raiders' },
  MIA: { canonical: 'MIA', fullName: 'Miami Dolphins', city: 'Miami', mascot: 'Dolphins' },
  MIN: { canonical: 'MIN', fullName: 'Minnesota Vikings', city: 'Minnesota', mascot: 'Vikings' },
  NE: { canonical: 'NE', fullName: 'New England Patriots', city: 'New England', mascot: 'Patriots' },
  NO: { canonical: 'NO', fullName: 'New Orleans Saints', city: 'New Orleans', mascot: 'Saints' },
  NYG: { canonical: 'NYG', fullName: 'New York Giants', city: 'New York', mascot: 'Giants' },
  NYJ: { canonical: 'NYJ', fullName: 'New York Jets', city: 'New York', mascot: 'Jets' },
  PHI: { canonical: 'PHI', fullName: 'Philadelphia Eagles', city: 'Philadelphia', mascot: 'Eagles' },
  PIT: { canonical: 'PIT', fullName: 'Pittsburgh Steelers', city: 'Pittsburgh', mascot: 'Steelers' },
  SEA: { canonical: 'SEA', fullName: 'Seattle Seahawks', city: 'Seattle', mascot: 'Seahawks' },
  SF: { canonical: 'SF', fullName: 'San Francisco 49ers', city: 'San Francisco', mascot: '49ers' },
  TB: { canonical: 'TB', fullName: 'Tampa Bay Buccaneers', city: 'Tampa Bay', mascot: 'Buccaneers' },
  TEN: { canonical: 'TEN', fullName: 'Tennessee Titans', city: 'Tennessee', mascot: 'Titans' },
  WAS: { canonical: 'WAS', fullName: 'Washington Commanders', city: 'Washington', mascot: 'Commanders' },
}

const ALIAS_MAP: Record<string, string> = {
  JAC: 'JAX',
  WSH: 'WAS',
  GNB: 'GB',
  GBP: 'GB',
  KCC: 'KC',
  NWE: 'NE',
  SFO: 'SF',
  TAM: 'TB',
  TBB: 'TB',
  NOR: 'NO',
  SDG: 'LAC',
  STL: 'LAR',
  LA: 'LAR',
  OAK: 'LV',
  RAI: 'LV',
  RAM: 'LAR',
  CLT: 'IND',
  RAV: 'BAL',
  HTX: 'HOU',
  CRD: 'ARI',
  WFT: 'WAS',
  WST: 'WAS',
}

export function normalizeTeamAbbrev(raw: string | null | undefined): string | null {
  if (!raw) return null
  const upper = raw.trim().toUpperCase()
  if (!upper) return null

  if (CANONICAL_TEAMS[upper]) return upper

  const alias = ALIAS_MAP[upper]
  if (alias) return alias

  for (const [canonical, info] of Object.entries(CANONICAL_TEAMS)) {
    if (
      info.fullName.toLowerCase() === upper.toLowerCase() ||
      info.mascot.toLowerCase() === upper.toLowerCase() ||
      info.city.toLowerCase() === upper.toLowerCase()
    ) {
      return canonical
    }
  }

  return upper
}

export function getTeamInfo(abbrev: string | null | undefined) {
  if (!abbrev) return null
  const canonical = normalizeTeamAbbrev(abbrev)
  if (!canonical) return null
  return CANONICAL_TEAMS[canonical] || null
}

export function getAllCanonicalTeams() {
  return Object.entries(CANONICAL_TEAMS).map(([abbrev, info]) => ({
    abbrev,
    ...info,
  }))
}

const POSITION_CANONICAL: Record<string, string> = {
  QB: 'QB',
  RB: 'RB',
  WR: 'WR',
  TE: 'TE',
  K: 'K',
  PK: 'K',
  DEF: 'DEF',
  DST: 'DEF',
  DL: 'DL',
  DE: 'DL',
  DT: 'DL',
  LB: 'LB',
  ILB: 'LB',
  OLB: 'LB',
  MLB: 'LB',
  DB: 'DB',
  CB: 'DB',
  S: 'DB',
  SS: 'DB',
  FS: 'DB',
  EDGE: 'EDGE',
  OL: 'OL',
  OT: 'OL',
  OG: 'OL',
  C: 'OL',
  FB: 'RB',
}

/**
 * @deprecated The map above is football-shaped ('C' → 'OL', 'G' → guard-vs-goalie ambiguity), so
 * calling this for NBA/NCAAB/NHL/MLB silently corrupts positions. Use `normalizePositionForSport`
 * anywhere the sport is known.
 */
export function normalizePosition(raw: string | null | undefined): string | null {
  if (!raw) return null
  const upper = raw.trim().toUpperCase()
  return POSITION_CANONICAL[upper] || upper
}

const FOOTBALL_SPORTS = new Set(['NFL', 'NCAAF'])

/**
 * Sport-aware position normalization. Football sports keep the historical POSITION_CANONICAL
 * folding (C/G/T → OL, CB/S → DB, …). Every other sport passes through uppercased, because the
 * football map actively corrupts them: 'C' is a Center in basketball/hockey/baseball (not an
 * offensive lineman) and 'G' is a Guard in basketball / Goalie in hockey (not an offensive
 * guard). Verified in prod: NCAAB rows were stored with position 'OL'.
 */
export function normalizePositionForSport(
  sport: string | null | undefined,
  raw: string | null | undefined
): string | null {
  if (!raw) return null
  const upper = raw.trim().toUpperCase()
  if (!upper) return null

  const sportKey = (sport ?? '').trim().toUpperCase()
  if (FOOTBALL_SPORTS.has(sportKey)) return POSITION_CANONICAL[upper] || upper
  return upper
}

/** DB bound on SportsPlayerRecord.team / SportsGame team columns (@db.VarChar(32)). */
export const TEAM_CODE_MAX_LENGTH = 32

export type TeamCodeNormalization =
  | 'canonical'       // matched the NFL canonical/alias table
  | 'provider_code'   // input was already a short code-shaped identifier
  | 'mapped'          // resolved via a caller-supplied name → code map (e.g. SportsTeam.shortName)
  | 'derived'         // deterministic initials-based code built from the name
  | 'truncated_fallback' // last resort: bounded slice of the raw name
  | 'missing'         // no usable input

export interface NormalizedTeamCode {
  code: string | null
  originalName: string | null
  normalization: TeamCodeNormalization
}

export interface NormalizeTeamCodeInput {
  sport: string
  rawTeam: string | null | undefined
  /** Optional UPPERCASED-name → short-code map (e.g. built from SportsTeam.name → shortName). */
  teamCodeMap?: ReadonlyMap<string, string> | null
}

// Words that carry no identity when deriving a short code from an institution name.
const TEAM_NAME_FILLER = new Set(['UNIVERSITY', 'COLLEGE', 'OF', 'THE', 'AT', 'AND', '&', 'A&M', 'A&T'])

/** Looks like a provider short code already: no spaces, short, alnum-ish. */
function isCodeShaped(upper: string): boolean {
  return upper.length >= 2 && upper.length <= 12 && /^[A-Z0-9._&-]+$/.test(upper)
}

/** Deterministic initials-based code, e.g. "North Carolina Agricultural and Technical State University" → "NCATS". */
function deriveTeamInitialsCode(name: string): string | null {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9\s&-]/g, ' ')
    .split(/[\s-]+/)
    .filter((word) => word.length > 0 && !TEAM_NAME_FILLER.has(word))
  if (words.length < 2) return null
  const initials = words.map((word) => word[0]).join('')
  return initials.length >= 2 && initials.length <= 12 ? initials : initials.slice(0, 12)
}

/**
 * Sport-aware team-code normalization for DB-bounded team columns.
 *
 * Why this exists: `normalizeTeamAbbrev` above is NFL-only — for any non-NFL team it falls
 * through to `return upper`, i.e. the RAW UNTRUNCATED input. College providers send full
 * institution names ("North Carolina Agricultural and Technical State University", 58 chars),
 * which overflow `SportsPlayerRecord.team @db.VarChar(32)` and crash the whole sport's import
 * batch. The returned `code` is ALWAYS ≤ TEAM_CODE_MAX_LENGTH.
 *
 * Resolution order: NFL canonical table → already-code-shaped input → caller-supplied name map
 * (SportsTeam.shortName covers 100% of NCAAF/NCAAB teams in prod) → derived initials →
 * bounded truncation. The full display name is NOT discarded — it's echoed back as
 * `originalName` and remains available in the unbounded source tables (SportsPlayer.team,
 * SportsTeam.name); never render `code` where a display name is expected.
 */
export function normalizeTeamCode(input: NormalizeTeamCodeInput): NormalizedTeamCode {
  const originalName = input.rawTeam?.trim() || null
  if (!originalName) return { code: null, originalName: null, normalization: 'missing' }

  const upper = originalName.toUpperCase()
  const sportKey = input.sport.trim().toUpperCase()

  // 1. NFL canonical/alias table (also safe for NCAAF inputs that are genuinely NFL-style codes).
  if (FOOTBALL_SPORTS.has(sportKey) || sportKey === 'NFL') {
    if (CANONICAL_TEAMS[upper]) return { code: upper, originalName, normalization: 'canonical' }
    const alias = ALIAS_MAP[upper]
    if (alias) return { code: alias, originalName, normalization: 'canonical' }
  }
  if (sportKey === 'NFL') {
    // Full-name/mascot/city matching only applies to the NFL table.
    const canonical = normalizeTeamAbbrev(originalName)
    if (canonical && CANONICAL_TEAMS[canonical]) {
      return { code: canonical, originalName, normalization: 'canonical' }
    }
  }

  // 2. Already a short provider code.
  if (isCodeShaped(upper)) return { code: upper, originalName, normalization: 'provider_code' }

  // 3. Caller-supplied name → code map (e.g. SportsTeam.name → shortName).
  const mapped = input.teamCodeMap?.get(upper)?.trim()
  if (mapped && mapped.length > 0 && mapped.length <= TEAM_CODE_MAX_LENGTH) {
    return { code: mapped.toUpperCase(), originalName, normalization: 'mapped' }
  }

  // 4. Deterministic derived initials.
  const derived = deriveTeamInitialsCode(originalName)
  if (derived) return { code: derived, originalName, normalization: 'derived' }

  // 5. Bounded fallback so ingestion never crashes on one row.
  return {
    code: upper.slice(0, TEAM_CODE_MAX_LENGTH).trim(),
    originalName,
    normalization: 'truncated_fallback',
  }
}

/** Final schema-boundary guard for @db.VarChar(32) team columns. */
export function assertTeamCodeFits(code: string | null): string | null {
  if (!code) return null
  if (code.length > TEAM_CODE_MAX_LENGTH) {
    throw new Error(`Normalized team code exceeds ${TEAM_CODE_MAX_LENGTH} characters: ${code}`)
  }
  return code
}

export function normalizePlayerName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/\bjr\.?\b/i, '')
    .replace(/\bsr\.?\b/i, '')
    .replace(/\bii+\b/i, '')
    .replace(/\biii\b/i, '')
    .replace(/\biv\b/i, '')
    .replace(/\bv\b/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function playerNamesMatch(nameA: string, nameB: string): boolean {
  const a = normalizePlayerName(nameA)
  const b = normalizePlayerName(nameB)
  if (a === b) return true

  const partsA = a.split(' ')
  const partsB = b.split(' ')
  if (partsA.length >= 2 && partsB.length >= 2) {
    if (partsA[partsA.length - 1] === partsB[partsB.length - 1] && partsA[0] === partsB[0]) {
      return true
    }
  }
  return false
}
