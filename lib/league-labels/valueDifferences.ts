/**
 * Where the handoff's label values differ from the live presets that back them.
 *
 * 🛑 The live presets were NOT changed. Leagues already score with them, and a label must never
 * silently move a live league's points. Every row here is a decision for the product owner:
 * either change the preset (a scoring change for new leagues) or change the label copy.
 * `__tests__/league-labels/catalog-consistency.test.ts` recomputes the differences from the
 * presets and fails if this list is incomplete OR stale, so it cannot drift from the code.
 */
import { getCategoryPresetDefinitions } from '@/lib/category-scoring'
import { ROSTER_LABELS, SCORING_LABELS, type LabelSport, type RosterLabelId, type ScoringLabelId } from './catalog'
import {
  NBA_DESIGN_TO_LIVE_KEYS,
  NFL_DESIGN_TO_LIVE_KEYS,
  isOutsideLabelScope,
  liveRulesForScoringLabel,
  liveSlotsForRosterLabel,
  rosterLabelShape,
  rosterShapeFromSlots,
} from './liveValues'

export type ValueDifference =
  | { kind: 'scoring'; labelId: ScoringLabelId; key: string; design: number | null; live: number | null }
  | { kind: 'categories'; labelId: ScoringLabelId; key: string; design: boolean; live: boolean }
  | { kind: 'roster'; labelId: RosterLabelId; key: string; design: number; live: number }

/** Recompute every difference between the catalogue and its backing presets. */
export function computeValueDifferences(): ValueDifference[] {
  const out: ValueDifference[] = []
  for (const label of SCORING_LABELS) {
    const b = label.backing
    if (!b) continue
    if (b.kind === 'nba_category') {
      const live = new Set((getCategoryPresetDefinitions(b.categoryPresetId) ?? []).map((c) => c.label))
      const design = new Set(label.categories)
      for (const key of new Set([...design, ...live])) {
        if (design.has(key) !== live.has(key)) out.push({ kind: 'categories', labelId: label.id, key, design: design.has(key), live: live.has(key) })
      }
      continue
    }
    const sport: LabelSport = b.kind === 'nba' ? 'NBA' : 'NFL'
    const map = sport === 'NBA' ? NBA_DESIGN_TO_LIVE_KEYS : NFL_DESIGN_TO_LIVE_KEYS
    const rules = liveRulesForScoringLabel(label) ?? {}
    const covered = new Set<string>()
    for (const row of label.values) {
      for (const liveKey of map[row.key] ?? []) {
        covered.add(liveKey)
        const live = rules[liveKey] ?? 0
        if (live !== row.value) out.push({ kind: 'scoring', labelId: label.id, key: liveKey, design: row.value, live })
      }
    }
    // Live rules the label does not mention at all (a design "—").
    for (const [liveKey, live] of Object.entries(rules)) {
      if (live === 0 || covered.has(liveKey) || isOutsideLabelScope(sport, liveKey)) continue
      out.push({ kind: 'scoring', labelId: label.id, key: liveKey, design: null, live })
    }
  }
  for (const label of ROSTER_LABELS) {
    const slots = liveSlotsForRosterLabel(label)
    if (!slots) continue
    const design = rosterLabelShape(label)
    const live = rosterShapeFromSlots(slots)
    for (const key of new Set([...Object.keys(design.starters), ...Object.keys(live.starters)])) {
      const d = design.starters[key] ?? 0
      const l = live.starters[key] ?? 0
      if (d !== l) out.push({ kind: 'roster', labelId: label.id, key, design: d, live: l })
    }
    if (design.bench !== live.bench) out.push({ kind: 'roster', labelId: label.id, key: 'BN', design: design.bench, live: live.bench })
    const injuredKey = label.sport === 'NBA' ? 'IL' : 'IR'
    if (design.injured !== live.injured) out.push({ kind: 'roster', labelId: label.id, key: injuredKey, design: design.injured, live: live.injured })
  }
  return out
}

/** Stable string form, one per difference — what the PR lists and the test compares. */
export function describeDifference(d: ValueDifference): string {
  const fmt = (v: number | boolean | null) => (v === null ? '—' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v))
  return `${d.kind}:${d.labelId}:${d.key} design=${fmt(d.design)} live=${fmt(d.live)}`
}

/**
 * The known, reviewed differences. Each needs an owner decision (see the PR's "Value differences").
 * Sources: NFL = NflScoringPresets (what nflScoringSeedForCreate writes), NBA = NbaScoringPresets
 * af_default (what applyDefaultNbaScoringOnCreate writes), rosters = Nfl/NbaRosterTemplates.
 */
export const KNOWN_VALUE_DIFFERENCES: readonly string[] = [
  'roster:nba-std:C design=1 live=2',
  'roster:nba-std:IL design=1 live=2',
  'roster:nba-std:UTIL design=3 live=2',
  'roster:nfl-idp:DB design=1 live=2',
  'roster:nfl-idp:DL design=1 live=2',
  'roster:nfl-idp:DST design=1 live=0',
  'roster:nfl-idp:IR design=1 live=2',
  'roster:nfl-idp:K design=1 live=0',
  'roster:nfl-idp:LB design=1 live=2',
  'roster:nfl-sf:BN design=7 live=8',
  'roster:nfl-sf:IR design=1 live=0',
  'roster:nfl-std:BN design=7 live=6',
  'scoring:half:interception_thrown design=-2 live=-1',
  'scoring:half:off_fumble_recovery_td design=— live=6',
  'scoring:half:return_td design=— live=6',
  'scoring:ppr:interception_thrown design=-2 live=-1',
  'scoring:ppr:off_fumble_recovery_td design=— live=6',
  'scoring:ppr:return_td design=— live=6',
  'scoring:pts:assist design=1.5 live=1',
  'scoring:pts:block design=3 live=2',
  'scoring:pts:double_double design=— live=1',
  'scoring:pts:fifty_plus_points_bonus design=— live=2',
  'scoring:pts:flagrant_foul design=— live=-2',
  'scoring:pts:forty_plus_points_bonus design=— live=2',
  'scoring:pts:points_scored design=1 live=0.5',
  'scoring:pts:rebound design=1.2 live=1',
  'scoring:pts:steal design=3 live=2',
  'scoring:pts:technical_foul design=— live=-2',
  'scoring:pts:triple_double design=— live=2',
  'scoring:std:interception_thrown design=-2 live=-1',
  'scoring:std:off_fumble_recovery_td design=— live=6',
  'scoring:std:return_td design=— live=6',
  'scoring:te:interception_thrown design=-2 live=-1',
  'scoring:te:off_fumble_recovery_td design=— live=6',
  'scoring:te:return_td design=— live=6',
]
