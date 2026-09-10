/**
 * Refusal scope and severity.
 *
 * 🛑 "ANY REFUSAL SUPPRESSES EVERYTHING" WAS TOO BLUNT, AND THE BLUNTNESS COST
 * REAL ANSWERS. A league that cannot be written to is a reason not to promise a
 * waiver claim; it is not a reason to withhold the analysis of who to claim. An
 * unavailable optional fact is a gap, not a silence. Collapsing all of those
 * into one switch meant the safest-looking behaviour was also the least useful,
 * and a user who asks four questions and gets four blanks stops asking.
 *
 * ⚠ THE INVERSE IS THE REAL DANGER AND IT IS WHY `partial` EXISTS. A partial
 * result worded as a complete one is worse than a refusal: the reader cannot
 * tell what is missing. Every scope below either suppresses its conclusion or
 * marks the answer partial. None of them silently narrows.
 */

import type { EnvelopeRefusal } from './types'

export type RefusalScope =
  /** Nothing may be answered. Suppresses recommendation AND alternatives. */
  | 'response'
  /**
   * The league-specific conclusion is withheld; clearly labelled market or
   * global evidence may still be stated.
   */
  | 'league_recommendation'
  /** One fact or component is unavailable. The rest of the answer stands. */
  | 'fact'
  /** An action cannot be performed. Informational analysis is untouched. */
  | 'action'

export type RefusalSeverity = 'blocking' | 'partial'

export type ScopedRefusal = EnvelopeRefusal & {
  scope: RefusalScope
  severity: RefusalSeverity
}

/**
 * Severity follows scope, and is derived rather than passed.
 *
 * ⚠ DERIVED SO THE TWO CANNOT DISAGREE. A caller free to set both will
 * eventually mark a `response` refusal `partial`, and that combination reads to
 * a renderer as "show the answer anyway".
 */
export function severityFor(scope: RefusalScope): RefusalSeverity {
  return scope === 'response' ? 'blocking' : 'partial'
}

export function scopedRefusal(refusal: EnvelopeRefusal, scope: RefusalScope): ScopedRefusal {
  return { ...refusal, scope, severity: severityFor(scope) }
}

/**
 * The scope each refusal code carries when nothing more specific is known.
 *
 * ⚠ `insufficient_evidence` IS `league_recommendation`, NOT `response`. It is
 * raised when the league engine cannot price something — which withholds the
 * team-specific number and nothing else. Making it blocking would delete the
 * market evidence we legitimately have, which is the exact substitution the
 * value-separation rule forbids in the other direction.
 */
const DEFAULT_SCOPE: Record<EnvelopeRefusal['code'], RefusalScope> = {
  not_authorized: 'response',
  no_league_selected: 'response',
  ambiguous_league: 'response',
  gambling_request: 'response',
  unsupported_request: 'response',
  insufficient_evidence: 'league_recommendation',
  engine_refused: 'league_recommendation',
}

export function defaultScopeFor(code: EnvelopeRefusal['code']): RefusalScope {
  return DEFAULT_SCOPE[code] ?? 'response'
}

export type RefusalEffect = {
  /** Suppress the recommendation and alternatives entirely. */
  suppressAll: boolean
  /** Suppress the team-specific conclusion only. */
  suppressLeagueRecommendation: boolean
  /** Suppress action availability claims only. */
  suppressActions: boolean
  /**
   * The answer is incomplete and must SAY so.
   *
   * ⚠ TRUE WHENEVER ANYTHING WAS WITHHELD, INCLUDING A SINGLE FACT. "No partial
   * result may be worded as a complete answer" is only enforceable if the
   * renderer is told, and this is the flag that tells it.
   */
  partial: boolean
}

export function effectOf(refusals: readonly ScopedRefusal[]): RefusalEffect {
  const has = (s: RefusalScope) => refusals.some((r) => r.scope === s)
  const suppressAll = has('response')
  return {
    suppressAll,
    /*
     * A blocking refusal implies the league one. Reporting them independently
     * would let a renderer clear the narrower flag and show a team-specific
     * number underneath a total refusal.
     */
    suppressLeagueRecommendation: suppressAll || has('league_recommendation'),
    suppressActions: suppressAll || has('action'),
    partial: refusals.length > 0 && !suppressAll,
  }
}
