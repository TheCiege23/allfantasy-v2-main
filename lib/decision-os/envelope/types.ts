/**
 * `DecisionResponseEnvelopeV1` — the one shape Chimmy verbalizes.
 *
 * 🛑 THIS COMPOSES THE EXISTING CONTRACTS, IT DOES NOT RIVAL THEM. Four response
 * shapes already exist (see `docs/chimmy-intelligence/02-RESPONSE-CONTRACT-RECONCILIATION.md`)
 * and `DecisionOsGroundingPacket` is the strongest — its own header explains that
 * it answers "what may we SAY, and if not, why not, and what would fix it", and
 * its shape was read off all fifteen context providers rather than designed. A
 * fifth independent contract would be a fifth thing to keep in sync; this one
 * carries the packet's facts through and adds only what no existing contract has:
 * scope, authorization, citations, refusal, and action capability.
 *
 * 🛑 CHIMMY VERBALIZES THIS. IT DOES NOT RECALCULATE. Once Decision OS returns a
 * player value, a trade verdict, a waiver ranking or a roster call, the language
 * model's job is to explain it — not to check it, adjust it, or substitute its
 * own. `recommendation` and `calculations` are outputs, not suggestions.
 *
 * ⚠ ONE CONFIDENCE SCALE, 0..1, AND THAT IS A DELIBERATE CHOICE BETWEEN THREE.
 * `AIToolResponseContract.confidence` is 0–100, `ConfidenceSchema.scorePct` is
 * 0–100, and `GroundedSlice.confidence` is 0..1. Anything comparing two of them
 * is wrong by 100x. The packet's scale wins because it is the only one with a
 * documented null semantic — null means "the producer does not express one",
 * explicitly never 0-as-unknown.
 */

import type { GroundingGap } from '@/lib/decision-os/grounding/packet'

/** Bumped when the envelope's shape changes in a way a consumer must notice. */
export const DECISION_ENVELOPE_VERSION = 'v1' as const

/** The seven sports the contract covers. Coverage is a separate question. */
export const ENVELOPE_SPORTS = ['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER'] as const
export type EnvelopeSport = (typeof ENVELOPE_SPORTS)[number]

/**
 * When the answer is about.
 *
 * ⚠ SEPARATE FROM INTENT, because the same intent spans several. "Did Kelce play
 * last week" and "will Kelce play Sunday" are both player questions and need
 * completely different evidence and freshness rules.
 */
export type TemporalScope =
  /** Settled, in the past, and not expected to change. */
  | 'historical'
  /** As of now, not in-play — standings, a roster, a season stat line. */
  | 'current'
  /** In progress right now. The only scope where staleness measured in minutes matters. */
  | 'live'
  /** Scheduled and not yet started. */
  | 'upcoming'
  /** A model output about the future. Never a fact, and must never be worded as one. */
  | 'projected'

/** What the answer is about. */
export type ContextScope =
  | 'global_sport'
  | 'player'
  | 'team'
  | 'league'
  | 'roster'
  | 'matchup'
  | 'transaction'
  | 'commissioner'

/**
 * The intent taxonomy Step 2 requires.
 *
 * ⚠ THIS MAPS ONTO `lib/chimmy-orchestration/intent-classifier.ts`, IT DOES NOT
 * REPLACE IT. That classifier feeds `buildOrchestrationPromptSection` on the live
 * route, so rewiring it changes answers. But its 14 intents carry no
 * `historical_fact`, no `live_fact`, no `upcoming_schedule`, no
 * `unsupported_non_sports` and no `action_request` — the five this step needs
 * most — so the taxonomy is stated here and the mapping is explicit.
 */
export type EnvelopeIntent =
  | 'historical_fact'
  | 'live_fact'
  | 'upcoming_schedule'
  | 'player_info'
  | 'league_rule'
  | 'player_valuation'
  | 'trade_evaluation'
  | 'waiver_add_drop'
  | 'draft_decision'
  | 'roster_strategy'
  | 'commissioner'
  | 'unsupported_non_sports'
  | 'action_request'

/**
 * How a fact came to be known.
 *
 * 🛑 `calculated` AND `inferred` ARE NOT THE SAME AND MUST NOT BE MERGED.
 * A calculation is reproducible from named inputs by a named model; an inference
 * is a judgement that is not. Presenting the second as the first is how a guess
 * acquires the authority of arithmetic.
 */
export type FactBasis =
  | 'provider_reported'
  | 'calculated'
  | 'inferred'
  | 'user_confirmed'
  | 'unavailable'

/**
 * Where a fact came from, in enough detail to check it.
 *
 * ⚠ NEVER MANUFACTURE ONE. A fact with no real source carries
 * `basis: 'unavailable'` and produces a named gap — see `evidenceGaps`. An
 * invented citation is worse than no citation, because it is checkable and wrong.
 */
export type Citation = {
  /** Provider or engine that produced it: "sleeper", "cfbd", "trade_engine". */
  source: string
  /** A record id or URL when one exists. Null is honest; a guess is not. */
  reference: string | null
  /** When the SOURCE observed or published it. Null when the source does not say. */
  observedAt: string | null
  /** When WE read it. Distinct from observedAt: a fresh read of a stale fact. */
  retrievedAt: string | null
  basis: FactBasis
}

/** One normalized fact, with everything needed to decide whether to state it. */
export type EnvelopeFact = {
  /** Stable key: "roster.starters", "player.value.market". */
  key: string
  label: string
  value: unknown
  unit?: string
  citation: Citation
  /**
   * True when the underlying data is older than its temporal scope tolerates.
   * ⚠ STALE IS NOT MISSING. A stale fact is still stated, and labelled.
   */
  stale: boolean
}

/**
 * A Decision OS calculation. Inputs and conclusion are separate on purpose.
 *
 * 🛑 THE SEPARATION IS THE POINT. A reader must be able to tell what was measured
 * from what was concluded, or the conclusion inherits the evidence's authority
 * without earning it.
 */
export type EnvelopeCalculation = {
  key: string
  label: string
  /** Keys of the `facts` this consumed. Never prose. */
  inputFactKeys: string[]
  output: unknown
  unit?: string
  /** The engine and its version, so a number can be reproduced. */
  model: { name: string; version: string }
}

/** Why the envelope declines to answer, in whole or in part. */
export type EnvelopeRefusal = {
  code:
    | 'not_authorized'
    | 'no_league_selected'
    | 'ambiguous_league'
    | 'insufficient_evidence'
    | 'engine_refused'
    | 'unsupported_request'
    | 'gambling_request'
  /** What the user should be told. Contains no ids, settings or provider detail. */
  message: string
  /** What would let the answer proceed, when anything would. */
  remedy: string | null
}

/** A named absence. Reuses the packet's gap taxonomy rather than inventing one. */
export type EnvelopeGap = GroundingGap & {
  /** Which fact key is missing, when the gap is about a specific one. */
  factKey?: string
}

/**
 * The league this answer is scoped to, AFTER authorization.
 *
 * 🛑 THE PRESENCE OF THIS OBJECT IS THE AUTHORIZATION PROOF. It is constructed
 * only from a membership-verified snapshot, never from a request field. A
 * consumer reading `envelope.league.id` is reading an id somebody proved; a
 * consumer reading the raw request is reading a claim — which is exactly the
 * distinction `getInsightBundle` does not make today.
 */
export type AuthorizedLeagueIdentity = {
  id: string
  name: string | null
  sport: EnvelopeSport
  season: number
  /**
   * Where the league lives. Decides whether any write is even conceivable.
   *
   * ⚠ `imported` MEANS READ-ONLY UNLESS A CAPABILITY PROVES OTHERWISE. Sleeper
   * has no write endpoint at all; the others are not wired. An envelope must
   * never imply a host-platform write.
   */
  origin: 'imported' | 'allfantasy'
  /** The host platform for an imported league. Null for AllFantasy-created. */
  platform: string | null
  /** Version of the rule catalog / settings this answer was computed against. */
  rulesVersion: string | null
}

/**
 * An action the envelope has RECOGNISED. Recognition is not permission and is
 * certainly not execution.
 */
export type PermittedAction = {
  id: string
  label: string
  /** Whether the capability exists for this league at all. */
  available: boolean
  /** Why not, when unavailable. */
  unavailableReason: string | null
  /**
   * ⚠ ALWAYS TRUE UNLESS A CONFIGURED AUTO-MANAGEMENT POLICY COVERS THIS EXACT
   * ACTION. The default is confirmation, and the default is what ships.
   */
  requiresConfirmation: boolean
  /** Whether an auto-management policy is enabled and covers this action. */
  autoManaged: boolean
}

/**
 * Objective competitive window, kept apart from what the user has told us.
 *
 * 🛑 THESE TWO ARE SEPARATE FIELDS BECAUSE THEY DISAGREE, AND WHEN THEY DO THE
 * DISAGREEMENT IS THE MOST USEFUL THING ON THE PAGE. A 2-6 roster is objectively
 * rebuilding; a manager who has said "I am going for it" has not changed that
 * fact and must not be told they have. Merging them lets a stated preference
 * silently overwrite a measurement, or a measurement silently overrule a person.
 */
export type CompetitiveWindow = {
  /** Measured from record, roster age, schedule. Never from user preference. */
  objective: 'contending' | 'fringe' | 'rebuilding' | 'unknown'
  basis: string | null
}

/** What the user has explicitly told us, labelled as theirs. */
export type ConfirmedStrategy = {
  /** Null when the user has never confirmed one. Never inferred to fill this in. */
  stance: string | null
  confirmedAt: string | null
}

export type EnvelopeConfidence = {
  /** 0..1, or null when no producer expresses one. NEVER 0-as-unknown. */
  score: number | null
  label: 'low' | 'medium' | 'high' | 'unknown'
  /** Why. Required whenever `score` is non-null — a bare number explains nothing. */
  basis: string
}

export type DecisionResponseEnvelopeV1 = {
  contractVersion: typeof DECISION_ENVELOPE_VERSION
  /** Correlates this answer with logs and support tickets. */
  traceId: string
  builtAt: string

  intent: EnvelopeIntent
  /** Null for a request that names no sport and needs none. */
  sport: EnvelopeSport | null
  temporalScope: TemporalScope
  contextScope: ContextScope

  /** Null for a global question. Present ONLY after authorization. */
  league: AuthorizedLeagueIdentity | null

  facts: EnvelopeFact[]
  calculations: EnvelopeCalculation[]

  /** What Decision OS concluded. Chimmy explains this; it does not revise it. */
  recommendation: string | null
  alternatives: string[]

  confidence: EnvelopeConfidence
  /** Newest and oldest evidence timestamps, so staleness is visible at a glance. */
  freshness: { newestAt: string | null; oldestAt: string | null }

  evidenceGaps: EnvelopeGap[]
  refusals: EnvelopeRefusal[]
  citations: Citation[]

  competitiveWindow: CompetitiveWindow | null
  confirmedStrategy: ConfirmedStrategy | null

  actions: PermittedAction[]
  /** True when any recognised action would require the user to confirm. */
  requiresUserConfirmation: boolean
}
