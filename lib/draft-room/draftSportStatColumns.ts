/**
 * DraftRoom sport stat columns — single source of truth for stat keys, labels, and safe reads.
 *
 * Data enters pool rows via **`getResolvedDraftPoolForLeague`** → **`PlayerDisplayModel.stats`**
 * (FPPG, ADP, bye) plus NFL **`nflDraftProjectionSplits`** (Rolling Insights / snapshot projections).
 * Other sports often expose extra metrics on **`display.stats`** as loose numeric fields from analytics.
 *
 * This module does **not** change enrichment; it centralizes column metadata + **`getStatValueForDraftPlayer`**
 * so filters, future table headers, and tests stay aligned.
 */

import type { NflDraftProjectionSplits } from '@/lib/draft/analytics/nfl-draft-pool-projection-splits'
import {
  normalizeToSupportedSport,
  supportsIdpLeagueSport,
  type SupportedSport,
} from '@/lib/sport-scope'

export type DraftStatColumnCategory =
  | 'offense'
  | 'defense'
  | 'pitcher'
  | 'hitter'
  | 'goalie'
  | 'skater'
  | 'soccer'
  | 'general'
  | 'driver'
  | 'golfer'
  | 'wrestler'
  | 'cricket'

export type DraftStatColumnType = 'number' | 'percent' | 'text'

export type DraftStatColumnDef = {
  key: string
  label: string
  type: DraftStatColumnType
  category: DraftStatColumnCategory
  /** Flat keys tried in order on the merged stat bag from **`flattenDraftPlayerStatBag`**. */
  aliases: string[]
}

/** Minimal player shape for stat resolution — matches **`PlayerPanel.PlayerEntry`** / pool rows. */
export type DraftStatPlayerSource = {
  position?: string
  nflDraftProjectionSplits?: NflDraftProjectionSplits | null
  display?: {
    stats?: (Record<string, unknown> & { fantasyPointsPerGame?: number | null }) | null
  } | null
  adp?: number | null
  aiAdp?: number | null
}

const IDP_POSITIONS = new Set(
  [
    'DL',
    'DE',
    'DT',
    'LB',
    'ILB',
    'OLB',
    'EDGE',
    'CB',
    'S',
    'SS',
    'FS',
    'DB',
    'IDP',
    'IDP_FLEX',
    'DST',
    'DEF',
    'D/ST',
  ].map((s) => s.toUpperCase()),
)

const MLB_PITCHER_POS = new Set(
  ['SP', 'RP', 'P', 'STARTING_PITCHER', 'RELIEF_PITCHER'].map((s) => s.toUpperCase()),
)

function normPos(p: string | undefined): string {
  return String(p ?? '')
    .trim()
    .toUpperCase()
}

export function isLikelyIdpFootballPosition(position: string | undefined): boolean {
  return IDP_POSITIONS.has(normPos(position))
}

export function isLikelyPitcherPosition(position: string | undefined): boolean {
  return MLB_PITCHER_POS.has(normPos(position))
}

export function isLikelyGoaliePosition(position: string | undefined): boolean {
  return normPos(position) === 'G'
}

export function isLikelyKickerPosition(position: string | undefined): boolean {
  const p = normPos(position)
  return p === 'PK' || p === 'K' || p === 'K/P' || p === 'KICKER'
}

export function isLikelyPunterPosition(position: string | undefined): boolean {
  return normPos(position) === 'P'
}

function isLikelyReturnSpecialistPosition(position: string | undefined): boolean {
  const p = normPos(position)
  return p === 'KR' || p === 'PR' || p.includes('RET')
}

export function isLikelySoccerGoalkeeperPosition(position: string | undefined): boolean {
  const p = normPos(position)
  return p === 'GK' || p === 'G' || p.includes('GOALKEEPER')
}

export function isLikelySoccerDefenderPosition(position: string | undefined): boolean {
  const p = normPos(position)
  if (new Set(['D', 'CB', 'LB', 'RB', 'WB', 'LWB', 'RWB', 'DEF', 'DEFENDER']).has(p)) return true
  if (p.includes('BACK') && !p.includes('GOAL')) return true
  return false
}

/**
 * Merge NFL splits, typed **`display.stats`**, and any loose numeric keys into one lookup bag.
 */
export function flattenDraftPlayerStatBag(player: DraftStatPlayerSource): Record<string, number | null> {
  const bag: Record<string, number | null> = {}

  const put = (key: string, v: unknown) => {
    if (typeof v === 'number' && Number.isFinite(v)) bag[key] = v
  }

  const splits = player.nflDraftProjectionSplits
  if (splits) {
    put('projectedPoints', splits.projectedPoints)
    put('projectedPointsPerGame', splits.projectedPointsPerGame)
    put('pass_cmp', splits.passing?.cmp)
    put('pass_att', splits.passing?.att)
    put('pass_yds', splits.passing?.yds)
    put('pass_td', splits.passing?.td)
    put('pass_int', splits.passing?.int)
    put('rush_att', splits.rushing?.att)
    put('rush_yds', splits.rushing?.yds)
    put('rush_td', splits.rushing?.td)
    put('rec', splits.receiving?.rec)
    put('rec_tgt', splits.receiving?.tar)
    put('rec_yds', splits.receiving?.yds)
    put('rec_td', splits.receiving?.td)

    /** SleeperPoolTable legacy keys — align with **`NFL_SLEEPER_TABLE_OFFENSE`**. */
    put('pts', splits.projectedPoints)
    put('ru_att', splits.rushing?.att)
    put('ru_yds', splits.rushing?.yds)
    put('ru_td', splits.rushing?.td)
    put('pa_att', splits.passing?.att)
    put('pa_yds', splits.passing?.yds)
    put('pa_td', splits.passing?.td)
    put('pa_int', splits.passing?.int)
  }

  const st = player.display?.stats
  if (st && typeof st === 'object') {
    for (const [k, v] of Object.entries(st)) {
      put(k, v)
    }
  }

  const fppgForAvg =
    typeof st?.fantasyPointsPerGame === 'number' && Number.isFinite(st.fantasyPointsPerGame)
      ? st.fantasyPointsPerGame
      : splits?.projectedPointsPerGame ?? null
  put('avg', typeof fppgForAvg === 'number' && Number.isFinite(fppgForAvg) ? fppgForAvg : null)

  put('adp', player.adp)
  put('aiAdp', player.aiAdp)

  return bag
}

function firstFiniteFromBag(bag: Record<string, number | null>, aliases: string[]): number | null {
  for (const k of aliases) {
    const v = bag[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return null
}

export function getStatValueForDraftPlayer(
  player: DraftStatPlayerSource,
  column: DraftStatColumnDef,
): number | null {
  const bag = flattenDraftPlayerStatBag(player)
  return firstFiniteFromBag(bag, column.aliases)
}

export function formatDraftStatDisplay(value: number | null, column: DraftStatColumnDef): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (column.category === 'hitter' && column.key === 'avg') return value.toFixed(3)
  if (column.key === 'obp') return value.toFixed(3)
  if (column.key === 'avg' && column.category === 'offense') return value.toFixed(1)
  if (column.type === 'percent') return `${(value * 100).toFixed(1)}%`
  if (column.type === 'number') {
    const abs = Math.abs(value)
    if (abs >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 1 })
    if (abs < 10 && !Number.isInteger(value)) return value.toFixed(2)
    return Number.isInteger(value) ? String(value) : value.toFixed(1)
  }
  return String(value)
}

function col(
  key: string,
  label: string,
  type: DraftStatColumnType,
  category: DraftStatColumnCategory,
  aliases: string[],
): DraftStatColumnDef {
  return { key, label, type, category, aliases }
}

const NFL_OFFENSE: DraftStatColumnDef[] = [
  col('pass_td', 'Pass TD', 'number', 'offense', ['pass_td', 'passing_touchdowns', 'passing_td']),
  col('pass_yds', 'Pass Yds', 'number', 'offense', ['pass_yds', 'passing_yards']),
  col('rush_yds', 'Rush Yds', 'number', 'offense', ['rush_yds', 'rushing_yards']),
  col('rush_td', 'Rush TD', 'number', 'offense', ['rush_td', 'rushing_touchdowns']),
  col('rec', 'Rec', 'number', 'offense', ['rec', 'receptions']),
  col('rec_yds', 'Rec Yds', 'number', 'offense', ['rec_yds', 'receiving_yards']),
  col('rec_td', 'Rec TD', 'number', 'offense', ['rec_td', 'receiving_touchdowns']),
  col('proj_pts', 'Proj', 'number', 'offense', ['projectedPoints', 'season_projection', 'fantasy_points']),
]

const NFL_IDP: DraftStatColumnDef[] = [
  col('idp_tkl', 'Tackles', 'number', 'defense', ['tackles', 'combined_tackles', 'total_tackles', 'solo_tackles']),
  col('idp_sack', 'Sacks', 'number', 'defense', ['sacks', 'defense_sacks']),
  col('idp_int', 'INT', 'number', 'defense', ['interceptions', 'def_interceptions', 'pass_def_int']),
  col('idp_ff', 'FF', 'number', 'defense', ['forced_fumbles', 'fumbles_forced']),
  col('idp_td', 'Def TD', 'number', 'defense', ['defensive_touchdowns', 'dst_td']),
  col('idp_proj', 'Proj', 'number', 'defense', ['projectedPoints', 'fantasy_points']),
]

/** Rolling Insights NCAAFB — aliases include documented snake_case from imports. */
const NCAAFB_OFFENSE: DraftStatColumnDef[] = [
  col('pass_td', 'Pass TD', 'number', 'offense', ['pass_td', 'passing_touchdowns', 'passing_td']),
  col('pass_yds', 'Pass Yds', 'number', 'offense', ['pass_yds', 'passing_yards']),
  col('rush_yds', 'Rush Yds', 'number', 'offense', ['rush_yds', 'rushing_yards']),
  col('rush_td', 'Rush TD', 'number', 'offense', ['rush_td', 'rushing_touchdowns']),
  col('rec', 'Rec', 'number', 'offense', ['rec', 'receptions']),
  col('rec_yds', 'Rec Yds', 'number', 'offense', ['rec_yds', 'receiving_yards']),
  col('rec_td', 'Rec TD', 'number', 'offense', ['rec_td', 'receiving_touchdowns']),
  col('proj_pts', 'Proj', 'number', 'offense', ['projectedPoints', 'season_projection', 'fantasy_points']),
]

const NCAAFB_IDP: DraftStatColumnDef[] = [
  col('idp_tkl', 'Tackles', 'number', 'defense', ['tackles', 'combined_tackles', 'total_tackles', 'solo_tackles']),
  col('idp_sack', 'Sacks', 'number', 'defense', ['sacks', 'defense_sacks']),
  col('idp_fr', 'FR', 'number', 'defense', ['fumbles_recoveries', 'fumblesRecoveries', 'fumble_recoveries']),
  col('idp_int', 'INT', 'number', 'defense', ['interceptions', 'def_interceptions', 'passing_interceptions']),
  col('idp_td', 'Def TD', 'number', 'defense', ['defensive_touchdowns', 'dst_td']),
  col('idp_proj', 'Proj', 'number', 'defense', ['projectedPoints', 'fantasy_points']),
]

const NCAAFB_K: DraftStatColumnDef[] = [
  col('fgm', 'FGM', 'number', 'offense', ['fieldGoalsMade', 'field_goals_made', 'fg_made']),
  col('xpm', 'XPM', 'number', 'offense', ['extraPointsMade', 'extra_points_made', 'xp_made']),
  col('fg_long', 'Long', 'number', 'offense', ['fieldGoalsLong', 'field_goals_long']),
  col('ncaaf_k_proj', 'Proj', 'number', 'offense', ['projectedPoints', 'fantasy_points']),
]

const NCAAFB_P: DraftStatColumnDef[] = [
  col('punts', 'Punts', 'number', 'offense', ['punts']),
  col('punt_yds', 'Punt Yds', 'number', 'offense', ['punting_yards', 'puntingYards']),
  col('in20', 'In 20', 'number', 'offense', ['inside_20', 'inside20']),
  col('punt_long', 'Long', 'number', 'offense', ['punts_long', 'puntsLong']),
  col('ncaaf_p_proj', 'Proj', 'number', 'offense', ['projectedPoints', 'fantasy_points']),
]

const NCAAFB_RET: DraftStatColumnDef[] = [
  col('kr_yds', 'KR Yds', 'number', 'offense', ['kick_return_yards', 'kickReturnYards']),
  col('pr_yds', 'PR Yds', 'number', 'offense', ['punt_return_yards', 'puntReturnYards']),
  col('kr_td', 'KR TD', 'number', 'offense', ['kick_return_touchdowns', 'kickReturnTouchdowns']),
  col('pr_td', 'PR TD', 'number', 'offense', ['punt_return_touchdowns', 'puntReturnTouchdowns']),
  col('ncaaf_ret_proj', 'Proj', 'number', 'offense', ['projectedPoints', 'fantasy_points']),
]

/**
 * **`SleeperPoolTable`** NFL / NCAAF — keys match legacy `SleeperPoolSort` (`pts`, `pa_yds`, …)
 * and `flattenDraftPlayerStatBag` aliases.
 */
export const NFL_SLEEPER_TABLE_OFFENSE: DraftStatColumnDef[] = [
  col('pts', 'PTS', 'number', 'offense', ['pts', 'projectedPoints']),
  col('avg', 'AVG', 'number', 'offense', ['avg', 'fantasyPointsPerGame', 'projectedPointsPerGame']),
  col('ru_att', 'RU ATT', 'number', 'offense', ['ru_att', 'rush_att', 'rushing_attempts']),
  col('ru_yds', 'RU YDS', 'number', 'offense', ['ru_yds', 'rush_yds', 'rushing_yards']),
  col('ru_td', 'RU TD', 'number', 'offense', ['ru_td', 'rush_td', 'rushing_touchdowns']),
  col('rec', 'REC', 'number', 'offense', ['rec', 'receptions']),
  col('rec_yds', 'REC YDS', 'number', 'offense', ['rec_yds', 'receiving_yards']),
  col('rec_td', 'REC TD', 'number', 'offense', ['rec_td', 'receiving_touchdowns']),
  col('pa_att', 'PA ATT', 'number', 'offense', ['pa_att', 'pass_att', 'passing_attempts']),
  col('pa_yds', 'PA YDS', 'number', 'offense', ['pa_yds', 'pass_yds', 'passing_yards']),
  col('pa_td', 'PA TD', 'number', 'offense', ['pa_td', 'pass_td', 'passing_touchdowns']),
  col('pa_int', 'PA INT', 'number', 'offense', ['pa_int', 'pass_int', 'passing_interceptions', 'interceptions']),
]

/**
 * Stat columns for **`SleeperPoolTable`**: dense NFL/NCAAF Sleeper splits; other sports use
 * **`getDraftStatColumnsForSport`** (and extension presets for NASCAR/PGA/WWE/CRICKET strings).
 */
export function buildSleeperPoolStatColumnDefs(
  draftSport: string,
  opts?: DraftStatColumnOptions,
): DraftStatColumnDef[] {
  const raw = draftSport.trim().toUpperCase()
  if (['NASCAR', 'PGA', 'WWE', 'CRICKET'].includes(raw)) {
    return getDraftStatColumnsForSport(draftSport, {})
  }
  const sport = normalizeToSupportedSport(draftSport)
  if (sport === 'NCAAF') {
    return getDraftStatColumnsForSport('NCAAF', { position: opts?.position })
  }
  if (sport === 'SOCCER') {
    return getDraftStatColumnsForSport('SOCCER', { position: opts?.position })
  }
  if (sport === 'NFL') {
    const pos = opts?.position
    if (supportsIdpLeagueSport(sport) && isLikelyIdpFootballPosition(pos ?? undefined)) {
      return [...NFL_IDP]
    }
    return [...NFL_SLEEPER_TABLE_OFFENSE]
  }
  return getDraftStatColumnsForSport(draftSport, opts ?? {})
}

export function findSleeperPoolStatDef(
  draftSport: string,
  key: string,
  opts?: DraftStatColumnOptions,
): DraftStatColumnDef | null {
  return buildSleeperPoolStatColumnDefs(draftSport, opts).find((c) => c.key === key) ?? null
}

const NBA_LIKE: DraftStatColumnDef[] = [
  col('pts', 'PTS', 'number', 'offense', ['points', 'pts', 'nba_points']),
  col('reb', 'REB', 'number', 'offense', ['rebounds', 'reb', 'total_rebounds']),
  col('ast', 'AST', 'number', 'offense', ['assists', 'ast']),
  col('stl', 'STL', 'number', 'offense', ['steals', 'stl']),
  col('blk', 'BLK', 'number', 'offense', ['blocks', 'blk']),
  col('fg3m', '3PM', 'number', 'offense', ['threePointersMade', 'fg3m', 'fg3_made', 'threes']),
  col('nba_proj', 'Proj', 'number', 'offense', ['projectedPoints', 'fantasy_points', 'season_projection']),
]

const MLB_HITTER: DraftStatColumnDef[] = [
  col('hr', 'HR', 'number', 'hitter', ['homeRuns', 'hr']),
  col('rbi', 'RBI', 'number', 'hitter', ['rbi', 'runsBattedIn']),
  col('r', 'R', 'number', 'hitter', ['runs', 'r']),
  col('sb', 'SB', 'number', 'hitter', ['stolenBases', 'sb']),
  col('avg', 'AVG', 'number', 'hitter', ['battingAverage', 'avg', 'ba']),
  col('obp', 'OBP', 'number', 'hitter', ['onBasePercentage', 'obp']),
  col('hit_proj', 'Proj', 'number', 'hitter', ['projectedPoints', 'fantasy_points']),
]

const MLB_PITCHER: DraftStatColumnDef[] = [
  col('w', 'W', 'number', 'pitcher', ['wins', 'w']),
  col('so', 'K', 'number', 'pitcher', ['strikeouts', 'pitcher_strikeouts', 'k']),
  col('sv', 'SV', 'number', 'pitcher', ['saves', 'sv']),
  col('era', 'ERA', 'number', 'pitcher', ['era', 'earned_run_average']),
  col('whip', 'WHIP', 'number', 'pitcher', ['whip']),
  col('p_proj', 'Proj', 'number', 'pitcher', ['projectedPoints', 'fantasy_points']),
]

const NHL_SKATER: DraftStatColumnDef[] = [
  col('g', 'G', 'number', 'skater', ['goals', 'g']),
  col('a', 'A', 'number', 'skater', ['assists', 'a']),
  col('sog', 'SOG', 'number', 'skater', ['shots', 'shots_on_goal', 'sog']),
  col('blk_nhl', 'BLK', 'number', 'skater', ['blocks', 'blocked_shots']),
  col('nhl_sk_proj', 'Proj', 'number', 'skater', ['projectedPoints', 'fantasy_points']),
]

const NHL_GOALIE: DraftStatColumnDef[] = [
  col('sv_nhl', 'SV', 'number', 'goalie', ['saves', 'goalie_saves']),
  col('w_nhl', 'W', 'number', 'goalie', ['wins', 'goalie_wins']),
  col('sho', 'SO', 'number', 'goalie', ['shutouts', 'shutout']),
  col('gaa', 'GAA', 'number', 'goalie', ['goalsAgainstAverage', 'gaa']),
  col('svp', 'SV%', 'percent', 'goalie', ['savePercentage', 'sv_pct']),
  col('nhl_g_proj', 'Proj', 'number', 'goalie', ['projectedPoints', 'fantasy_points']),
]

/** Rolling Insights-style keys on `display.stats` after ingestion. */
const SOCCER_FIELDER: DraftStatColumnDef[] = [
  col('soc_g', 'G', 'number', 'soccer', ['goals', 'g']),
  col('soc_a', 'A', 'number', 'soccer', ['assists', 'a']),
  col('soc_sog', 'SoG', 'number', 'soccer', ['shots_on_goal', 'shotsOnGoal']),
  col('soc_sh_att', 'Sh Att', 'number', 'soccer', ['shots_attempted', 'shotsAttempted']),
  col('soc_min', 'Min', 'number', 'soccer', ['minutes_played', 'minutesPlayed']),
  col('soc_yc', 'YC', 'number', 'soccer', ['yellow_cards', 'yellowCards']),
  col('soc_rc', 'RC', 'number', 'soccer', ['red_cards', 'redCards']),
  col('soc_fc', 'Fl Com', 'number', 'soccer', ['fouls_committed', 'foulsCommitted']),
  col('soc_fd', 'Fl Dr', 'number', 'soccer', ['fouls_drawn', 'foulsDrawn']),
  col('soc_fkw', 'FK Won', 'number', 'soccer', ['free_kicks_won', 'freeKicksWon']),
  col('soc_pk_att', 'PK Att', 'number', 'soccer', ['penalty_attempts', 'penaltyAttempts']),
  col('soc_pk_scr', 'PK Scr', 'number', 'soccer', ['penalties_scored', 'penaltiesScored']),
  col('soc_proj', 'Proj', 'number', 'soccer', ['projectedPoints', 'fantasy_points']),
]

const SOCCER_DEFENDER: DraftStatColumnDef[] = [
  col('soc_cs', 'CS', 'number', 'soccer', ['cleanSheets', 'clean_sheets']),
  col('soc_g', 'G', 'number', 'soccer', ['goals', 'g']),
  col('soc_a', 'A', 'number', 'soccer', ['assists', 'a']),
  col('soc_fc', 'Fl Com', 'number', 'soccer', ['fouls_committed', 'foulsCommitted']),
  col('soc_yc', 'YC', 'number', 'soccer', ['yellow_cards', 'yellowCards']),
  col('soc_rc', 'RC', 'number', 'soccer', ['red_cards', 'redCards']),
  col('soc_min', 'Min', 'number', 'soccer', ['minutes_played', 'minutesPlayed']),
  col('soc_proj', 'Proj', 'number', 'soccer', ['projectedPoints', 'fantasy_points']),
]

const SOCCER_GOALKEEPER: DraftStatColumnDef[] = [
  col('soc_sv', 'Saves', 'number', 'soccer', ['saves', 'goalkeeper_saves']),
  col('soc_gc', 'GC', 'number', 'soccer', ['goals_conceded', 'goalsConceded']),
  col('soc_cs', 'CS', 'number', 'soccer', ['cleanSheets', 'clean_sheets']),
  col('soc_psaved', 'PK Saved', 'number', 'soccer', ['penalties_saved', 'penaltiesSaved']),
  col('soc_pface', 'PK Faced', 'number', 'soccer', ['penalties_faced', 'penaltiesFaced']),
  col('soc_min', 'Min', 'number', 'soccer', ['minutes_played', 'minutesPlayed']),
  col('soc_proj', 'Proj', 'number', 'soccer', ['projectedPoints', 'fantasy_points']),
]

/** Extension sports — not Prisma `LeagueSport` today; columns resolve when stats keys exist on pool rows. */
const NASCAR: DraftStatColumnDef[] = [
  col('car_af', 'Avg Fin', 'number', 'driver', ['averageFinish', 'avg_finish']),
  col('car_ll', 'Laps Led', 'number', 'driver', ['lapsLed', 'laps_led']),
  col('car_t5', 'Top 5', 'number', 'driver', ['top5', 'top_5']),
  col('car_t10', 'Top 10', 'number', 'driver', ['top10', 'top_10']),
  col('car_w', 'Wins', 'number', 'driver', ['wins']),
  col('car_proj', 'Proj', 'number', 'driver', ['projectedPoints', 'fantasy_points']),
]

const PGA: DraftStatColumnDef[] = [
  col('pga_sg', 'SG:TOT', 'number', 'golfer', ['strokesGainedTotal', 'strokes_gained']),
  col('pga_cut', 'Cuts', 'number', 'golfer', ['cutsMade', 'cuts_made']),
  col('pga_t10', 'Top 10', 'number', 'golfer', ['top10', 'top_10']),
  col('pga_w', 'Wins', 'number', 'golfer', ['wins']),
  col('pga_af', 'Avg Fin', 'number', 'golfer', ['averageFinish', 'avg_finish']),
  col('pga_proj', 'Proj', 'number', 'golfer', ['projectedPoints', 'fantasy_points']),
]

const WWE: DraftStatColumnDef[] = [
  col('wwe_win', 'Wins', 'number', 'wrestler', ['wins']),
  col('wwe_app', 'Apps', 'number', 'wrestler', ['appearances']),
  col('wwe_title', 'Titles', 'number', 'wrestler', ['titleMatches', 'title_matches']),
  col('wwe_ple', 'PLE', 'number', 'wrestler', ['pleMainEvents', 'ple_main_events']),
  col('wwe_proj', 'Proj', 'number', 'wrestler', ['projectedPoints', 'fantasy_points']),
]

const CRICKET: DraftStatColumnDef[] = [
  col('cr_r', 'Runs', 'number', 'cricket', ['runs', 'batting_runs']),
  col('cr_w', 'Wkts', 'number', 'cricket', ['wickets']),
  col('cr_c', 'Ct', 'number', 'cricket', ['catches']),
  col('cr_sr', 'SR', 'number', 'cricket', ['strikeRate', 'strike_rate']),
  col('cr_eco', 'Eco', 'number', 'cricket', ['economy', 'economy_rate']),
  col('cr_proj', 'Proj', 'number', 'cricket', ['projectedPoints', 'fantasy_points']),
]

export type DraftStatColumnOptions = {
  /** Player position — drives MLB pitcher vs hitter, NHL goalie, NFL/NCAAF IDP vs offense columns. */
  position?: string | null
}

/** Ordered columns for a sport / role. NCAAF mirrors NFL; NCAAB mirrors NBA. */
export function getDraftStatColumnsForSport(
  sportInput: string | null | undefined,
  options?: DraftStatColumnOptions,
): DraftStatColumnDef[] {
  const raw = sportInput?.trim().toUpperCase() ?? ''
  const sport = normalizeToSupportedSport(sportInput)

  const pos = options?.position

  if (raw === 'NASCAR') return [...NASCAR]
  if (raw === 'PGA') return [...PGA]
  if (raw === 'WWE') return [...WWE]
  if (raw === 'CRICKET') return [...CRICKET]

  switch (sport) {
    case 'NFL': {
      if (supportsIdpLeagueSport(sport) && isLikelyIdpFootballPosition(pos ?? undefined)) {
        return [...NFL_IDP]
      }
      return [...NFL_OFFENSE]
    }
    case 'NCAAF': {
      if (isLikelyKickerPosition(pos ?? undefined)) return [...NCAAFB_K]
      if (isLikelyPunterPosition(pos ?? undefined)) return [...NCAAFB_P]
      if (isLikelyReturnSpecialistPosition(pos ?? undefined)) return [...NCAAFB_RET]
      if (supportsIdpLeagueSport(sport) && isLikelyIdpFootballPosition(pos ?? undefined)) {
        return [...NCAAFB_IDP]
      }
      return [...NCAAFB_OFFENSE]
    }
    case 'NBA':
    case 'NCAAB':
      return [...NBA_LIKE]
    case 'MLB':
      return isLikelyPitcherPosition(pos ?? undefined) ? [...MLB_PITCHER] : [...MLB_HITTER]
    case 'NHL':
      return isLikelyGoaliePosition(pos ?? undefined) ? [...NHL_GOALIE] : [...NHL_SKATER]
    case 'SOCCER': {
      if (isLikelySoccerGoalkeeperPosition(pos ?? undefined)) return [...SOCCER_GOALKEEPER]
      if (isLikelySoccerDefenderPosition(pos ?? undefined)) return [...SOCCER_DEFENDER]
      return [...SOCCER_FIELDER]
    }
    default:
      return [
        col('proj_fallback', 'Proj', 'number', 'general', ['projectedPoints', 'fantasy_points', 'projectedPointsPerGame']),
      ]
  }
}

/** Sports whose column sets must never cross (for QA assertions). */
export function sportUsesColumnKeys(sport: SupportedSport): Set<string> {
  return new Set(getDraftStatColumnsForSport(sport).map((c) => c.key))
}

export type StatColumnFilterOp = 'gt' | 'lt' | 'between' | 'eq' | 'exists'

export type StatColumnFilter =
  | { op: 'gt'; value: number }
  | { op: 'lt'; value: number }
  | { op: 'between'; min: number; max: number }
  | { op: 'eq'; value: number }
  | { op: 'exists' }

export function filterDraftPlayersByStat<T extends DraftStatPlayerSource>(
  players: readonly T[],
  column: DraftStatColumnDef,
  filter: StatColumnFilter,
): T[] {
  return players.filter((p) => {
    const v = getStatValueForDraftPlayer(p, column)
    switch (filter.op) {
      case 'exists':
        return v != null && Number.isFinite(v)
      case 'gt':
        return v != null && Number.isFinite(v) && v > filter.value
      case 'lt':
        return v != null && Number.isFinite(v) && v < filter.value
      case 'eq':
        return v != null && Number.isFinite(v) && v === filter.value
      case 'between':
        return v != null && Number.isFinite(v) && v >= filter.min && v <= filter.max
      default:
        return true
    }
  })
}
