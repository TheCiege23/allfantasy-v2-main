/**
 * Resolve human labels and category ordering for league scoring dashboard rows.
 * Maps template/registry stat keys to commissioner-panel labels where keys differ.
 */
import { NFL_SCORING_CATEGORIES, NFL_PREMIUM_SCORING } from '@/lib/nfl-scoring/NflScoringCategories'
import { NCAAF_ALL_SCORING_CATEGORIES } from '@/lib/ncaaf-scoring/NcaafScoringCategories'
import { NBA_SCORING_CATEGORIES, NBA_PREMIUM_SCORING } from '@/lib/nba-scoring/NbaScoringCategories'
import { NCAAB_SCORING_CATEGORIES, NCAAB_PREMIUM_SCORING } from '@/lib/ncaab-scoring/NcaabScoringCategories'
import { MLB_ALL_SCORING_CATEGORIES } from '@/lib/mlb-scoring/MlbScoringCategories'
import { NHL_ALL_SCORING_CATEGORIES } from '@/lib/nhl-scoring/NhlScoringCategories'
import { SOCCER_SCORING_CATEGORIES } from '@/lib/soccer-scoring/SoccerScoringCategories'

type ScoringStatDisplayMeta = {
  label: string
  categoryOrder: number
  categoryTitle: string
}

type RowLike = { key: string; label: string }
type CatLike = { label: string; rows: RowLike[] }

function flattenCategories(categories: CatLike[]): Map<string, ScoringStatDisplayMeta> {
  const map = new Map<string, ScoringStatDisplayMeta>()
  categories.forEach((cat, categoryOrder) => {
    for (const row of cat.rows) {
      if (!map.has(row.key)) {
        map.set(row.key, {
          label: row.label,
          categoryOrder,
          categoryTitle: cat.label,
        })
      }
    }
  })
  return map
}

const NFL_MAP = flattenCategories([
  ...NFL_SCORING_CATEGORIES,
  NFL_PREMIUM_SCORING,
] as CatLike[])

const NCAAF_MAP = flattenCategories(NCAAF_ALL_SCORING_CATEGORIES as CatLike[])

const NBA_MAP = flattenCategories([
  ...NBA_SCORING_CATEGORIES,
  NBA_PREMIUM_SCORING,
] as CatLike[])

const NCAAB_MAP = flattenCategories([
  ...NCAAB_SCORING_CATEGORIES,
  NCAAB_PREMIUM_SCORING,
] as CatLike[])

const MLB_MAP = flattenCategories(MLB_ALL_SCORING_CATEGORIES as CatLike[])

const NHL_MAP = flattenCategories(NHL_ALL_SCORING_CATEGORIES as CatLike[])

const SOCCER_MAP = flattenCategories(SOCCER_SCORING_CATEGORIES as CatLike[])

/** Registry / template key → key used in commissioner category tables (for label lookup). */
const SCORING_STAT_KEY_ALIASES: Record<string, Record<string, string>> = {
  NFL: {
    interception: 'interception_thrown',
    receptions: 'reception',
    dst_points_allowed_0: 'dst_pa_0',
    dst_points_allowed_1_6: 'dst_pa_1_6',
    dst_points_allowed_7_13: 'dst_pa_7_13',
    dst_points_allowed_14_20: 'dst_pa_14_20',
    dst_points_allowed_21_27: 'dst_pa_21_27',
    dst_points_allowed_28_34: 'dst_pa_28_34',
    dst_points_allowed_35_plus: 'dst_pa_35_plus',
  },
  NCAAF: {
    interception: 'interception_thrown',
    receptions: 'reception',
    dst_points_allowed_0: 'dst_pa_0',
    dst_points_allowed_1_6: 'dst_pa_1_6',
    dst_points_allowed_7_13: 'dst_pa_7_13',
    dst_points_allowed_14_20: 'dst_pa_14_20',
    dst_points_allowed_21_27: 'dst_pa_21_27',
    dst_points_allowed_28_34: 'dst_pa_28_34',
    dst_points_allowed_35_plus: 'dst_pa_35_plus',
  },
  NBA: {
    points: 'points_scored',
    rebounds: 'rebound',
    assists: 'assist',
    steals: 'steal',
    blocks: 'block',
    turnovers: 'turnover',
    three_pointers_made: 'three_point_made',
  },
  NCAAB: {
    points: 'points_scored',
    rebounds: 'rebound',
    assists: 'assist',
    steals: 'steal',
    blocks: 'block',
    turnovers: 'turnover',
    three_pointers_made: 'three_point_made',
  },
  MLB: {
    single: 'singles',
    double: 'doubles',
    triple: 'triples',
    home_run: 'home_runs',
    rbi: 'rbis',
    run: 'runs',
    walk: 'walks',
    stolen_base: 'stolen_bases',
    hit_by_pitch: 'hit_by_pitch',
    strikeout: 'strikeouts',
    innings_pitched: 'innings_pitched',
    earned_runs: 'earned_runs',
    strikeouts_pitched: 'strikeouts_pitched',
    save: 'saves',
    hold: 'holds',
    win: 'wins',
    loss: 'losses',
    quality_start: 'quality_starts',
  },
  NHL: {
    goal: 'goals',
    assist: 'assists',
    shot_on_goal: 'shots_on_goal',
    blocked_shot: 'blocked_shots',
    power_play_point: 'power_play_points',
    short_handed_point: 'short_handed_points',
    save: 'saves',
    goal_allowed: 'goals_against',
    win: 'goalie_wins',
    loss: 'goalie_losses',
    shutout: 'shutouts',
  },
  SOCCER: {},
}

/** @deprecated use SCORING_STAT_KEY_ALIASES */
const KEY_ALIASES = SCORING_STAT_KEY_ALIASES

/**
 * Map a commissioner UI / category row key to the canonical template stat key stored in
 * `LeagueScoringOverride` and `ScoringTemplate.rules`.
 */
export function templateStatKeyFromUiKey(sport: string, uiKey: string): string {
  const u = sport.toUpperCase()
  const aliases = SCORING_STAT_KEY_ALIASES[u] ?? {}
  for (const [templateKey, ui] of Object.entries(aliases)) {
    if (ui === uiKey) return templateKey
  }
  return uiKey
}

/** When no category row exists, still show a clean label. */
const LABEL_OVERRIDES: Record<string, Record<string, string>> = {
  NFL: {
    fg_0_39: 'FG Made (0-39 yards)',
  },
  NCAAF: {
    fg_0_39: 'FG Made (0-39 yards)',
  },
}

function mapForSport(sport: string): Map<string, ScoringStatDisplayMeta> | null {
  const u = sport.toUpperCase()
  switch (u) {
    case 'NFL':
      return NFL_MAP
    case 'NCAAF':
      return NCAAF_MAP
    case 'NBA':
      return NBA_MAP
    case 'NCAAB':
      return NCAAB_MAP
    case 'MLB':
      return MLB_MAP
    case 'NHL':
      return NHL_MAP
    case 'SOCCER':
      return SOCCER_MAP
    default:
      return null
  }
}

function formatStatLabel(statKey: string): string {
  return statKey
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (s) => s.toUpperCase())
}

/**
 * Label + category for dashboard grouping (category order matches commissioner tabs where available).
 */
export function resolveScoringStatDisplay(statKey: string, sport: string): ScoringStatDisplayMeta {
  const u = sport.toUpperCase()
  const map = mapForSport(sport)
  const aliases = KEY_ALIASES[u] ?? {}
  const overrides = LABEL_OVERRIDES[u] ?? {}

  const tryKeys = [statKey, aliases[statKey]].filter(Boolean) as string[]

  if (map) {
    for (const k of tryKeys) {
      const hit = map.get(k)
      if (hit) return hit
    }
  }

  const overrideLabel = overrides[statKey]
  if (overrideLabel) {
    return {
      label: overrideLabel,
      categoryOrder: 999,
      categoryTitle: 'Scoring',
    }
  }

  return {
    label: formatStatLabel(statKey),
    categoryOrder: 999,
    categoryTitle: 'Scoring',
  }
}
