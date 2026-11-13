/**
 * Per-sport wording and grouping for the League Settings hub. Pure: no prisma, no fetch.
 *
 * The hub's DATA is already sport-neutral (members, standings, settings values, slot definitions
 * from the per-sport roster engine). What was football-only is everything layered on top of it —
 * how scoring rules are grouped into tabs, what a stat key is called, the legend's matchup example,
 * when stat corrections settle, and the fallback slot names used when a slot has no definition.
 * Those live here, keyed on the league's sport, so a basketball league never reads "Passing" and an
 * NBA small forward (`SF`) is never painted as an NFL superflex.
 *
 * Stat labels and key lists come from each sport's own scoring presets — the same tables the
 * scoring editors use — rather than a second copy here.
 */

import { MLB_HITTING_STAT_KEYS, MLB_PITCHING_STAT_KEYS, MLB_STAT_LABELS } from '@/lib/mlb-scoring/MlbScoringPresets'
import { NBA_STAT_LABELS } from '@/lib/nba-scoring/NbaScoringPresets'
import { NCAAB_STAT_LABELS } from '@/lib/ncaab-scoring/NcaabScoringPresets'
import { NCAAF_STAT_LABELS } from '@/lib/ncaaf-scoring/NcaafScoringPresets'
import { NFL_STAT_LABELS } from '@/lib/nfl-scoring/NflScoringPresets'
import { NHL_GOALIE_STAT_KEYS, NHL_SKATER_STAT_KEYS, NHL_STAT_LABELS } from '@/lib/nhl-scoring/NhlScoringPresets'
import {
  SOCCER_ATTACKING_KEYS,
  SOCCER_DEFENDING_KEYS,
  SOCCER_DISCIPLINE_KEYS,
  SOCCER_GENERAL_KEYS,
  SOCCER_GOALKEEPING_KEYS,
  SOCCER_STAT_LABELS,
} from '@/lib/soccer-scoring/SoccerScoringPresets'
import { SCORING_STAT_LABELS } from '@/lib/commissioner-settings/scoringStatLabels'

export type HubSport = 'NFL' | 'NCAAF' | 'NBA' | 'NCAAB' | 'MLB' | 'NHL' | 'SOCCER'
export type SportFamily = 'football' | 'basketball' | 'baseball' | 'hockey' | 'soccer'

const SPORT_ALIASES: Record<string, HubSport> = {
  NFL: 'NFL', FOOTBALL: 'NFL',
  NCAAF: 'NCAAF', NCAAFB: 'NCAAF', CFB: 'NCAAF', COLLEGE_FOOTBALL: 'NCAAF',
  NBA: 'NBA', BASKETBALL: 'NBA',
  NCAAB: 'NCAAB', NCAABB: 'NCAAB', NCAAM: 'NCAAB', CBB: 'NCAAB', COLLEGE_BASKETBALL: 'NCAAB',
  MLB: 'MLB', BASEBALL: 'MLB',
  NHL: 'NHL', HOCKEY: 'NHL',
  SOCCER: 'SOCCER', EPL: 'SOCCER', MLS: 'SOCCER', FUTBOL: 'SOCCER', WORLD_CUP: 'SOCCER', WORLDCUP: 'SOCCER',
}

/** The league's sport, or null when it is missing or not one we tailor (callers then use football). */
export function resolveHubSport(raw: string | null | undefined): HubSport | null {
  const k = String(raw ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_')
  return SPORT_ALIASES[k] ?? null
}

export function sportFamily(sport: HubSport | null): SportFamily {
  if (sport === 'NBA' || sport === 'NCAAB') return 'basketball'
  if (sport === 'MLB') return 'baseball'
  if (sport === 'NHL') return 'hockey'
  if (sport === 'SOCCER') return 'soccer'
  return 'football'
}

const SPORT_NAMES: Record<HubSport, string> = {
  NFL: 'NFL', NCAAF: 'College Football', NBA: 'NBA', NCAAB: 'College Basketball', MLB: 'MLB', NHL: 'NHL', SOCCER: 'Soccer',
}

/** "College Basketball" rather than "NCAAB"; an unknown value is shown as stored. */
export function sportDisplayName(raw: string | null | undefined): string | null {
  const s = resolveHubSport(raw)
  if (s) return SPORT_NAMES[s]
  const t = String(raw ?? '').trim()
  return t || null
}

/* -------------------------------------------------------------- scoring */

export type ScoringCategoryDef = { key: string; label: string; test: (k: string) => boolean }

const inSet = (keys: readonly string[]) => {
  const set = new Set(keys)
  return (k: string) => set.has(k)
}
const isBonus = (k: string) => /^bonus/.test(k) || /_bonus/.test(k)

const FOOTBALL_CATEGORIES: ScoringCategoryDef[] = [
  // Both vocabularies: provider keys (pass_td, rec_yd) and AF's canonical keys (passing_td, receiving_yards).
  { key: 'passing', label: 'Passing', test: (k) => /^pass/.test(k) || ['int', 'qb_sack', 'qb_sacked', 'interception', 'interception_thrown', 'pick_6_thrown', 'completion', 'incomplete_pass'].includes(k) },
  { key: 'rushing', label: 'Rushing', test: (k) => /^rush/.test(k) || ['fum', 'fum_lost', 'fumble', 'fumble_lost'].includes(k) },
  { key: 'receiving', label: 'Receiving', test: (k) => /^rec/.test(k) || /_rec$/.test(k) || ['te_premium', 'target'].includes(k) },
  { key: 'kicking', label: 'Kicking', test: (k) => /^(fg|xp|pat|kick)/.test(k) },
  { key: 'defense', label: 'Team Defense', test: (k) => /^(def|pts_allow|yds_allow|dst|blk)/.test(k) || k === 'sack' || k === 'safe' || k === 'ff' || k === 'fum_rec' },
  { key: 'special', label: 'Special Teams', test: (k) => /^(st_|kr_|pr_)/.test(k) },
  { key: 'idp', label: 'IDP', test: (k) => /^idp/.test(k) },
  { key: 'bonus', label: 'Bonus', test: isBonus },
]

// Bonus is tested FIRST for the other sports: "forty_plus_points_bonus" and
// "twenty_plus_rebounds_bonus" would otherwise land in Scoring and Rebounds.
const BASKETBALL_CATEGORIES: ScoringCategoryDef[] = [
  { key: 'scoring', label: 'Scoring', test: (k) => /^(points|pts|field_goals|two_point|three_point|free_throws|fg|ft|tp|3p)/.test(k) },
  { key: 'rebounds', label: 'Rebounds', test: (k) => /reb/.test(k) },
  { key: 'playmaking', label: 'Playmaking', test: (k) => /^(assist|ast)/.test(k) || k === 'turnover' || k === 'to' },
  { key: 'defense', label: 'Defense', test: (k) => /^(steal|stl|block|blk)/.test(k) },
  { key: 'discipline', label: 'Fouls', test: (k) => /foul/.test(k) || k === 'pf' || k === 'tf' || k === 'ff' },
  { key: 'bonus', label: 'Bonuses', test: (k) => isBonus(k) || ['double_double', 'triple_double', 'dd', 'td'].includes(k) },
  { key: 'general', label: 'General', test: (k) => /^(minutes|seconds|min|plus_minus|gp)/.test(k) },
]

const BASEBALL_CATEGORIES: ScoringCategoryDef[] = [
  { key: 'hitting', label: 'Hitting', test: inSet(MLB_HITTING_STAT_KEYS) },
  { key: 'pitching', label: 'Pitching', test: (k) => inSet(MLB_PITCHING_STAT_KEYS)(k) || /^(pitch|p_)/.test(k) },
  { key: 'bonus', label: 'Bonuses', test: isBonus },
]

const HOCKEY_CATEGORIES: ScoringCategoryDef[] = [
  { key: 'skaters', label: 'Skaters', test: inSet(NHL_SKATER_STAT_KEYS) },
  { key: 'goalies', label: 'Goalies', test: (k) => inSet(NHL_GOALIE_STAT_KEYS)(k) || /^goalie/.test(k) },
  { key: 'bonus', label: 'Bonuses', test: isBonus },
]

const SOCCER_CATEGORIES: ScoringCategoryDef[] = [
  { key: 'attacking', label: 'Attacking', test: inSet(SOCCER_ATTACKING_KEYS) },
  { key: 'defending', label: 'Defending', test: inSet(SOCCER_DEFENDING_KEYS) },
  { key: 'goalkeeping', label: 'Goalkeeping', test: (k) => inSet(SOCCER_GOALKEEPING_KEYS)(k) || /^gk_/.test(k) },
  { key: 'discipline', label: 'Discipline', test: inSet(SOCCER_DISCIPLINE_KEYS) },
  { key: 'general', label: 'General', test: (k) => inSet(SOCCER_GENERAL_KEYS)(k) || /rating/.test(k) },
  { key: 'bonus', label: 'Bonuses', test: isBonus },
]

const CATEGORIES: Record<SportFamily, ScoringCategoryDef[]> = {
  football: FOOTBALL_CATEGORIES,
  basketball: BASKETBALL_CATEGORIES,
  baseball: BASEBALL_CATEGORIES,
  hockey: HOCKEY_CATEGORIES,
  soccer: SOCCER_CATEGORIES,
}

/** Display order of a sport's scoring tabs. */
export function scoringCategories(sport: HubSport | null): ScoringCategoryDef[] {
  return CATEGORIES[sportFamily(sport)]
}

/** Which tab a stat key belongs to, or null for "Other". */
export function scoringCategoryFor(sport: HubSport | null, key: string): ScoringCategoryDef | null {
  const cats = scoringCategories(sport)
  if (sportFamily(sport) !== 'football') {
    const bonus = cats.find((c) => c.key === 'bonus')
    if (bonus?.test(key)) return bonus
  }
  return cats.find((c) => c.test(key)) ?? null
}

/** Sleeper's basketball keys, which imported NBA leagues carry. */
const BASKETBALL_PROVIDER_LABELS: Record<string, string> = {
  pts: 'Points', reb: 'Rebounds', ast: 'Assists', stl: 'Steals', blk: 'Blocks', to: 'Turnovers',
  tpm: '3-Pointers Made', fgm: 'Field Goals Made', fga: 'Field Goals Attempted', ftm: 'Free Throws Made',
  fta: 'Free Throws Attempted', dd: 'Double-Double', td: 'Triple-Double', tf: 'Technical Foul', ff: 'Flagrant Foul',
  pf: 'Personal Foul', bonus_pt_40p: '40+ Points Bonus', bonus_pt_50p: '50+ Points Bonus',
  bonus_ast_15p: '15+ Assists Bonus', bonus_reb_20p: '20+ Rebounds Bonus',
}

const LABELS: Record<HubSport, Array<Record<string, string>>> = {
  NFL: [NFL_STAT_LABELS, SCORING_STAT_LABELS],
  NCAAF: [NCAAF_STAT_LABELS, NFL_STAT_LABELS, SCORING_STAT_LABELS],
  NBA: [NBA_STAT_LABELS, BASKETBALL_PROVIDER_LABELS],
  NCAAB: [NCAAB_STAT_LABELS, NBA_STAT_LABELS, BASKETBALL_PROVIDER_LABELS],
  MLB: [MLB_STAT_LABELS],
  NHL: [NHL_STAT_LABELS],
  SOCCER: [SOCCER_STAT_LABELS],
}

/**
 * A stat key's name in this sport, or null. Football's tables are never consulted for another
 * sport: `blk` is a blocked kick in one and a block in the other.
 */
export function statLabel(sport: HubSport | null, key: string): string | null {
  for (const table of LABELS[sport ?? 'NFL']) {
    const v = table[key]
    if (v) return v
  }
  return null
}

/* --------------------------------------------------------------- roster */

/** Fallback names for a slot the roster engine sent no definition for. Football's table lives in hubModel. */
export const SPORT_SLOT_NAMES: Record<Exclude<SportFamily, 'football'>, Record<string, string>> = {
  basketball: {
    PG: 'Point Guard', SG: 'Shooting Guard', SF: 'Small Forward', PF: 'Power Forward', C: 'Center',
    G: 'Guard', F: 'Forward', UTIL: 'Utility', BN: 'Bench', IL: 'Injured List', IR: 'Injured Reserve',
  },
  baseball: {
    C: 'Catcher', '1B': 'First Base', '2B': 'Second Base', '3B': 'Third Base', SS: 'Shortstop', OF: 'Outfielder',
    CI: 'Corner Infielder', MI: 'Middle Infielder', UTIL: 'Utility', DH: 'Designated Hitter',
    SP: 'Starting Pitcher', RP: 'Relief Pitcher', P: 'Pitcher', BN: 'Bench', IL: 'Injured List', NA: 'Not Active',
  },
  hockey: {
    C: 'Center', LW: 'Left Wing', RW: 'Right Wing', W: 'Winger', D: 'Defenseman', G: 'Goalie',
    UTIL: 'Utility', BN: 'Bench', IR: 'Injured Reserve',
  },
  soccer: {
    GK: 'Goalkeeper', DEF: 'Defender', MID: 'Midfielder', FWD: 'Forward', FLEX: 'Flex', UTIL: 'Utility',
    BN: 'Bench', IR: 'Injured',
  },
}

/* ----------------------------------------------------- record-book copy */

export type MatchupLegendRow = { tag: string; name: 'Easy' | 'Neutral' | 'Tough'; d: string }
export type InjuredTag = { tag: string; name: string; d: string }

export type SportCopy = {
  /** Heading over the matchup legend. */
  matchupTitle: string
  matchup: MatchupLegendRow[]
  /** The injured-slot status: IR in football and hockey, IL in baseball and basketball. */
  injured: InjuredTag
  /** When a week's stat corrections settle. */
  correctionTiming: string
  /** Lineup-reminder timing, for the notification row. */
  lineupReminder: string
}

const matchup = (easy: string, neutral: string, tough: string, what: string): MatchupLegendRow[] => [
  { tag: easy, name: 'Easy', d: `A weak ${what}. Your player is more likely to beat their projection.` },
  { tag: neutral, name: 'Neutral', d: `An average ${what}. Expect close to the projection.` },
  { tag: tough, name: 'Tough', d: `A strong ${what}. Your player is more likely to fall short.` },
]

const DAILY_TIMING = 'Games are played most days, so corrections usually land within a day or two of each game. A week’s result is final a couple of days after its last game.'
const IR: InjuredTag = { tag: 'IR', name: 'Injured Reserve', d: 'Eligible for an IR spot' }
const IL: InjuredTag = { tag: 'IL', name: 'Injured List', d: 'Eligible for an IL spot' }

const COPY: Record<HubSport, SportCopy> = {
  NFL: {
    matchupTitle: 'Defense matchup', matchup: matchup('vs DAL', '@ CLE', 'vs BAL', 'defense'), injured: IR,
    correctionTiming: 'Corrections can land through Thursday — most arrive Monday or Tuesday — so a weekly result isn’t final until then.',
    lineupReminder: 'Before kickoff if a starter slot is empty',
  },
  NCAAF: {
    matchupTitle: 'Defense matchup', matchup: matchup('vs KENT', '@ IOWA', 'vs UGA', 'defense'), injured: IR,
    correctionTiming: 'Corrections land in the days after each game, so a weekly result isn’t final until midweek.',
    lineupReminder: 'Before kickoff if a starter slot is empty',
  },
  NBA: {
    matchupTitle: 'Opponent matchup', matchup: matchup('vs WAS', '@ CHI', 'vs OKC', 'defense'), injured: IL,
    correctionTiming: DAILY_TIMING, lineupReminder: 'Before tip-off if a starter slot is empty',
  },
  NCAAB: {
    matchupTitle: 'Opponent matchup', matchup: matchup('vs MVSU', '@ IU', 'vs HOU', 'defense'), injured: IL,
    correctionTiming: DAILY_TIMING, lineupReminder: 'Before tip-off if a starter slot is empty',
  },
  MLB: {
    matchupTitle: 'Opponent matchup', matchup: matchup('vs COL', '@ CHC', 'vs SEA', 'pitching staff'), injured: IL,
    correctionTiming: `${DAILY_TIMING} Scoring changes from the official scorer can arrive a few days later.`,
    lineupReminder: 'Before first pitch if a starter slot is empty',
  },
  NHL: {
    matchupTitle: 'Opponent matchup', matchup: matchup('vs SJ', '@ NYR', 'vs FLA', 'defense'), injured: IR,
    correctionTiming: DAILY_TIMING, lineupReminder: 'Before puck drop if a starter slot is empty',
  },
  SOCCER: {
    matchupTitle: 'Opponent matchup', matchup: matchup('vs SOU', '@ BHA', 'vs ARS', 'defense'),
    injured: { tag: 'IR', name: 'Injured', d: 'Eligible for an injured spot' },
    correctionTiming: 'Corrections usually land within a day or two of each match, so a matchweek’s result is final a couple of days after its last match.',
    lineupReminder: 'Before kickoff if a starter slot is empty',
  },
}

/** Record Book and notification copy for this league's sport (football when unknown). */
export function sportCopy(raw: string | null | undefined): SportCopy {
  return COPY[resolveHubSport(raw) ?? 'NFL']
}
