type WorldCupTeamSeedRow = {
  fifaCode?: string | null
  countryCode?: string | null
  abbreviation?: string | null
  code?: string | null
  countryName: string
  displayName?: string | null
  flagEmoji?: string | null
  flagUrl?: string | null
  group?: string | null
  groupName?: string | null
  seed?: number | null
  ranking?: number | null
}

const COUNTRY_ALIASES: Record<string, string> = {
  usa: "USA",
  "united states": "USA",
  "united states of america": "USA",
  england: "England",
  korea: "Korea Republic",
  "south korea": "Korea Republic",
}

const FIFA_TO_FLAG_CODE: Record<string, string> = {
  ARG: "ar",
  AUS: "au",
  BEL: "be",
  BRA: "br",
  CAN: "ca",
  COL: "co",
  CRO: "hr",
  DEN: "dk",
  ECU: "ec",
  ENG: "gb-eng",
  ESP: "es",
  FRA: "fr",
  GER: "de",
  GHA: "gh",
  IRN: "ir",
  JPN: "jp",
  KOR: "kr",
  KSA: "sa",
  MAR: "ma",
  MEX: "mx",
  NED: "nl",
  NGA: "ng",
  NZL: "nz",
  PAR: "py",
  POR: "pt",
  RSA: "za",
  SEN: "sn",
  SUI: "ch",
  SWE: "se",
  TUN: "tn",
  URU: "uy",
  USA: "us",
}

export function normalizeFifaTeamCode(code?: string | null): string | null {
  if (!code) return null
  const normalized = code.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(normalized)) return null
  return normalized
}

function normalizeCountryName(name: string): string {
  const raw = name.trim()
  if (!raw) return ""
  const alias = COUNTRY_ALIASES[raw.toLowerCase()]
  if (alias) return alias
  return raw
}

export function getFlagUrlForCountryCode(countryCode?: string | null): string | null {
  if (!countryCode) return null
  const trimmed = countryCode.trim()
  const fifaCode = normalizeFifaTeamCode(trimmed)
  if (fifaCode) {
    return `https://flagcdn.com/w80/${FIFA_TO_FLAG_CODE[fifaCode] ?? fifaCode.slice(0, 2).toLowerCase()}.png`
  }
  const iso2 = trimmed.toLowerCase()
  if (!/^[a-z]{2}(-[a-z]{3})?$/.test(iso2)) return null
  // TODO: align with canonical platform flag CDN strategy if one is preferred.
  return `https://flagcdn.com/w80/${iso2}.png`
}

export function normalizeWorldCupTeamSeedRow(row: WorldCupTeamSeedRow) {
  const fifaCode = normalizeFifaTeamCode(row.fifaCode ?? row.abbreviation ?? row.code ?? row.countryCode)
  const countryName = normalizeCountryName(row.countryName)
  const displayName = row.displayName?.trim() || countryName
  const groupName = row.groupName?.trim() || row.group?.trim() || null
  const seed = Number.isInteger(row.seed ?? undefined) ? row.seed : null
  const ranking = Number.isInteger(row.ranking ?? undefined) ? row.ranking : null
  return {
    fifaCode,
    countryName,
    displayName,
    flagUrl: row.flagUrl?.trim() || getFlagUrlForCountryCode(row.countryCode ?? fifaCode),
    flagEmoji: row.flagEmoji?.trim() || null,
    groupName,
    seed,
    ranking,
    sourcePayload: {
      flagEmoji: row.flagEmoji?.trim() || null,
      seed,
      ranking,
      groupName,
      importSource: "seed",
    },
  }
}

export function validateTeamSeedRow(row: WorldCupTeamSeedRow): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  if (!row.countryName?.trim()) errors.push("countryName is required")
  const code = row.fifaCode ?? row.abbreviation ?? row.code
  if (code && !normalizeFifaTeamCode(code)) {
    errors.push("fifaCode must be a 3-letter code")
  }
  if (row.countryCode && !normalizeFifaTeamCode(row.countryCode) && !/^[a-z]{2}(-[a-z]{3})?$/i.test(row.countryCode.trim())) {
    errors.push("countryCode must be a 2-letter flag code or 3-letter FIFA code")
  }
  if (row.seed != null && (!Number.isInteger(row.seed) || row.seed < 1)) errors.push("seed must be a positive integer")
  if (row.ranking != null && (!Number.isInteger(row.ranking) || row.ranking < 1)) errors.push("ranking must be a positive integer")
  return { ok: errors.length === 0, errors }
}

// TODO: Add official FIFA 2026 team and fixture seed import wiring once source data is finalized.
