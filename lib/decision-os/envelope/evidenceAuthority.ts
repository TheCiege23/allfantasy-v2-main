/**
 * Which evidence outranks which, and what Chimmy may say when the answer is
 * missing.
 *
 * 🛑 THE RULE THIS FILE EXISTS FOR: WHEN THE LEAGUE-SPECIFIC ENGINE REFUSES,
 * CHIMMY DOES NOT SUBSTITUTE ITS OWN BROAD VALUE. A market number offered in
 * place of a league-specific one is not a partial answer; it is a different
 * answer to a different question, delivered in the voice of the one that was
 * asked. A manager in a superflex TE-premium league told "he's worth about a
 * 2nd" has been told something about a league they are not in.
 */

import type { EnvelopeFact, EnvelopeGap, EnvelopeRefusal, TemporalScope } from './types'

/**
 * Evidence tiers for a LEAGUE-SPECIFIC question, strongest first.
 *
 * League settings, rosters, transactions and history beat generic market
 * assumptions — always, and not by a small margin. A league's own scoring is a
 * fact about that league; a market consensus is an average over leagues that
 * mostly are not it.
 */
const LEAGUE_EVIDENCE_RANK: readonly string[] = [
  'league_settings',
  'league_rules',
  'roster',
  'transactions',
  'league_history',
  'projection',
  'market',
]

function evidenceRankOf(source: string): number {
  const i = LEAGUE_EVIDENCE_RANK.indexOf(source)
  /* Unknown sources rank last rather than first — an unrecognised source is not
   * thereby authoritative. */
  return i === -1 ? LEAGUE_EVIDENCE_RANK.length : i
}

/** Sort facts so the strongest evidence is what a reader meets first. */
export function orderByEvidenceAuthority(facts: EnvelopeFact[]): EnvelopeFact[] {
  return [...facts].sort(
    (a, b) => evidenceRankOf(a.citation.source) - evidenceRankOf(b.citation.source)
  )
}

/**
 * Whether a team-specific answer may fall back to the market number.
 *
 * It may not. This function exists so the answer is a named, tested thing
 * rather than an assumption living in whichever caller last thought about it.
 */
export function mayFallBackToMarket(): false {
  return false
}

/**
 * What to say when the league-specific engine refused.
 *
 * ⚠ THE MARKET VALUE IS STILL REPORTABLE — as a market value, labelled. What is
 * forbidden is presenting it as the team-specific answer. Withholding it
 * entirely would be its own small dishonesty: we do know it.
 */
export function refusalForMissingTeamValue(playerLabel: string): {
  refusal: EnvelopeRefusal
  gap: EnvelopeGap
} {
  return {
    refusal: {
      code: 'insufficient_evidence',
      message: `I cannot price ${playerLabel} for your league specifically, so I will not give you a number that pretends to be that.`,
      remedy: 'Once this league’s settings and roster are current, the league-specific value fills in.',
    },
    gap: {
      reason: 'not_computed',
      detail: `Team-specific value for ${playerLabel} was not produced by the league engine.`,
      remedy: 'Re-sync the league, or ask again once its valuation run completes.',
      factKey: 'player.value.teamSpecific',
    },
  }
}

/**
 * How old a fact may be before it is labelled stale, by temporal scope.
 *
 * ⚠ THE SCOPE DECIDES, NOT THE FACT. A four-hour-old score is useless during a
 * game and completely fine for a settled result. One global threshold would
 * either spam caveats onto historical facts or hide staleness during a live one.
 * `historical` has no threshold at all: a 1992 result does not go stale.
 */
const STALENESS_TOLERANCE_MS: Record<TemporalScope, number | null> = {
  historical: null,
  current: 24 * 60 * 60 * 1000,
  live: 5 * 60 * 1000,
  upcoming: 6 * 60 * 60 * 1000,
  projected: 7 * 24 * 60 * 60 * 1000,
}

export function isStale(observedAt: string | null, scope: TemporalScope, now: Date): boolean {
  const tolerance = STALENESS_TOLERANCE_MS[scope]
  if (tolerance === null) return false
  /*
   * ⚠ AN UNKNOWN TIMESTAMP IS NOT FRESH. We cannot show it is current, so it is
   * labelled — the conservative direction, and the one that keeps a reader from
   * assuming a number is live because nothing said otherwise.
   */
  if (!observedAt) return true
  const t = Date.parse(observedAt)
  if (!Number.isFinite(t)) return true
  return now.getTime() - t > tolerance
}

/** Stamp `stale` on each fact according to the request's temporal scope. */
export function markStaleness(
  facts: EnvelopeFact[],
  scope: TemporalScope,
  now: Date
): EnvelopeFact[] {
  return facts.map((f) => ({ ...f, stale: isStale(f.citation.observedAt, scope, now) }))
}

/**
 * The port Step 4 will implement for general sports facts.
 *
 * 🛑 DEFINED, NOT IMPLEMENTED, AND DELIBERATELY NOT STUBBED WITH ANYTHING THAT
 * RETURNS DATA. A stub that returns a plausible-looking result is how a fake
 * citation reaches a user. The only implementation shipped here is the one that
 * refuses, so a caller wired up early degrades to an honest gap rather than to
 * invented evidence.
 */
interface GeneralSportsFactPort {
  lookup(query: {
    question: string
    sport: string | null
    temporalScope: TemporalScope
  }): Promise<{ facts: EnvelopeFact[]; gaps: EnvelopeGap[] }>
}

/** The only implementation until Step 4. Returns a gap, never a fact. */
export const unimplementedSportsFactPort: GeneralSportsFactPort = {
  async lookup({ question }) {
    return {
      facts: [],
      gaps: [
        {
          reason: 'no_producer',
          detail: `No research provider is wired up to answer: ${question.slice(0, 120)}`,
          remedy: 'General sports research arrives in a later step.',
        },
      ],
    }
  },
}
