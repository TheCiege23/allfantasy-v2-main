/**
 * The scoring and roster a divisions tournament plays under — one choice for every league and
 * every stage, locked once registration opens (handoff `scoring-roster-labels`).
 *
 * Stored inside `TournamentShell.formatSettings` as `rules: { scoringId, rosterId, overrides? }` (no
 * column of its own). Ids are label ids from `lib/league-labels/catalog.ts`; only labels with a live
 * preset behind them (`backing !== null`) can be chosen, so league creation can apply them later —
 * plus Custom, whose values (`overrides`, see lib/league-labels/customScoring.ts) are written onto
 * the league's scoring store at creation. Overrides are accepted only when scoringId is `custom`.
 * Tournaments saved before this existed have no `rules` and read as their sport's defaults.
 * Pure — safe on the client.
 */
import { parseCustomOverrides, type CustomOverrides } from '@/lib/league-labels/customScoring'
import {
  LABEL_DEFAULTS, getRosterLabel, getScoringLabel, rosterLabelsForSport, scoringLabelsForSport,
  type LabelSport, type RosterLabel, type RosterLabelId, type ScoringLabel, type ScoringLabelId,
} from '@/lib/league-labels/catalog'

/** `overrides` is present only when scoringId is `custom` (only the values that differ from its start). */
export type DivisionsRules = { scoringId: ScoringLabelId; rosterId: RosterLabelId; overrides?: CustomOverrides }

/**
 * A label can be chosen for a tournament when it belongs to the sport and a live preset backs it.
 * Custom has no preset of its own: it is written from its starting preset plus the commissioner's values.
 */
export const isChoosableScoring = (l: ScoringLabel, sport: LabelSport) => l.sports.includes(sport) && (l.backing !== null || l.type === 'custom')
export const isChoosableRoster = (l: RosterLabel, sport: LabelSport) => l.sport === sport && l.backing !== null

export function scoringChoices(sport: LabelSport) {
  return scoringLabelsForSport(sport).map(l => ({ id: l.id, disabled: !isChoosableScoring(l, sport) }))
}
export function rosterChoices(sport: LabelSport) {
  return rosterLabelsForSport(sport).map(l => ({ id: l.id, disabled: !isChoosableRoster(l, sport) }))
}

export function defaultDivisionsRules(sport: LabelSport): DivisionsRules {
  const d = LABEL_DEFAULTS[sport]
  return { scoringId: d.scoring, rosterId: d.roster }
}

/** Validates a submitted choice. Omitted ids take the sport's default, so older clients keep working. */
export function parseDivisionsRules(sport: LabelSport, raw: unknown): { ok: true; rules: DivisionsRules } | { ok: false; issues: string[] } {
  const d = defaultDivisionsRules(sport)
  if (raw === undefined || raw === null) return { ok: true, rules: d }
  if (typeof raw !== 'object') return { ok: false, issues: ['Check the scoring and roster.'] }
  const r = raw as { scoringId?: unknown; rosterId?: unknown; overrides?: unknown }
  const issues: string[] = []
  let scoringId = d.scoringId
  let rosterId = d.rosterId
  if (r.scoringId !== undefined) {
    const label = typeof r.scoringId === 'string' ? getScoringLabel(r.scoringId) : null
    if (!label || !isChoosableScoring(label, sport)) issues.push(`Pick a scoring option available for ${sport} tournaments.`)
    else scoringId = label.id
  }
  if (r.rosterId !== undefined) {
    const label = typeof r.rosterId === 'string' ? getRosterLabel(r.rosterId) : null
    if (!label || !isChoosableRoster(label, sport)) issues.push(`Pick a roster available for ${sport} tournaments.`)
    else rosterId = label.id
  }
  let overrides: CustomOverrides | undefined
  if (scoringId === 'custom') {
    const parsed = parseCustomOverrides(sport, r.overrides)
    if (parsed.ok) overrides = parsed.overrides
    else issues.push(...parsed.issues)
  } else if (r.overrides !== undefined && r.overrides !== null) {
    issues.push('Custom values can only be set with Custom scoring.')
  }
  if (issues.length) return { ok: false, issues }
  return { ok: true, rules: overrides ? { scoringId, rosterId, overrides } : { scoringId, rosterId } }
}

/**
 * The rules to SHOW for a tournament: its saved choice (`formatSettings.rules`, or the rules object
 * itself) when valid for the sport, otherwise the sport default — never a throw on old rows.
 */
export function divisionsRulesLabels(sport: LabelSport, saved?: unknown): DivisionsRules {
  const raw = saved && typeof saved === 'object' && 'rules' in saved ? (saved as { rules?: unknown }).rules : saved
  const parsed = parseDivisionsRules(sport, raw ?? undefined)
  return parsed.ok ? parsed.rules : defaultDivisionsRules(sport)
}
