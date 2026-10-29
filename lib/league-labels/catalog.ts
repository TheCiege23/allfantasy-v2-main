/**
 * Scoring and roster label catalogue (design handoff `scoring-roster-labels`).
 *
 * This is the LABEL layer: plate art, names, one-liners and the values each label promises.
 * It is not a second scoring engine. Which live preset stands behind each label is declared in
 * `backing`, and `lib/league-labels/liveValues.ts` reads the real numbers from those presets
 * (`NflScoringPresets`, `NbaScoringPresets`, `NflRosterTemplates`, `NbaRosterTemplates`).
 * `__tests__/league-labels/catalog-consistency.test.ts` compares the two and fails on any
 * difference that is not listed in `KNOWN_VALUE_DIFFERENCES` (valueDifferences.ts).
 *
 * Plate art lives in `public/labels/{scoring,roster,positions}/<id>.svg`.
 */

export type LabelSport = 'NFL' | 'NBA'

export type ScoringLabelId =
  | 'std' | 'half' | 'ppr' | 'te' | 'six' | 'fd' | 'bonus'
  | 'pts' | 'ptsb' | 'cat9' | 'cat8'
  | 'custom'

export type RosterLabelId =
  | 'nfl-std' | 'nfl-sf' | 'nfl-2qb' | 'nfl-3wr' | 'nfl-skill' | 'nfl-idp'
  | 'nba-std' | 'nba-small' | 'nba-deep'

/** One row of a label's value table. `key` is the design key from the handoff's rules.json. */
export type ScoringLabelValue = { key: string; label: string; value: number }

/**
 * The existing preset a label stands for. `null` means no live preset scores this option yet —
 * the label exists (art, copy, design values) but league creation cannot pick it.
 */
export type ScoringBacking =
  | { kind: 'nfl'; presetKey: 'af_default' | 'af_ppr' | 'af_standard'; tePremiumPoints?: number }
  | { kind: 'nba'; presetKey: 'af_default' }
  | { kind: 'nba_category'; categoryPresetId: 'nba_9cat' | 'nba_8cat_standard' }
  | null

export type ScoringLabel = {
  id: ScoringLabelId
  /** Text on the plate (STD, HALF, …). */
  code: string
  /** Which sport(s) can use it. Custom is both. */
  sports: readonly LabelSport[]
  name: string
  oneLine: string
  bestFor: string
  /** Family gradient for the small pill drawn in code: [light, dark]. */
  colors: readonly [string, string]
  type: 'points' | 'categories' | 'custom'
  /** The values the label promises (empty for categories / custom). */
  values: readonly ScoringLabelValue[]
  /** Category list, in display order (category options only). */
  categories: readonly string[]
  /** Plate path under /public. */
  plate: string
  backing: ScoringBacking
}

export type RosterBacking =
  | { kind: 'nfl'; templateKey: 'redraft' | 'superflex' | 'idp' }
  | { kind: 'nba'; templateKey: 'redraft' }
  | null

export type RosterLabel = {
  id: RosterLabelId
  sport: LabelSport
  name: string
  /** Starter slots in display order, design position codes (SFLEX, DST, IDP). */
  starters: readonly string[]
  bench: number
  /** IR (NFL) or IL (NBA) slots. */
  injured: number
  bestFor: string
  /** Roster strip path under /public. */
  strip: string
  backing: RosterBacking
}

const NFL_BASE: readonly ScoringLabelValue[] = [
  { key: 'pass_yd', label: 'Passing yard', value: 0.04 },
  { key: 'pass_td', label: 'Passing TD', value: 4 },
  { key: 'int', label: 'Interception', value: -2 },
  { key: 'rush_yd', label: 'Rushing yard', value: 0.1 },
  { key: 'rush_td', label: 'Rushing TD', value: 6 },
  { key: 'rec', label: 'Reception', value: 0.5 },
  { key: 'rec_yd', label: 'Receiving yard', value: 0.1 },
  { key: 'rec_td', label: 'Receiving TD', value: 6 },
  { key: 'fum_lost', label: 'Fumble lost', value: -2 },
  { key: 'two_pt', label: '2-pt conversion', value: 2 },
]

function nfl(overrides: Record<string, number>, extra: ScoringLabelValue[] = []): ScoringLabelValue[] {
  return [...NFL_BASE.map((v) => (v.key in overrides ? { ...v, value: overrides[v.key]! } : v)), ...extra]
}

const NBA_POINTS: readonly ScoringLabelValue[] = [
  { key: 'pts', label: 'Point', value: 1 },
  { key: 'reb', label: 'Rebound', value: 1.2 },
  { key: 'ast', label: 'Assist', value: 1.5 },
  { key: 'stl', label: 'Steal', value: 3 },
  { key: 'blk', label: 'Block', value: 3 },
  { key: 'to', label: 'Turnover', value: -1 },
  { key: 'three', label: '3-pointer made', value: 0.5 },
]

const CAT9 = ['FG%', 'FT%', '3PM', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO'] as const

const plate = (id: ScoringLabelId) => `/labels/scoring/${id}.svg`
const strip = (id: RosterLabelId) => `/labels/roster/${id}.svg`

export const SCORING_LABELS: readonly ScoringLabel[] = [
  { id: 'std', code: 'STD', sports: ['NFL'], name: 'Standard', oneLine: 'No points for catches', bestFor: 'Classic leagues, run-first value',
    colors: ['#5b6b8c', '#2c3550'], type: 'points', values: nfl({ rec: 0 }), categories: [], plate: plate('std'),
    backing: { kind: 'nfl', presetKey: 'af_standard' } },
  { id: 'half', code: 'HALF', sports: ['NFL'], name: 'Half PPR', oneLine: '0.5 per catch', bestFor: 'The balanced default',
    colors: ['#e8b84a', '#8a5d12'], type: 'points', values: nfl({}), categories: [], plate: plate('half'),
    backing: { kind: 'nfl', presetKey: 'af_default' } },
  { id: 'ppr', code: 'PPR', sports: ['NFL'], name: 'Full PPR', oneLine: '1 per catch', bestFor: 'Pass-catchers rise',
    colors: ['#3d8fe0', '#173e70'], type: 'points', values: nfl({ rec: 1 }), categories: [], plate: plate('ppr'),
    backing: { kind: 'nfl', presetKey: 'af_ppr' } },
  { id: 'te', code: 'TE+', sports: ['NFL'], name: 'TE Premium', oneLine: 'PPR + 0.5 per TE catch', bestFor: 'Makes tight ends matter',
    colors: ['#e89a2c', '#7a4610'], type: 'points',
    values: nfl({ rec: 1 }, [{ key: 'te_rec_bonus', label: 'TE reception bonus', value: 0.5 }]), categories: [], plate: plate('te'),
    // Full PPR plus the create wizard's "TE premium" toggle at 0.5 per TE catch.
    backing: { kind: 'nfl', presetKey: 'af_ppr', tePremiumPoints: 0.5 } },
  { id: 'six', code: '6PT', sports: ['NFL'], name: '6-pt passing TD', oneLine: 'Half PPR, pass TD = 6', bestFor: 'Quarterbacks score like everyone else',
    colors: ['#e0553f', '#6e1f14'], type: 'points', values: nfl({ pass_td: 6 }), categories: [], plate: plate('six'),
    backing: null },
  { id: 'fd', code: '1ST', sports: ['NFL'], name: 'First downs', oneLine: 'Half PPR + 0.5 per first down', bestFor: 'Rewards volume, not just TDs',
    colors: ['#3abf7a', '#14563a'], type: 'points',
    values: nfl({}, [{ key: 'first_down', label: 'Rush/rec first down', value: 0.5 }]), categories: [], plate: plate('fd'),
    backing: null },
  { id: 'bonus', code: 'BONUS', sports: ['NFL'], name: 'Big-play bonus', oneLine: 'Half PPR + yardage bonuses', bestFor: 'Boom weeks pay extra',
    colors: ['#c04fd0', '#4f1a5a'], type: 'points',
    values: nfl({}, [
      { key: 'bonus_100_rush_rec', label: '100+ rush or rec yards', value: 3 },
      { key: 'bonus_300_pass', label: '300+ passing yards', value: 3 },
      { key: 'bonus_40_td', label: '40+ yard TD', value: 2 },
    ]), categories: [], plate: plate('bonus'),
    backing: null },
  { id: 'pts', code: 'PTS', sports: ['NBA'], name: 'Points', oneLine: 'Every stat is worth points', bestFor: 'Simple weekly totals',
    colors: ['#e8743a', '#6e2a0e'], type: 'points', values: NBA_POINTS, categories: [], plate: plate('pts'),
    backing: { kind: 'nba', presetKey: 'af_default' } },
  { id: 'ptsb', code: 'PTS+', sports: ['NBA'], name: 'Points + bonuses', oneLine: 'Points + double-double and triple-double', bestFor: 'Stat-sheet stuffers',
    colors: ['#e8b84a', '#7a4a0e'], type: 'points',
    values: [...NBA_POINTS, { key: 'dd', label: 'Double-double', value: 1.5 }, { key: 'td', label: 'Triple-double', value: 3 }],
    categories: [], plate: plate('ptsb'),
    backing: null },
  { id: 'cat9', code: '9CAT', sports: ['NBA'], name: '9-category', oneLine: 'Win categories, not points', bestFor: 'Balanced builds',
    colors: ['#4fb3d9', '#12475e'], type: 'categories', values: [], categories: CAT9, plate: plate('cat9'),
    backing: { kind: 'nba_category', categoryPresetId: 'nba_9cat' } },
  { id: 'cat8', code: '8CAT', sports: ['NBA'], name: '8-category', oneLine: '9-cat without turnovers', bestFor: 'Lets you play high-usage stars',
    colors: ['#3abf7a', '#14563a'], type: 'categories', values: [], categories: CAT9.filter((c) => c !== 'TO'), plate: plate('cat8'),
    backing: { kind: 'nba_category', categoryPresetId: 'nba_8cat_standard' } },
  { id: 'custom', code: 'CUSTOM', sports: ['NFL', 'NBA'], name: 'Custom', oneLine: 'Commissioner sets every value', bestFor: 'Unique house rules',
    colors: ['#8a8fa8', '#2c3040'], type: 'custom', values: [], categories: [], plate: plate('custom'),
    backing: null },
]

export const ROSTER_LABELS: readonly RosterLabel[] = [
  { id: 'nfl-std', sport: 'NFL', name: 'Standard', starters: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DST'], bench: 7, injured: 1,
    bestFor: 'Most leagues', strip: strip('nfl-std'), backing: { kind: 'nfl', templateKey: 'redraft' } },
  { id: 'nfl-sf', sport: 'NFL', name: 'Superflex', starters: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SFLEX', 'K', 'DST'], bench: 7, injured: 1,
    bestFor: 'Quarterbacks get valuable', strip: strip('nfl-sf'), backing: { kind: 'nfl', templateKey: 'superflex' } },
  { id: 'nfl-2qb', sport: 'NFL', name: '2QB', starters: ['QB', 'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DST'], bench: 7, injured: 1,
    bestFor: 'Deep quarterback strategy', strip: strip('nfl-2qb'), backing: null },
  { id: 'nfl-3wr', sport: 'NFL', name: '3WR', starters: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DST'], bench: 7, injured: 1,
    bestFor: 'Pairs well with PPR', strip: strip('nfl-3wr'), backing: null },
  { id: 'nfl-skill', sport: 'NFL', name: 'Skill only', starters: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'FLEX'], bench: 6, injured: 1,
    bestFor: 'No kickers or defenses', strip: strip('nfl-skill'), backing: null },
  { id: 'nfl-idp', sport: 'NFL', name: 'IDP', starters: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DST', 'DL', 'LB', 'DB', 'IDP'], bench: 8, injured: 1,
    bestFor: 'Defensive players too', strip: strip('nfl-idp'), backing: { kind: 'nfl', templateKey: 'idp' } },
  { id: 'nba-std', sport: 'NBA', name: 'Standard', starters: ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL', 'UTIL', 'UTIL'], bench: 3, injured: 1,
    bestFor: 'Most leagues', strip: strip('nba-std'), backing: { kind: 'nba', templateKey: 'redraft' } },
  { id: 'nba-small', sport: 'NBA', name: 'Lean', starters: ['PG', 'SG', 'SF', 'PF', 'C', 'UTIL', 'UTIL'], bench: 3, injured: 1,
    bestFor: 'Fast drafts, bigger stars', strip: strip('nba-small'), backing: null },
  { id: 'nba-deep', sport: 'NBA', name: 'Deep', starters: ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL', 'UTIL', 'UTIL'], bench: 6, injured: 2,
    bestFor: 'Bench depth matters', strip: strip('nba-deep'), backing: null },
]

/** Position chip colours from the handoff (`rules.json` positions). */
export const POSITION_COLORS: Readonly<Record<string, { fill: string; text: string }>> = {
  QB: { fill: '#e0553f', text: '#fff' }, RB: { fill: '#3abf7a', text: '#06200f' }, WR: { fill: '#3d8fe0', text: '#fff' },
  TE: { fill: '#e89a2c', text: '#1a1004' }, FLEX: { fill: '#8a8fa8', text: '#0b0d14' }, SFLEX: { fill: '#c04fd0', text: '#fff' },
  K: { fill: '#b48cf0', text: '#1a0d33' }, DST: { fill: '#8a6a4a', text: '#fff' }, DL: { fill: '#2fb5a5', text: '#04201d' },
  LB: { fill: '#1f8f86', text: '#fff' }, DB: { fill: '#5fd0e0', text: '#05242a' }, IDP: { fill: '#4a7f7a', text: '#fff' },
  PG: { fill: '#3d8fe0', text: '#fff' }, SG: { fill: '#4fb3d9', text: '#05242a' }, SF: { fill: '#3abf7a', text: '#06200f' },
  PF: { fill: '#e89a2c', text: '#1a1004' }, C: { fill: '#e0553f', text: '#fff' }, G: { fill: '#7aa6ec', text: '#0b1830' },
  F: { fill: '#7fd09c', text: '#06200f' }, UTIL: { fill: '#8a8fa8', text: '#0b0d14' }, BN: { fill: '#1d2130', text: '#a3a9c2' },
  IR: { fill: '#2a1418', text: '#ff9a8a' }, IL: { fill: '#2a1418', text: '#ff9a8a' },
}

/** Defaults per sport from the handoff: NFL Half PPR + Standard, NBA Points + Standard. */
export const LABEL_DEFAULTS: Readonly<Record<LabelSport, { scoring: ScoringLabelId; roster: RosterLabelId }>> = {
  NFL: { scoring: 'half', roster: 'nfl-std' },
  NBA: { scoring: 'pts', roster: 'nba-std' },
}

/** Custom starts from Half PPR (NFL) or Points (NBA). */
export function customScoringStartingPoint(sport: LabelSport): ScoringLabelId {
  return sport === 'NBA' ? 'pts' : 'half'
}

export function getScoringLabel(id: string | null | undefined): ScoringLabel | null {
  return SCORING_LABELS.find((s) => s.id === id) ?? null
}

export function getRosterLabel(id: string | null | undefined): RosterLabel | null {
  return ROSTER_LABELS.find((r) => r.id === id) ?? null
}

export function scoringLabelsForSport(sport: LabelSport): ScoringLabel[] {
  return SCORING_LABELS.filter((s) => s.sports.includes(sport))
}

export function rosterLabelsForSport(sport: LabelSport): RosterLabel[] {
  return ROSTER_LABELS.filter((r) => r.sport === sport)
}

/** "Half PPR · Standard roster" — the plain-text label from the handoff. */
export function plainRulesLabel(scoringId: string | null | undefined, rosterId: string | null | undefined): string {
  const scoring = getScoringLabel(scoringId)?.name ?? 'Custom'
  const roster = getRosterLabel(rosterId)?.name ?? 'Custom'
  return `${scoring} · ${roster} roster`
}

export function positionPath(position: string): string {
  return `/labels/positions/${position.toLowerCase()}.svg`
}
