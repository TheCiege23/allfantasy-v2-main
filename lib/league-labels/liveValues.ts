/**
 * Reads the numbers a label's backing preset ACTUALLY scores, and maps existing preset ids onto
 * label ids. The presets stay the single source of truth for points; the catalogue only names them.
 */
import { buildFullNflScoringConfig } from '@/lib/nfl-scoring/NflScoringPresets'
import { buildFullScoringConfig as buildFullNbaScoringConfig } from '@/lib/nba-scoring/NbaScoringPresets'
import { NFL_ROSTER_TEMPLATES } from '@/lib/nfl-roster/NflRosterTemplates'
import { NBA_ROSTER_TEMPLATES } from '@/lib/nba-roster/NbaRosterTemplates'
import {
  ROSTER_LABELS,
  SCORING_LABELS,
  type LabelSport,
  type RosterLabel,
  type RosterLabelId,
  type ScoringLabel,
  type ScoringLabelId,
} from './catalog'

/** Design value key → the live preset stat key(s) that score it. Every listed key must agree. */
export const NFL_DESIGN_TO_LIVE_KEYS: Readonly<Record<string, readonly string[]>> = {
  pass_yd: ['passing_yards'],
  pass_td: ['passing_td'],
  int: ['interception_thrown'],
  rush_yd: ['rushing_yards'],
  rush_td: ['rushing_td'],
  rec: ['reception'],
  rec_yd: ['receiving_yards'],
  rec_td: ['receiving_td'],
  fum_lost: ['fumble_lost'],
  two_pt: ['passing_2pt', 'rushing_2pt', 'receiving_2pt'],
  te_rec_bonus: ['te_premium'],
  first_down: ['rushing_first_down', 'receiving_first_down'],
  bonus_100_rush_rec: ['one_hundred_yd_rush_bonus', 'one_hundred_yd_rec_bonus'],
  bonus_300_pass: ['three_hundred_yd_pass_bonus'],
  bonus_40_td: ['forty_yd_rush_td_bonus', 'forty_yd_rec_td_bonus'],
}

export const NBA_DESIGN_TO_LIVE_KEYS: Readonly<Record<string, readonly string[]>> = {
  pts: ['points_scored'],
  reb: ['rebound'],
  ast: ['assist'],
  stl: ['steal'],
  blk: ['block'],
  to: ['turnover'],
  three: ['three_point_made'],
  dd: ['double_double'],
  td: ['triple_double'],
}

/** Live keys the handoff deliberately leaves to "the AF standard tables" (K, DST, IDP). */
export function isOutsideLabelScope(sport: LabelSport, liveKey: string): boolean {
  if (sport !== 'NFL') return false
  return /^(pat_|fg_|dst_|idp_)/.test(liveKey)
}

/** The full live rule map behind a scoring label, or null when no preset backs it. */
export function liveRulesForScoringLabel(label: ScoringLabel): Record<string, number> | null {
  const b = label.backing
  if (!b) return null
  if (b.kind === 'nfl') {
    const rules = buildFullNflScoringConfig(b.presetKey)
    // The TE premium amount is written by nflScoringSeedForCreate only when chosen.
    if (b.tePremiumPoints != null) rules.te_premium = b.tePremiumPoints
    return rules
  }
  if (b.kind === 'nba') return buildFullNbaScoringConfig(b.presetKey)
  return null
}

/** Live value for one design row, or null if its live keys disagree with each other. */
export function liveValueFor(label: ScoringLabel, designKey: string): number | null {
  const rules = liveRulesForScoringLabel(label)
  if (!rules) return null
  const sport: LabelSport = label.sports.includes('NBA') && !label.sports.includes('NFL') ? 'NBA' : 'NFL'
  const keys = (sport === 'NBA' ? NBA_DESIGN_TO_LIVE_KEYS : NFL_DESIGN_TO_LIVE_KEYS)[designKey]
  if (!keys) return null
  const values = new Set(keys.map((k) => rules[k] ?? 0))
  return values.size === 1 ? [...values][0]! : null
}

/** Roster-template slot key → design position code. */
const LIVE_SLOT_TO_DESIGN: Readonly<Record<string, string>> = { DEF: 'DST', SUPERFLEX: 'SFLEX', IDP_FLEX: 'IDP' }
const RESERVE = new Set(['BN', 'IR', 'IL', 'IL_PLUS', 'TAXI', 'DEVY'])

export type RosterShape = { starters: Record<string, number>; bench: number; injured: number }

/** A roster label's design counts as a comparable shape. */
export function rosterLabelShape(label: RosterLabel): RosterShape {
  const starters: Record<string, number> = {}
  for (const p of label.starters) starters[p] = (starters[p] ?? 0) + 1
  return { starters, bench: label.bench, injured: label.injured }
}

/** A live slot map (NflRosterTemplate.slots, league roster config) as a comparable shape. */
export function rosterShapeFromSlots(slots: Record<string, number>): RosterShape {
  const starters: Record<string, number> = {}
  let bench = 0
  let injured = 0
  for (const [key, count] of Object.entries(slots)) {
    if (!count || count <= 0) continue
    if (key === 'BN') bench += count
    else if (key === 'IR' || key === 'IL') injured += count
    else if (RESERVE.has(key)) continue
    else {
      const code = LIVE_SLOT_TO_DESIGN[key] ?? key
      starters[code] = (starters[code] ?? 0) + count
    }
  }
  return { starters, bench, injured }
}

export function liveSlotsForRosterLabel(label: RosterLabel): Record<string, number> | null {
  const b = label.backing
  if (!b) return null
  const list = b.kind === 'nfl' ? NFL_ROSTER_TEMPLATES : NBA_ROSTER_TEMPLATES
  return list.find((t) => t.key === b.templateKey)?.slots ?? null
}

function sameStarters(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false
  return true
}

/**
 * The roster label whose STARTERS match a league's slots. Bench and IR/IL counts are returned
 * separately because live templates differ from the handoff there (see valueDifferences.ts); the
 * caller shows the league's real counts and `exact` says whether the plate art can be used as-is.
 */
export function matchRosterLabel(
  sport: LabelSport,
  slots: Record<string, number>,
): { label: RosterLabel; exact: boolean; shape: RosterShape } | null {
  const shape = rosterShapeFromSlots(slots)
  const candidates = ROSTER_LABELS.filter((r) => r.sport === sport)
  const matches = candidates.filter((r) => sameStarters(rosterLabelShape(r).starters, shape.starters))
  if (matches.length === 0) return null
  const exact = matches.find((r) => r.bench === shape.bench && r.injured === shape.injured)
  const label = exact ?? matches[0]!
  return { label, exact: Boolean(exact), shape }
}

// ---------------------------------------------------------------------------
// Existing preset ids → label ids
// ---------------------------------------------------------------------------

/**
 * The create wizard's scoring preset ids (lib/league-creation-preset/scoring-presets.ts) → label.
 * Ids with no label of their own (ESPN / Sleeper site defaults, superflex/2QB which are roster
 * shapes, IDP, other sports) are absent and render without a plate.
 */
export const WIZARD_PRESET_TO_SCORING_LABEL: Readonly<Record<string, ScoringLabelId>> = {
  fb_std: 'std',
  fb_standard: 'std',
  fb_half_ppr: 'half',
  fb_superflex: 'half',
  fb_2qb: 'half',
  fb_ppr: 'ppr',
  fb_full_ppr: 'ppr',
  nba_points: 'pts',
  nba_9cat: 'cat9',
  nba_8cat: 'cat8',
}

export function scoringLabelIdForWizard(input: {
  scoringPresetId: string | null | undefined
  tePremiumPoints?: number | null
}): ScoringLabelId | null {
  const id = input.scoringPresetId ? WIZARD_PRESET_TO_SCORING_LABEL[input.scoringPresetId] : undefined
  if (!id) return null
  if (input.tePremiumPoints != null) {
    // Full PPR + 0.5 per TE catch is exactly TE Premium; any other TE amount is a house rule.
    return id === 'ppr' && input.tePremiumPoints === 0.5 ? 'te' : 'custom'
  }
  return id
}

/** League-settings NFL preset key (NflScoringPresets) → label. */
export function scoringLabelIdForNflPreset(input: {
  presetKey: string | null | undefined
  rulesMatchPreset: boolean
  tePremiumPoints?: number | null
}): ScoringLabelId | null {
  const { presetKey } = input
  if (!presetKey) return null
  if (presetKey === 'custom' || !input.rulesMatchPreset) return 'custom'
  const base = presetKey === 'af_default' ? 'half' : presetKey === 'af_ppr' ? 'ppr' : presetKey === 'af_standard' ? 'std' : null
  if (!base) return null // a site preset (ESPN, Sleeper, Yahoo) keeps its own name, no plate
  const tep = input.tePremiumPoints ?? 0
  if (tep === 0) return base
  return base === 'ppr' && tep === 0.5 ? 'te' : 'custom'
}

/** League-settings NBA scoring → label. */
export function scoringLabelIdForNba(input: {
  presetKey?: string | null
  rulesMatchPreset?: boolean
  scoringMode?: string | null
  categoryPresetId?: string | null
}): ScoringLabelId | null {
  if (input.scoringMode === 'h2h_category' || input.scoringMode === 'roto') {
    if (input.categoryPresetId === 'nba_9cat') return 'cat9'
    if (input.categoryPresetId === 'nba_8cat_standard') return 'cat8'
    // `nba_8cat` is the LEGACY 8-cat (keeps TO, drops 3PM) — not the handoff's 8CAT.
    return 'custom'
  }
  if (!input.presetKey) return null
  if (input.presetKey === 'custom' || input.rulesMatchPreset === false) return 'custom'
  return input.presetKey === 'af_default' ? 'pts' : null
}

export function backedScoringLabels(): ScoringLabel[] {
  return SCORING_LABELS.filter((s) => s.backing !== null)
}

export function rosterLabelIds(): RosterLabelId[] {
  return ROSTER_LABELS.map((r) => r.id)
}
