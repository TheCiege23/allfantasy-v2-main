import { resolveNflRosterTemplate } from '@/lib/nfl-roster/NflRosterTemplates'
import { resolveNbaRosterTemplate } from '@/lib/nba-roster/NbaRosterTemplates'
import { resolveNhlRosterTemplate } from '@/lib/nhl-roster/NhlRosterTemplates'
import { resolveMlbRosterTemplate } from '@/lib/mlb-roster/MlbRosterTemplates'
import { resolveRedraftRosterConfig } from './rosterConfigResolver'

/** Use the same AF template that post-create initialization persists. */
export function nativeCreationRoster(sport: string, format: string) {
  if (!['redraft', 'pirate'].includes(format) || !['NFL', 'NBA', 'NHL', 'MLB'].includes(sport)) return null
  const resolve = { NFL: resolveNflRosterTemplate, NBA: resolveNbaRosterTemplate, NHL: resolveNhlRosterTemplate, MLB: resolveMlbRosterTemplate }[sport as 'NFL' | 'NBA' | 'NHL' | 'MLB']
  const slots = resolve('redraft').slots
  const roster = { config: { sections: [{ key: 'primary', label: 'Primary', slots }] } }
  const config = resolveRedraftRosterConfig(sport, { roster })
  const starters = [...config.starterCapacities.values()].reduce((sum, count) => sum + count, 0)
  return { roster, config, rounds: starters + config.benchSlots }
}
