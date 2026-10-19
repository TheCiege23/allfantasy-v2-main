/**
 * The scoring and roster a divisions tournament plays under — one choice for every league and
 * every stage, locked once registration opens (handoff `scoring-roster-labels`).
 *
 * Stored inside `TournamentShell.formatSettings` as `rules: { scoringId, rosterId }` (no column of
 * its own). Ids are label ids from `lib/league-labels/catalog.ts`; only labels with a live preset
 * behind them (`backing !== null`) can be chosen, so league creation can apply them later.
 * Tournaments saved before this existed have no `rules` and read as their sport's defaults.
 * Pure — safe on the client.
 */
import {
  LABEL_DEFAULTS, getRosterLabel, getScoringLabel, rosterLabelsForSport, scoringLabelsForSport,
  type LabelSport, type RosterLabel, type RosterLabelId, type ScoringLabel, type ScoringLabelId,
} from '@/lib/league-labels/catalog'

export type DivisionsRules = { scoringId: ScoringLabelId; rosterId: RosterLabelId }

/** A label can be chosen for a tournament when it belongs to the sport and a live preset backs it. */
export const isChoosableScoring = (l: ScoringLabel, sport: LabelSport) => l.sports.includes(sport) && l.backing !== null
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
  const r = raw as { scoringId?: unknown; rosterId?: unknown }
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
  return issues.length ? { ok: false, issues } : { ok: true, rules: { scoringId, rosterId } }
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
