import type { FantraxPlayerRef } from '@/lib/league-import/fantrax/fantraxApi'
import { fantraxSoccerScoringPosition } from '@/lib/league-import/fantrax/fantraxScoring'

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

export type ProFantraxSport = 'MLB' | 'NBA' | 'NHL' | 'SOCCER'

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

/** Fantrax club abbreviations paired with Rolling Insights team IDs from its EPL schedule. */
const EPL_TEAMS: Record<string, string[]> = {
  ARS: ['1', 'Arsenal'], BOU: ['2', 'AFC Bournemouth'], BHA: ['3', 'Brighton & Hove Albion'],
  CHE: ['6', 'Chelsea'], CRY: ['7', 'Crystal Palace'], EVE: ['8', 'Everton'], FUL: ['9', 'Fulham'],
  LIV: ['12', 'Liverpool'], MCI: ['13', 'Manchester City'], MUN: ['14', 'Manchester United'],
  NEW: ['15', 'Newcastle United'], TOT: ['17', 'Tottenham Hotspur'], AVL: ['21', 'Aston Villa'],
  WHU: ['19', 'West Ham United', 'West Ham'],
  BRF: ['24', 'Brentford'], NOT: ['25', 'Nottingham Forest'], IPS: ['26', 'Ipswich Town'],
  LEE: ['67', 'Leeds United'], SUN: ['68', 'Sunderland'], COV: ['78', 'Coventry City'], HUL: ['79', 'Hull City'],
}

const MLB_HITTER = ['C', '1B', '2B', '3B', 'SS', 'OF', 'LF', 'CF', 'RF', 'DH', 'UT', 'UTIL']
const NBA_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'GF', 'FC', 'UT', 'UTIL']
const NHL_SKATER = ['C', 'LW', 'RW', 'W', 'F', 'D', 'LD', 'RD']

type SportRules = { teams: Record<string, string[]>; roles: (position: string | null) => string[] }

function tokens(position: string | null): string[] {
  return String(position ?? '').toUpperCase().split(/[,/\s-]+/).filter(Boolean)
}

const RULES: Record<ProFantraxSport, SportRules> = {
  SOCCER: {
    teams: EPL_TEAMS,
    roles(position) {
      const slot = fantraxSoccerScoringPosition(position)
      return slot ? [slot === 'GK' ? 'keeper' : 'outfield'] : []
    },
  },
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

/**
 * Generational suffixes, dropped on BOTH sides. Fantrax writes "Jackson, Jaren" where the registry
 * holds "Jaren Jackson Jr." — measured 2026-11-19, 11 of 24 unlinked rostered NBA ids in production
 * were exactly this (Jaren Jackson, Michael Porter, Trey Murphy, Dereck Lively, GG Jackson…). A father
 * and son both active on one team stays safe: the ambiguity count refuses two candidates.
 */
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v'])

/** "First Last" words with accents, punctuation and a trailing suffix removed. Fantrax writes "Last, First". */
function nameWords(value: string): string[] {
  const parts = value.split(',')
  const ordered = parts.length === 2 ? `${parts[1]} ${parts[0]}` : value
  const words = ordered.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '').split(/[\s-]+/).filter(Boolean)
  while (words.length > 2 && SUFFIXES.has(words[words.length - 1]!)) words.pop()
  return words
}

/** Fantrax writes "Last, First"; our registry writes "First Last". */
function nameKey(value: string) { return nameWords(value).join('') }

/** Surname key and given name, for the nickname pass. */
function nameSplit(value: string): { first: string; last: string } | null {
  const words = nameWords(value)
  return words.length >= 2 ? { first: words[0]!, last: words.slice(1).join('') } : null
}

/**
 * "Mitch" for "Mitchell", "Matt" for "Matthew": one given name a prefix (3+ letters) of the other.
 * Measured 2026-11-19: Mitch Marner and Matt Coronato were unlinked for exactly this. Used only in a
 * second pass, after the exact name found nothing, and still bound by team, role and one candidate.
 */
function nicknameOf(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  return short.length >= 3 && short !== long && long.startsWith(short)
}

/**
 * Hockey's second split, used ONLY to break a tie between candidates that already agree on name, team
 * and skater/goalie: two Elias Petterssons play for Vancouver, a C and a D. Never used to refuse a
 * single candidate — sources disagree on forward labels, and the odd player converts between F and D.
 */
function nhlLine(position: string | null): 'forward' | 'defense' | null {
  const parts = tokens(position)
  const d = parts.some(p => ['D', 'LD', 'RD'].includes(p))
  const f = parts.some(p => ['C', 'LW', 'RW', 'W', 'F'].includes(p))
  return d === f ? null : d ? 'defense' : 'forward'
}

/** The canonical team code for a sport, or undefined when the label is not a team we recognise. */
export function proTeamCode(sport: ProFantraxSport, label: string | null | undefined): string | undefined {
  return TEAM_ALIASES[sport].get(compact(label ?? ''))
}

/** Exact normalized name + recognized current team + compatible role; never a name-only guess. */
export function planProFantraxIdentityLinks(sport: ProFantraxSport, refs: FantraxPlayerRef[], identities: ProIdentityRow[]) {
  const rules = RULES[sport]
  const teamAliases = TEAM_ALIASES[sport]
  const byName = new Map<string, ProIdentityRow[]>()
  const bySurname = new Map<string, ProIdentityRow[]>()
  for (const row of identities) {
    const key = nameKey(row.canonicalName); byName.set(key, [...(byName.get(key) ?? []), row])
    const split = nameSplit(row.canonicalName)
    if (split) bySurname.set(split.last, [...(bySurname.get(split.last) ?? []), row])
  }
  const proposed: Array<{ id: string; fantraxId: string; rollingInsightsId: string }> = []
  const existingSourceIds = new Set(identities.map(row => row.fantraxId).filter(Boolean))
  let unmatched = 0, ambiguous = 0, unchanged = 0, conflicts = 0
  for (const ref of refs) {
    const sourceTeam = teamAliases.get(compact(ref.team ?? ''))
    const sourceRoles = rules.roles(ref.position)
    if (!ref.fantraxId || !sourceTeam || !sourceRoles.length) { unmatched++; continue }
    const fits = (row: ProIdentityRow) => Boolean(row.rollingInsightsId) && teamAliases.get(compact(row.currentTeam ?? '')) === sourceTeam && rules.roles(row.position).some(role => sourceRoles.includes(role))
    let candidates = (byName.get(nameKey(ref.name)) ?? []).filter(fits)
    if (!candidates.length) {
      const split = nameSplit(ref.name)
      candidates = split ? (bySurname.get(split.last) ?? []).filter(row => {
        const other = nameSplit(row.canonicalName)
        return other !== null && nicknameOf(split.first, other.first) && fits(row)
      }) : []
    }
    if (candidates.length > 1 && sport === 'NHL') {
      const line = nhlLine(ref.position)
      const sameLine = line ? candidates.filter(row => nhlLine(row.position) === line) : []
      if (sameLine.length === 1) candidates = sameLine
    }
    if (!candidates.length) { unmatched++; continue }
    if (candidates.length !== 1) { ambiguous++; continue }
    const row = candidates[0]!
    if (row.fantraxId === ref.fantraxId) { unchanged++; continue }
    if (row.fantraxId || existingSourceIds.has(ref.fantraxId)) { conflicts++; continue }
    proposed.push({ id: row.id, fantraxId: ref.fantraxId, rollingInsightsId: row.rollingInsightsId! })
  }
  const targetCounts = new Map<string, number>()
  const sourceCounts = new Map<string, number>()
  for (const link of proposed) {
    targetCounts.set(link.rollingInsightsId, (targetCounts.get(link.rollingInsightsId) ?? 0) + 1)
    sourceCounts.set(link.fantraxId, (sourceCounts.get(link.fantraxId) ?? 0) + 1)
  }
  const links = proposed.filter(link => targetCounts.get(link.rollingInsightsId) === 1 && sourceCounts.get(link.fantraxId) === 1)
  return { links, unmatched, ambiguous: ambiguous + proposed.length - links.length, unchanged, conflicts, provided: refs.length }
}
