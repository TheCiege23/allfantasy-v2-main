import type { FantraxPlayerRef } from '@/lib/league-import/fantrax/fantraxApi'

/**
 * Fantrax player id -> our `PlayerIdentityMap` row, for the pro sports a Fantrax dynasty league lives in.
 *
 * This is the MLB matcher (`mlbFantraxIdentityPlan.ts`, unchanged in behaviour) generalised by sport.
 * The rule is the same for every sport: exact normalized name + a recognised CURRENT team + a compatible
 * role, and never a name-only guess. Two candidates are counted as ambiguous and skipped, and an id is
 * never written over an existing link.
 *
 * ⚠ THE ROLE TEST IS DELIBERATELY COARSE, AND FOR BASKETBALL IT IS ONLY "IS A BASKETBALL PLAYER".
 * `lib/adp/fantraxNbaAdp.ts` measured Fantrax and `PlayerIdentityMap` disagreeing on NBA position for
 * 241 of 346 matched players (70%: Aaron Gordon PF/C, Amen Thompson SF/PG). Requiring the same
 * PG/SG/SF/PF/C would refuse most real matches, so basketball keys on name + team alone; position only
 * has to parse as basketball. Hockey keeps one split that is never ambiguous: a goalie is not a skater.
 *
 * DB-first: this module is pure. The provider read and the guarded write live in
 * `ingestProFantraxIdentities.ts`, which only the scheduled ingestion calls.
 */

export type ProFantraxSport = 'MLB' | 'NBA' | 'NHL'

export type ProIdentityRow = {
  id: string
  canonicalName: string
  currentTeam: string | null
  position: string | null
  fantraxId: string | null
  rollingInsightsId: string | null
}

const MLB_TEAMS: Record<string, string[]> = {
  ARI: ['Arizona Diamondbacks', 'AZ', 'ARZ'], ATL: ['Atlanta Braves'], BAL: ['Baltimore Orioles'], BOS: ['Boston Red Sox'],
  CHC: ['Chicago Cubs'], CWS: ['Chicago White Sox', 'CHW'], CIN: ['Cincinnati Reds'], CLE: ['Cleveland Guardians', 'Cleveland Indians'],
  COL: ['Colorado Rockies'], DET: ['Detroit Tigers'], HOU: ['Houston Astros'], KC: ['Kansas City Royals', 'KCR'],
  LAA: ['Los Angeles Angels', 'Los Angeles Angels of Anaheim'], LAD: ['Los Angeles Dodgers'], MIA: ['Miami Marlins'], MIL: ['Milwaukee Brewers'],
  MIN: ['Minnesota Twins'], NYM: ['New York Mets'], NYY: ['New York Yankees'], ATH: ['Athletics', 'Oakland Athletics', 'OAK'],
  PHI: ['Philadelphia Phillies'], PIT: ['Pittsburgh Pirates'], SD: ['San Diego Padres', 'SDP'], SEA: ['Seattle Mariners'],
  SF: ['San Francisco Giants', 'SFG'], STL: ['St Louis Cardinals', 'St. Louis Cardinals'], TB: ['Tampa Bay Rays', 'TBR'],
  TEX: ['Texas Rangers'], TOR: ['Toronto Blue Jays'], WSH: ['Washington Nationals', 'WAS'],
}

/** Common abbreviation variants are listed because neither side's spelling is pinned by a capture. */
const NBA_TEAMS: Record<string, string[]> = {
  ATL: ['Atlanta Hawks'], BOS: ['Boston Celtics'], BKN: ['Brooklyn Nets', 'BRK', 'BKLYN'], CHA: ['Charlotte Hornets', 'CHO'],
  CHI: ['Chicago Bulls'], CLE: ['Cleveland Cavaliers'], DAL: ['Dallas Mavericks'], DEN: ['Denver Nuggets'],
  DET: ['Detroit Pistons'], GSW: ['Golden State Warriors', 'GS'], HOU: ['Houston Rockets'], IND: ['Indiana Pacers'],
  LAC: ['Los Angeles Clippers', 'LA Clippers'], LAL: ['Los Angeles Lakers', 'LA Lakers'], MEM: ['Memphis Grizzlies'], MIA: ['Miami Heat'],
  MIL: ['Milwaukee Bucks'], MIN: ['Minnesota Timberwolves'], NOP: ['New Orleans Pelicans', 'NO', 'NOR'], NYK: ['New York Knicks', 'NY'],
  OKC: ['Oklahoma City Thunder'], ORL: ['Orlando Magic'], PHI: ['Philadelphia 76ers', 'Philadelphia Sixers'], PHX: ['Phoenix Suns', 'PHO'],
  POR: ['Portland Trail Blazers', 'Portland Trailblazers'], SAC: ['Sacramento Kings'], SAS: ['San Antonio Spurs', 'SA'], TOR: ['Toronto Raptors'],
  UTA: ['Utah Jazz', 'UTAH'], WAS: ['Washington Wizards', 'WSH'],
}

const NHL_TEAMS: Record<string, string[]> = {
  ANA: ['Anaheim Ducks'], BOS: ['Boston Bruins'], BUF: ['Buffalo Sabres'], CGY: ['Calgary Flames', 'CAL'],
  CAR: ['Carolina Hurricanes'], CHI: ['Chicago Blackhawks'], COL: ['Colorado Avalanche'], CBJ: ['Columbus Blue Jackets', 'CLS'],
  DAL: ['Dallas Stars'], DET: ['Detroit Red Wings'], EDM: ['Edmonton Oilers'], FLA: ['Florida Panthers', 'FLO'],
  LAK: ['Los Angeles Kings', 'LA'], MIN: ['Minnesota Wild'], MTL: ['Montreal Canadiens', 'MON'], NSH: ['Nashville Predators', 'NAS'],
  NJD: ['New Jersey Devils', 'NJ'], NYI: ['New York Islanders'], NYR: ['New York Rangers'], OTT: ['Ottawa Senators'],
  PHI: ['Philadelphia Flyers'], PIT: ['Pittsburgh Penguins'], SJS: ['San Jose Sharks', 'SJ'], SEA: ['Seattle Kraken'],
  STL: ['St Louis Blues', 'St. Louis Blues'], TBL: ['Tampa Bay Lightning', 'TB'], TOR: ['Toronto Maple Leafs'],
  /* Arizona's franchise moved to Utah in 2024; the old code is NOT folded in — a player listed under it is stale. */
  UTA: ['Utah Hockey Club', 'Utah Mammoth', 'UTAH'], VAN: ['Vancouver Canucks'], VGK: ['Vegas Golden Knights', 'VEG'],
  WSH: ['Washington Capitals', 'WAS'], WPG: ['Winnipeg Jets', 'WIN'],
}

const MLB_HITTER = ['C', '1B', '2B', '3B', 'SS', 'OF', 'LF', 'CF', 'RF', 'DH', 'UT', 'UTIL']
const NBA_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'GF', 'FC', 'UT', 'UTIL']
const NHL_SKATER = ['C', 'LW', 'RW', 'W', 'F', 'D', 'LD', 'RD']

type SportRules = { teams: Record<string, string[]>; roles: (position: string | null) => string[] }

function tokens(position: string | null): string[] {
  return String(position ?? '').toUpperCase().split(/[,/\s-]+/).filter(Boolean)
}

const RULES: Record<ProFantraxSport, SportRules> = {
  MLB: {
    teams: MLB_TEAMS,
    roles(position) {
      const positions = String(position ?? '').toUpperCase().split(/[,/\s]+/)
      if (positions.includes('TWP')) return ['pitcher', 'hitter']
      return [...new Set(positions.map(p => ['P', 'SP', 'RP'].includes(p) ? 'pitcher' : MLB_HITTER.includes(p) ? 'hitter' : '').filter(Boolean))]
    },
  },
  NBA: {
    teams: NBA_TEAMS,
    roles: (position) => (tokens(position).some(p => NBA_POSITIONS.includes(p)) ? ['player'] : []),
  },
  NHL: {
    teams: NHL_TEAMS,
    roles(position) {
      const parts = tokens(position)
      return [...new Set(parts.map(p => (p === 'G' ? 'goalie' : NHL_SKATER.includes(p) ? 'skater' : '')).filter(Boolean))]
    },
  },
}

const compact = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
const TEAM_ALIASES = Object.fromEntries(
  (Object.keys(RULES) as ProFantraxSport[]).map(sport => [
    sport,
    new Map(Object.entries(RULES[sport].teams).flatMap(([code, aliases]) => [code, ...aliases].map(name => [compact(name), code] as const))),
  ]),
) as Record<ProFantraxSport, Map<string, string>>

/** Fantrax writes "Last, First"; our registry writes "First Last". */
function nameKey(value: string) { const parts = value.split(','); return compact(parts.length === 2 ? `${parts[1]} ${parts[0]}` : value) }

/** The canonical team code for a sport, or undefined when the label is not a team we recognise. */
export function proTeamCode(sport: ProFantraxSport, label: string | null | undefined): string | undefined {
  return TEAM_ALIASES[sport].get(compact(label ?? ''))
}

/** Exact normalized name + recognized current team + compatible role; never a name-only guess. */
export function planProFantraxIdentityLinks(sport: ProFantraxSport, refs: FantraxPlayerRef[], identities: ProIdentityRow[]) {
  const rules = RULES[sport]
  const teamAliases = TEAM_ALIASES[sport]
  const byName = new Map<string, ProIdentityRow[]>()
  for (const row of identities) { const key = nameKey(row.canonicalName); byName.set(key, [...(byName.get(key) ?? []), row]) }
  const proposed: Array<{ id: string; fantraxId: string; rollingInsightsId: string }> = []
  const existingSourceIds = new Set(identities.map(row => row.fantraxId).filter(Boolean))
  let unmatched = 0, ambiguous = 0, unchanged = 0, conflicts = 0
  for (const ref of refs) {
    const sourceTeam = teamAliases.get(compact(ref.team ?? ''))
    const sourceRoles = rules.roles(ref.position)
    if (!ref.fantraxId || !sourceTeam || !sourceRoles.length) { unmatched++; continue }
    const candidates = (byName.get(nameKey(ref.name)) ?? []).filter(row => row.rollingInsightsId && teamAliases.get(compact(row.currentTeam ?? '')) === sourceTeam && rules.roles(row.position).some(role => sourceRoles.includes(role)))
    if (!candidates.length) { unmatched++; continue }
    if (candidates.length !== 1) { ambiguous++; continue }
    const row = candidates[0]!
    if (row.fantraxId === ref.fantraxId) { unchanged++; continue }
    if (row.fantraxId || existingSourceIds.has(ref.fantraxId)) { conflicts++; continue }
    proposed.push({ id: row.id, fantraxId: ref.fantraxId, rollingInsightsId: row.rollingInsightsId! })
  }
  const counts = new Map<string, number>()
  for (const link of proposed) { const key = link.rollingInsightsId; counts.set(key, (counts.get(key) ?? 0) + 1) }
  const links = proposed.filter(link => counts.get(link.rollingInsightsId) === 1)
  return { links, unmatched, ambiguous: ambiguous + proposed.length - links.length, unchanged, conflicts, provided: refs.length }
}
