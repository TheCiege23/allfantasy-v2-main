import catalog from './seasonRuleArtworkCatalog.json'
import type { SeasonBlueprint } from './seasonBlueprint'
import { defaultSeasonRules } from './seasonRules'
const scoringIds = { standard: 'std', half_ppr: 'half', ppr: 'ppr', nba_points: 'pts' } as const
const counts = (slots: string[]) => slots.reduce<Record<string, number>>((result, pos) => { const key = pos === 'SFLEX' ? 'SUPERFLEX' : pos; result[key] = (result[key] ?? 0) + 1; return result }, {})
const sameCounts = (a: Record<string, number>, b: Record<string, number>) => [...new Set([...Object.keys(a), ...Object.keys(b)])].every(key => (a[key] ?? 0) === (b[key] ?? 0))
export const seasonRosterPresets = catalog.rosters.filter(r => r.slots <= 20 && !r.starters.some(p => ['DL', 'LB', 'DB', 'IDP'].includes(p)))
export function seasonRuleAsset(kind: 'scoring' | 'roster' | 'positions', id: string) {
  const valid = kind === 'scoring' ? catalog.scoring.some(s => s.id === id) : kind === 'roster' ? catalog.rosters.some(r => r.id === id) : Object.values(catalog.positions).some(p => p.image === 'positions/' + id + '.svg')
  return valid ? '/artwork/tournaments/rules/' + kind + '/' + id + '.svg' : null
}
export function seasonRuleLabels(config: SeasonBlueprint) {
  const r = config.rules
  if (!r || r.sport !== config.sport || r.scoringPreset !== config.scoring) return null
  const baseline = defaultSeasonRules(config.sport, config.scoring)
  const expected = new Map(baseline.weights.map(w => [w.statKey, w.points]))
  const actual = new Map(r.weights.map(w => [w.statKey, w.points]))
  const isDefault = actual.size === r.weights.length && [...new Set([...expected.keys(), ...actual.keys()])].every(key => (expected.get(key) ?? 0) === (actual.get(key) ?? 0))
  const scoring = catalog.scoring.find(s => s.id === (isDefault ? scoringIds[config.scoring] : 'custom'))!
  const starters = Object.fromEntries(r.starters.filter(s => s.count > 0).map(s => [s.position, s.count]))
  const validSlots = new Set(r.starters.map(s => s.position)).size === r.starters.length && r.starters.reduce((sum, s) => sum + s.count, 0) + r.bench === config.rosterSize
  const roster = validSlots ? seasonRosterPresets.find(p => p.sport === config.sport && p.bench === r.bench && p.injured === r.ir && p.slots === config.rosterSize && sameCounts(counts(p.starters), starters)) : undefined
  return { scoring, roster, text: scoring.name + ' · ' + (roster?.name ?? 'Custom') + ' roster', starters: r.starters.reduce((sum, s) => sum + s.count, 0), drafted: config.rosterSize, bench: r.bench, ir: r.ir }
}
export function withSeasonRosterPreset(config: SeasonBlueprint, id: string): SeasonBlueprint {
  const preset = seasonRosterPresets.find(p => p.id === id && p.sport === config.sport)
  if (!preset || !config.rules) return config
  return { ...config, rosterSize: preset.slots, rules: { ...config.rules, starters: Object.entries(counts(preset.starters)).map(([position, count]) => ({ position, count })), bench: preset.bench, ir: preset.injured } }
}
export function positionArtwork(position: string) {
  const key = position === 'SUPERFLEX' ? 'SFLEX' : position
  return catalog.positions[key as keyof typeof catalog.positions]
}
