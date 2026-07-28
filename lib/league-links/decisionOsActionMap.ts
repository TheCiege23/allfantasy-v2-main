/**
 * Decision OS signal → action mapping (PURE, no DB, no provider). Maps a normalized lineup-action
 * `reasonType` to (a) whether it warrants an EXTERNAL "complete on the source platform" action, (b) the
 * resolver `SourceActionType` for that destination, (c) the internal AllFantasy analysis label + tab, and
 * (d) the external CTA label. Behavior is chosen from the normalized signal type — NEVER from display text.
 * Shared by the server enricher and the client card so labels never drift.
 */
import type { SourceActionType } from './sourceLinkResolver'
import type { LineupActionReasonType } from '@/lib/lineup-actions/types'

export type DecisionActionConfig = {
  /** Does this signal warrant an EXTERNAL source-platform CTA? (false = informational — no external action.) */
  actionable: boolean
  /** Resolver action for the external destination (null when not actionable). */
  action: SourceActionType | null
  /** Internal AllFantasy analysis label (null when the signal has no AF tool action — pure info). */
  internalLabel: string | null
  /** Internal AF league tab for the analysis link. */
  internalTab: string | null
  /** External CTA label — used only when actionable AND the league is imported AND a link resolves. */
  externalLabel: (leagueName: string) => string
}

const LINEUP: DecisionActionConfig = {
  actionable: true,
  action: 'lineup',
  internalLabel: 'Review Lineup in AF',
  internalTab: 'team',
  externalLabel: (n) => `Set Lineup in ${n}`,
}

export function decisionActionConfig(reasonType: LineupActionReasonType): DecisionActionConfig {
  switch (reasonType) {
    case 'empty_starter':
    case 'injured_starter':
    case 'questionable_starter':
    case 'doubtful_starter':
    case 'illegal_slot':
    case 'native_starter_gap':
    case 'ai_start_sit':
      return LINEUP
    case 'ai_waiver':
      return { actionable: true, action: 'waiver', internalLabel: 'Analyze Waivers in AF', internalTab: 'players', externalLabel: (n) => `Manage Waivers in ${n}` }
    case 'injury_impact':
      return { actionable: true, action: 'roster', internalLabel: 'Review Recommendation in AF', internalTab: 'team', externalLabel: (n) => `Manage Roster in ${n}` }
    case 'war_room':
      return { actionable: true, action: 'lineup', internalLabel: 'Open War Room in AF', internalTab: 'team', externalLabel: (n) => `Set Lineup in ${n}` }
    // Informational signals: internal AF analysis only, NO external CTA (never invent a source action).
    case 'matchup_prep':
      return { actionable: false, action: null, internalLabel: 'Review Matchup in AF', internalTab: 'team', externalLabel: (n) => `Go to ${n}` }
    case 'weather_risk':
    case 'fetch_error':
    default:
      return { actionable: false, action: null, internalLabel: null, internalTab: null, externalLabel: (n) => `Go to ${n}` }
  }
}

/** Internal AllFantasy analysis destination (always an internal AF route — never external). */
export function internalActionHref(leagueId: string, tab: string | null): string {
  const base = `/league/${encodeURIComponent(leagueId)}`
  return tab ? `${base}?tab=${encodeURIComponent(tab)}` : base
}
