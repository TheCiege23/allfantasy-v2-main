/**
 * Standard NBA category presets for H2H-category / roto leagues.
 *
 * Two presets mirror the industry norm (Yahoo / ESPN / Fantrax defaults):
 *   - standard 8-cat: drops turnovers (legacy persisted nba_8cat drops 3PM)
 *   - 9-cat: includes turnovers and 3PM
 *
 * Stat keys (`points_scored`, `rebound`, …) match the keys in
 * the short native weekly keys and provider aggregates used by the scoring
 * engine, so the same ingested stats power both modes without schema
 * changes.
 */

import type { CategoryDefinition } from './types'

export const NBA_CATEGORY_POINTS: CategoryDefinition = {
  id: 'nba_pts',
  label: 'PTS',
  description: 'Points scored',
  direction: 'higher',
  computation: { kind: 'sum', statKey: 'points_scored' },
}

export const NBA_CATEGORY_REBOUNDS: CategoryDefinition = {
  id: 'nba_reb',
  label: 'REB',
  description: 'Total rebounds',
  direction: 'higher',
  computation: { kind: 'sum', statKey: 'rebound' },
}

export const NBA_CATEGORY_ASSISTS: CategoryDefinition = {
  id: 'nba_ast',
  label: 'AST',
  direction: 'higher',
  computation: { kind: 'sum', statKey: 'assist' },
}

export const NBA_CATEGORY_STEALS: CategoryDefinition = {
  id: 'nba_stl',
  label: 'STL',
  direction: 'higher',
  computation: { kind: 'sum', statKey: 'steal' },
}

export const NBA_CATEGORY_BLOCKS: CategoryDefinition = {
  id: 'nba_blk',
  label: 'BLK',
  direction: 'higher',
  computation: { kind: 'sum', statKey: 'block' },
}

export const NBA_CATEGORY_TURNOVERS: CategoryDefinition = {
  id: 'nba_to',
  label: 'TO',
  description: 'Turnovers — lower is better.',
  direction: 'lower',
  computation: { kind: 'sum', statKey: 'turnover' },
}

export const NBA_CATEGORY_FG_PCT: CategoryDefinition = {
  id: 'nba_fg_pct',
  label: 'FG%',
  description: 'Field-goal percentage (made / attempted, team totals).',
  direction: 'higher',
  computation: {
    kind: 'ratio',
    numeratorStatKey: 'field_goals_made',
    denominatorStatKey: 'field_goals_attempted',
  },
}

export const NBA_CATEGORY_FT_PCT: CategoryDefinition = {
  id: 'nba_ft_pct',
  label: 'FT%',
  description: 'Free-throw percentage (made / attempted, team totals).',
  direction: 'higher',
  computation: {
    kind: 'ratio',
    numeratorStatKey: 'free_throws_made',
    denominatorStatKey: 'free_throws_attempted',
  },
}

export const NBA_CATEGORY_THREES_MADE: CategoryDefinition = {
  id: 'nba_3pm',
  label: '3PM',
  description: 'Three-pointers made.',
  direction: 'higher',
  computation: { kind: 'sum', statKey: 'three_point_made' },
}

/** Original persisted 8-category definition; retained for existing leagues. */
export const NBA_LEGACY_EIGHT_CAT: readonly CategoryDefinition[] = Object.freeze([
  NBA_CATEGORY_POINTS,
  NBA_CATEGORY_REBOUNDS,
  NBA_CATEGORY_ASSISTS,
  NBA_CATEGORY_STEALS,
  NBA_CATEGORY_BLOCKS,
  NBA_CATEGORY_TURNOVERS,
  NBA_CATEGORY_FG_PCT,
  NBA_CATEGORY_FT_PCT,
])

/** 9-category standard (adds 3PM). */
export const NBA_NINE_CAT: readonly CategoryDefinition[] = Object.freeze([
  NBA_CATEGORY_POINTS,
  NBA_CATEGORY_REBOUNDS,
  NBA_CATEGORY_ASSISTS,
  NBA_CATEGORY_STEALS,
  NBA_CATEGORY_BLOCKS,
  NBA_CATEGORY_TURNOVERS,
  NBA_CATEGORY_FG_PCT,
  NBA_CATEGORY_FT_PCT,
  NBA_CATEGORY_THREES_MADE,
])

export const NBA_EIGHT_CAT: readonly CategoryDefinition[] = Object.freeze(NBA_NINE_CAT.filter(category => category.id !== 'nba_to'))

export type NbaCategoryPresetId = 'nba_8cat' | 'nba_8cat_standard' | 'nba_9cat'

export function getNbaCategoryPreset(preset: NbaCategoryPresetId): readonly CategoryDefinition[] {
  return preset === 'nba_9cat' ? NBA_NINE_CAT : NBA_EIGHT_CAT
}
