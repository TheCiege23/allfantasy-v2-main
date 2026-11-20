import type { CategoryMatchupResult } from './types'

const SOURCE_CATEGORIES: Record<string, string> = {
  INDIVIDUAL_ASSISTS: 'nba_ast', INDIVIDUAL_BLOCKS: 'nba_blk', INDIVIDUAL_DOUBLE_DOUBLES: 'nba_dd_only',
  INDIVIDUAL_FIELD_GOALS_MADE: 'nba_fgm', INDIVIDUAL_FREE_THROWS_MADE: 'nba_ftm', INDIVIDUAL_POINTS: 'nba_pts',
  INDIVIDUAL_REBOUNDS: 'nba_reb', INDIVIDUAL_STEALS: 'nba_stl', INDIVIDUAL_THREE_POINTERS_MADE: 'nba_3pm',
  INDIVIDUAL_TURNOVERS: 'nba_to', INDIVIDUAL_FIELD_GOAL_PERCENTAGE: 'nba_fg_pct',
  INDIVIDUAL_FREE_THROW_PERCENTAGE: 'nba_ft_pct', INDIVIDUAL_THREE_POINT_PERCENTAGE: 'nba_3p_pct',
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function importedFantraxNbaCategories(raw: unknown) {
  const source = record(raw)
  const system = record(source.scoringSystem)
  if (system.type !== 'HEAD_TO_HEAD_ROTI_SINGLE_WIN') return null
  const groups = system.scoringCategorySettings
  const ids: string[] = []
  const named = new Map<string, string>()
  for (const group of Array.isArray(groups) ? groups : []) {
    if (!Array.isArray(group.configs) || group.group?.code !== 'BASKETBALL_PLAYER') throw Error('Unrecognized Fantrax basketball category group.')
    for (const config of group.configs) {
      const id = SOURCE_CATEGORIES[config.scoringCategory?.code]
      if (!id || ids.includes(id) || (config.position?.code && config.position.code !== 'DEFAULT')) throw Error('A source basketball category requires commissioner review.')
      ids.push(id)
      named.set(String(config.scoringCategory.name).toLowerCase(), id)
    }
  }
  if (!ids.length) throw Error('Missing source basketball scoring categories.')
  const tieIds: string[] = []
  const rules = record(source.publicRules).matchupTies
  for (const rule of Array.isArray(rules) ? rules : []) {
    const category = /^Ahead in specific scoring category\s*-\s*(.+)$/i.exec(String(rule))?.[1]?.trim().toLowerCase()
    if (!category || !named.has(category)) break
    tieIds.push(named.get(category)!)
  }
  return { scoring_mode: 'h2h_category', category_record_mode: 'most', category_preset_id: 'nba_9cat', category_ids: ids,
    fantrax_category_scoring: { tiesWorthHalf: true, tieIds } }
}

export function fantraxNbaCategoryOutcome(result: CategoryMatchupResult, policy: unknown, regular: boolean) {
  const rules = record(policy)
  const credit = rules.tiesWorthHalf === true ? result.ties / 2 : 0
  let tiebreak: 'a' | 'b' | null = null
  if (regular && result.aWins === result.bWins && Array.isArray(rules.tieIds)) {
    for (const id of rules.tieIds) {
      const category = result.categories.find(c => c.categoryId === id)
      if (!category) break
      if (category.winner !== 'tie') { tiebreak = category.winner; break }
    }
  }
  return { homeScore: result.aWins + credit, awayScore: result.bWins + credit, tiebreak }
}
