/**
 * Registry of team metadata per sport (static fallback + DB-aware).
 * Provides team_id, team_name, city, abbreviation, conference, division, primary_logo_url.
 * Used by TeamLogoResolver and league/frontend for sport-specific team lists and branding.
 */
import type { SportType, TeamMetadata } from './types'
import { getAllCanonicalTeams } from '@/lib/team-abbrev'

const ESPN_LOGO_BASE: Record<SportType, string> = {
  NFL: 'https://a.espncdn.com/i/teamlogos/nfl/500',
  NBA: 'https://a.espncdn.com/i/teamlogos/nba/500',
  MLB: 'https://a.espncdn.com/i/teamlogos/mlb/500',
  NHL: 'https://a.espncdn.com/i/teamlogos/nhl/500',
  NCAAF: 'https://a.espncdn.com/i/teamlogos/ncaaf/500',
  NCAAB: 'https://a.espncdn.com/i/teamlogos/ncaab/500',
  SOCCER: 'https://a.espncdn.com/i/teamlogos/soccer/500',
}

/** ESPN path segment per team (lowercase) for NFL; other sports use abbreviation lowercased. */
const NFL_LOGO_KEY: Record<string, string> = {
  ARI: 'ari', ATL: 'atl', BAL: 'bal', BUF: 'buf', CAR: 'car', CHI: 'chi',
  CIN: 'cin', CLE: 'cle', DAL: 'dal', DEN: 'den', DET: 'det', GB: 'gb',
  HOU: 'hou', IND: 'ind', JAX: 'jax', KC: 'kc', LAC: 'lac', LAR: 'lar',
  LV: 'lv', MIA: 'mia', MIN: 'min', NE: 'ne', NO: 'no', NYG: 'nyg',
  NYJ: 'nyj', PHI: 'phi', PIT: 'pit', SEA: 'sea', SF: 'sf', TB: 'tb',
  TEN: 'ten', WAS: 'was',
}

const NBA_ABBREV = ['ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GS', 'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN', 'NO', 'NY', 'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SA', 'TOR', 'UTAH', 'WAS']
const MLB_ABBREV = ['ARI', 'ATL', 'BAL', 'BOS', 'CHC', 'CWS', 'CIN', 'CLE', 'COL', 'DET', 'HOU', 'KC', 'LAA', 'LAD', 'MIA', 'MIL', 'MIN', 'NYM', 'NYY', 'OAK', 'PHI', 'PIT', 'SD', 'SF', 'SEA', 'STL', 'TB', 'TEX', 'TOR', 'WSH']
const NHL_ABBREV = ['ANA', 'ARI', 'BOS', 'BUF', 'CGY', 'CAR', 'CHI', 'COL', 'CBJ', 'DAL', 'DET', 'EDM', 'FLA', 'LA', 'MIN', 'MTL', 'NSH', 'NJ', 'NYI', 'NYR', 'OTT', 'PHI', 'PIT', 'SJ', 'SEA', 'STL', 'TB', 'TOR', 'VAN', 'VGK', 'WPG', 'WSH']

/** NCAA Football: FBS team abbreviations (subset for logo/display; expand via DB or ingestion). Unique abbrevs. */
const NCAAF_ABBREV = [
  'ALA', 'ARK', 'AUB', 'FLA', 'UGA', 'UK', 'LSU', 'MSU', 'OLE', 'SC', 'TEN', 'TAMU', 'VAN', 'CLEM', 'DUKE', 'FSU', 'GT', 'LOU', 'MIA', 'UNC', 'NCST', 'PITT', 'SYR', 'UVA', 'VT', 'WAKE',
  'ILL', 'IND', 'IOWA', 'MD', 'MICH', 'MINN', 'NEB', 'NW', 'OSU', 'PSU', 'PUR', 'RUT', 'WIS', 'BU', 'CIN', 'UCF', 'HOU', 'ECU', 'MEM', 'NAVY', 'SMU', 'USF', 'TULN', 'TLS', 'BAYLOR', 'ISU', 'KU', 'KSU', 'OKLA', 'OKST', 'TCU', 'TEX', 'TTU', 'WVU', 'ARIZ', 'ASU', 'CAL', 'COLO', 'ORE', 'STAN', 'UCLA', 'USC', 'UTAH', 'WASH', 'WSU', 'ND', 'BYU', 'BSU', 'SDSU', 'UNLV', 'NM', 'WYO', 'AF', 'CSU', 'UTEP', 'UTSA', 'APP', 'CCU', 'MARSH', 'TROY',
]

/** NCAA Basketball: D1 team abbreviations (subset for logo/display; expand via DB or ingestion). Unique abbrevs. */
const NCAAB_ABBREV = [
  'ALA', 'ARK', 'AUB', 'FLA', 'UGA', 'UK', 'LSU', 'MSU', 'OLE', 'SC', 'TEN', 'TAMU', 'VAN', 'CLEM', 'DUKE', 'FSU', 'GT', 'LOU', 'MIA', 'UNC', 'NCST', 'PITT', 'SYR', 'UVA', 'VT', 'WAKE',
  'ILL', 'IND', 'IOWA', 'MD', 'MICH', 'MINN', 'NEB', 'NW', 'OSU', 'PSU', 'PUR', 'RUT', 'WIS', 'BU', 'CIN', 'UCF', 'HOU', 'MEM', 'SMU', 'TULN', 'TLS', 'BAYLOR', 'ISU', 'KU', 'KSU', 'OKLA', 'OKST', 'TCU', 'TEX', 'TTU', 'WVU', 'ARIZ', 'ASU', 'CAL', 'COLO', 'ORE', 'STAN', 'UCLA', 'USC', 'UTAH', 'WASH', 'WSU', 'GONZ', 'SMC', 'BYU', 'SDSU', 'UNLV', 'NM', 'NEV', 'WYO', 'VCU', 'DAY', 'SLU', 'XAV', 'MARQ', 'CREI', 'BUT', 'NOVA', 'SHU', 'SJU', 'PC', 'UCONN', 'GTOWN', 'DEP',
]

/** Soccer: MLS + select clubs (club/national scope). Player pool by sport_type = SOCCER; positions GKP/GK, DEF, MID, FWD. Logo path uses abbreviation; unknown clubs get ESPN-style URL fallback. */
const SOCCER_TEAMS: { abbr: string; name: string; city: string }[] = [
  { abbr: 'ATL', name: 'Atlanta United', city: 'Atlanta' },
  { abbr: 'LAFC', name: 'Los Angeles FC', city: 'Los Angeles' },
  { abbr: 'LAG', name: 'LA Galaxy', city: 'Los Angeles' },
  { abbr: 'SEA', name: 'Seattle Sounders', city: 'Seattle' },
  { abbr: 'NYC', name: 'New York City FC', city: 'New York' },
  { abbr: 'PHI', name: 'Philadelphia Union', city: 'Philadelphia' },
  { abbr: 'DAL', name: 'FC Dallas', city: 'Dallas' },
  { abbr: 'HOU', name: 'Houston Dynamo', city: 'Houston' },
  { abbr: 'SKC', name: 'Sporting Kansas City', city: 'Kansas City' },
  { abbr: 'RSL', name: 'Real Salt Lake', city: 'Salt Lake City' },
  { abbr: 'MIN', name: 'Minnesota United', city: 'Saint Paul' },
  { abbr: 'ATX', name: 'Austin FC', city: 'Austin' },
  { abbr: 'CHI', name: 'Chicago Fire', city: 'Chicago' },
  { abbr: 'CLB', name: 'Columbus Crew', city: 'Columbus' },
  { abbr: 'DC', name: 'D.C. United', city: 'Washington' },
  { abbr: 'MIA', name: 'Inter Miami CF', city: 'Miami' },
  { abbr: 'MTL', name: 'CF Montréal', city: 'Montreal' },
  { abbr: 'NE', name: 'New England Revolution', city: 'Foxborough' },
  { abbr: 'NSH', name: 'Nashville SC', city: 'Nashville' },
  { abbr: 'ORL', name: 'Orlando City', city: 'Orlando' },
  { abbr: 'POR', name: 'Portland Timbers', city: 'Portland' },
  { abbr: 'SJ', name: 'San Jose Earthquakes', city: 'San Jose' },
  { abbr: 'STL', name: 'St. Louis City SC', city: 'St. Louis' },
  { abbr: 'VAN', name: 'Vancouver Whitecaps', city: 'Vancouver' },
]

function toSportType(s: string): SportType {
  const u = s.toUpperCase()
  if (u === 'NFL' || u === 'NBA' || u === 'MLB' || u === 'NHL' || u === 'NCAAF' || u === 'NCAAB' || u === 'SOCCER') return u as SportType
  return 'NFL'
}

export function logoUrlForAbbrev(sport: SportType, abbreviation: string): string {
  const base = ESPN_LOGO_BASE[sport]
  const abbr = abbreviation.toUpperCase()
  if (sport === 'NFL') {
    const key = NFL_LOGO_KEY[abbr] ?? abbr.toLowerCase()
    return `${base}/${key}.png`
  }
  const key = abbr.toLowerCase().replace(/\s/g, '')
  return `${base}/${key}.png`
}

/** Build NFL team metadata from existing canonical teams. */
function buildNflTeams(): TeamMetadata[] {
  const teams = getAllCanonicalTeams()
  return teams.map((t) => ({
    team_id: t.abbrev,
    sport_type: 'NFL' as SportType,
    team_name: t.fullName,
    city: t.city,
    abbreviation: t.abbrev,
    conference: null,
    division: null,
    primary_logo_url: logoUrlForAbbrev('NFL', t.abbrev),
    alternate_logo_url: null,
    primary_color: null,
  }))
}

/** Build static team list for a sport (abbrev-only; name/city from abbrev for display). */
function buildLeagueTeams(sport: SportType, abbrevs: string[]): TeamMetadata[] {
  return abbrevs.map((abbr) => ({
    team_id: abbr,
    sport_type: sport,
    team_name: abbr,
    city: '',
    abbreviation: abbr,
    conference: null,
    division: null,
    primary_logo_url: logoUrlForAbbrev(sport, abbr),
    alternate_logo_url: null,
    primary_color: null,
  }))
}

/** Build Soccer team metadata (club/national scope). */
function buildSoccerTeams(): TeamMetadata[] {
  return SOCCER_TEAMS.map((t) => ({
    team_id: t.abbr,
    sport_type: 'SOCCER' as SportType,
    team_name: t.name,
    city: t.city,
    abbreviation: t.abbr,
    conference: null,
    division: null,
    primary_logo_url: logoUrlForAbbrev('SOCCER', t.abbr),
    alternate_logo_url: null,
    primary_color: null,
  }))
}

let cachedNfl: TeamMetadata[] | null = null
const cacheBySport = new Map<SportType, TeamMetadata[]>()

/**
 * Get all team metadata for a sport (static fallback). Prefer DB SportsTeam when available.
 */
export function getTeamMetadataForSport(sportType: SportType | string): TeamMetadata[] {
  const sport = toSportType(typeof sportType === 'string' ? sportType : sportType)
  if (sport === 'NFL') {
    if (!cachedNfl) cachedNfl = buildNflTeams()
    return cachedNfl
  }
  if (sport === 'NBA') {
    if (!cacheBySport.has('NBA')) cacheBySport.set('NBA', buildLeagueTeams('NBA', NBA_ABBREV))
    return cacheBySport.get('NBA')!
  }
  if (sport === 'MLB') {
    if (!cacheBySport.has('MLB')) cacheBySport.set('MLB', buildLeagueTeams('MLB', MLB_ABBREV))
    return cacheBySport.get('MLB')!
  }
  if (sport === 'NHL') {
    if (!cacheBySport.has('NHL')) cacheBySport.set('NHL', buildLeagueTeams('NHL', NHL_ABBREV))
    return cacheBySport.get('NHL')!
  }
  if (sport === 'NCAAF') {
    if (!cacheBySport.has('NCAAF')) cacheBySport.set('NCAAF', buildLeagueTeams('NCAAF', NCAAF_ABBREV))
    return cacheBySport.get('NCAAF')!
  }
  if (sport === 'NCAAB') {
    if (!cacheBySport.has('NCAAB')) cacheBySport.set('NCAAB', buildLeagueTeams('NCAAB', NCAAB_ABBREV))
    return cacheBySport.get('NCAAB')!
  }
  if (sport === 'SOCCER') {
    if (!cacheBySport.has('SOCCER')) cacheBySport.set('SOCCER', buildSoccerTeams())
    return cacheBySport.get('SOCCER')!
  }
  return []
}

/**
 * Get one team by abbreviation for a sport (static fallback).
 */
export function getTeamByAbbreviation(
  sportType: SportType | string,
  abbreviation: string
): TeamMetadata | null {
  const list = getTeamMetadataForSport(sportType)
  const abbr = abbreviation.trim().toUpperCase()
  return list.find((t) => t.abbreviation.toUpperCase() === abbr) ?? null
}

/**
 * Abbreviations that mean "no team", never a club. Providers put these in the team column
 * for free agents and unknowns; building a logo path from one is a guaranteed 404.
 */
const NOT_A_TEAM = new Set(['FA', 'F/A', 'FREE AGENT', 'N/A', 'NONE', 'NULL', 'TBD', 'UNK', '—', '-', '--'])

/** True for a team-column value that names no club (free agent, unknown, blank). */
export function isNotATeam(abbreviation: string | null | undefined): boolean {
  const abbr = abbreviation?.trim()
  return !abbr || NOT_A_TEAM.has(abbr.toUpperCase())
}

/**
 * Primary logo URL for a team (abbreviation + sport). Use for rendering when DB has no logo.
 * If team is not in static list (e.g. Soccer club not in SOCCER_TEAMS), returns ESPN-style URL by sport + abbr so logos can still be attempted.
 *
 * ⚠ BUT NOT FOR A VALUE THAT IS NOT A TEAM. The attempt above is deliberate for real clubs the
 * static lists miss; it is never right for "FA", which every free agent carries — that built
 * `…/nfl/500/fa.png`, a 404, and a broken-image glyph beside every free agent in a trade.
 */
export function getPrimaryLogoUrlForTeam(
  sportType: SportType | string,
  abbreviation: string
): string | null {
  const sport = toSportType(typeof sportType === 'string' ? sportType : sportType)
  const team = getTeamByAbbreviation(sport, abbreviation)
  if (team?.primary_logo_url) return team.primary_logo_url
  if (isNotATeam(abbreviation)) return null
  return logoUrlForAbbrev(sport, abbreviation.trim())
}

/**
 * Build a lookup map from team abbreviation to team_id for a sport.
 * Useful when player rows have team abbreviation but missing team_id.
 */
export function getTeamIdByAbbreviationMap(sportType: SportType | string): Map<string, string> {
  const map = new Map<string, string>()
  for (const team of getTeamMetadataForSport(sportType)) {
    map.set(team.abbreviation.toUpperCase(), team.team_id)
  }
  return map
}

/**
 * Get team metadata for a sport using DB SportsTeam when available; falls back to static registry.
 * Implemented in a separate module so this file stays prisma-free for client-safe imports (e.g. getPrimaryLogoUrlForTeam).
 */
export async function getTeamMetadataForSportDbAware(
  sportType: SportType | string,
  options?: { limit?: number }
): Promise<TeamMetadata[]> {
  const mod = await import('./SportTeamMetadataRegistry.db')
  return mod.getTeamMetadataForSportDbAware(sportType, options)
}

/**
 * Registry schema version — bump when static team data or logo-key maps change.
 * Format: YYYY-MM-DD.revision
 */
export const SPORT_TEAM_METADATA_REGISTRY_VERSION = '2026-03-20.1'

/**
 * List sports that have team metadata registered in the static registry.
 */
export function getSupportedTeamSports(): SportType[] {
  return ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'SOCCER']
}
