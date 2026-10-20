/**
 * Custom scoring (handoff `scoring-roster-labels`): "Custom starts from Half PPR (NFL) or Points
 * (NBA), and the commissioner can edit any value. Its label always reads CUSTOM."
 *
 * The editable rows are exactly the starting label's value table, so the editor and the value table
 * show the same stats. A saved choice carries `overrides` — only the values that differ from the
 * starting point — and `customLiveRules` turns them into the live rule map the league scoring
 * writers store (`saveLeagueNflScoringConfig` / `saveLeagueNbaScoringConfig`), starting from the
 * same preset that backs the starting label so every stat the editor does not show (K, DST, IDP,
 * NBA extras) keeps its AF standard value.
 *
 * Pure — safe on the client; the server runs the same `parseCustomOverrides`.
 */
import { customScoringStartingPoint, getScoringLabel, type LabelSport } from './catalog'
import { NBA_DESIGN_TO_LIVE_KEYS, NFL_DESIGN_TO_LIVE_KEYS, liveRulesForScoringLabel } from './liveValues'

export type CustomOverrides = Record<string, number>

export type CustomScoringField = {
  key: string
  label: string
  /** The starting point's value (Half PPR or Points). */
  seed: number
  min: number
  max: number
  step: number
}

/** Values accept at most two decimals (0.04 per passing yard is the finest the presets use). */
export const CUSTOM_SCORING_STEP = 0.01

/** Sane bounds per stat. Gains cannot go negative and penalties cannot go positive. */
const RANGES: Readonly<Record<LabelSport, Readonly<Record<string, readonly [number, number]>>>> = {
  NFL: {
    pass_yd: [0, 0.5], pass_td: [0, 12], int: [-10, 0],
    rush_yd: [0, 1], rush_td: [0, 12],
    rec: [0, 3], rec_yd: [0, 1], rec_td: [0, 12],
    fum_lost: [-10, 0], two_pt: [0, 6],
  },
  NBA: {
    pts: [0, 5], reb: [0, 5], ast: [0, 5], stl: [0, 10], blk: [0, 10], to: [-5, 0], three: [0, 5],
  },
}

/** The editable rows for Custom, seeded from the sport's starting label. */
export function customScoringFields(sport: LabelSport): CustomScoringField[] {
  const start = getScoringLabel(customScoringStartingPoint(sport))
  if (!start) return []
  return start.values.flatMap((v) => {
    const range = RANGES[sport][v.key]
    return range ? [{ key: v.key, label: v.label, seed: v.value, min: range[0], max: range[1], step: CUSTOM_SCORING_STEP }] : []
  })
}

function onStep(n: number): boolean {
  const scaled = n / CUSTOM_SCORING_STEP
  return Math.abs(scaled - Math.round(scaled)) < 1e-6
}

/** Rounds away float noise (0.1 + 0.2) so stored values are exactly two decimals. */
const clean = (n: number) => Number(n.toFixed(2)) + 0 // `+ 0` turns -0 into 0

/**
 * Validates submitted custom values. Accepts any subset of the editable keys; values equal to the
 * starting point are dropped so only real changes are stored. Unknown keys, non-numbers, values out
 * of range and values finer than 0.01 are refused with a message naming the stat.
 */
export function parseCustomOverrides(sport: LabelSport, raw: unknown): { ok: true; overrides: CustomOverrides } | { ok: false; issues: string[] } {
  if (raw === undefined || raw === null) return { ok: true, overrides: {} }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, issues: ['Check the custom scoring values.'] }
  const fields = new Map(customScoringFields(sport).map((f) => [f.key, f]))
  const issues: string[] = []
  const overrides: CustomOverrides = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const field = fields.get(key)
    if (!field) { issues.push(`"${key}" is not a ${sport} custom scoring value.`); continue }
    if (typeof value !== 'number' || !Number.isFinite(value)) { issues.push(`${field.label}: enter a number.`); continue }
    if (value < field.min || value > field.max) { issues.push(`${field.label}: use a value from ${field.min} to ${field.max}.`); continue }
    if (!onStep(value)) { issues.push(`${field.label}: use at most two decimals.`); continue }
    const v = clean(value)
    if (v !== field.seed) overrides[key] = v
  }
  return issues.length ? { ok: false, issues } : { ok: true, overrides }
}

/** Every editable value: the starting point with the overrides applied. */
export function customScoringValues(sport: LabelSport, overrides: CustomOverrides = {}): Record<string, number> {
  return Object.fromEntries(customScoringFields(sport).map((f) => [f.key, overrides[f.key] ?? f.seed]))
}

/**
 * The full live rule map for a Custom league: the starting label's preset, with every edited design
 * value written onto each live key that scores it (2-pt conversion covers passing, rushing and
 * receiving alike).
 */
export function customLiveRules(sport: LabelSport, overrides: CustomOverrides = {}): Record<string, number> {
  const start = getScoringLabel(customScoringStartingPoint(sport))
  const rules = start ? { ...(liveRulesForScoringLabel(start) ?? {}) } : {}
  const map = sport === 'NBA' ? NBA_DESIGN_TO_LIVE_KEYS : NFL_DESIGN_TO_LIVE_KEYS
  for (const [key, value] of Object.entries(customScoringValues(sport, overrides))) {
    for (const live of map[key] ?? []) rules[live] = value
  }
  return rules
}
