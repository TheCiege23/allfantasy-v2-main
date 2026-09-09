/**
 * The one authority for "which league is this request about, and may this user
 * see it".
 *
 * 🛑 THE DEFECT THIS EXISTS TO CLOSE IS LIVE TODAY, AND IT IS NOT HYPOTHETICAL.
 * `app/api/chat/chimmy/route.ts` refuses an unauthorized league only when
 * `requiresLeagueGrounding` says the question needs one, and that guard covers
 * `insightType` of trade / waiver / dynasty — three of the six values
 * `InsightType` has. For `matchup`, `playoff` or `draft` the raw request field
 * flows to `getInsightBundle(leagueId, …)`, which
 * `lib/ai-simulation-integration/AIInsightRouter.ts` declares with NO `userId`
 * at all — the file contains zero occurrences of one. It reads matchup
 * predictions, playoff odds, warehouse summaries and a league settings summary
 * for whatever id it is handed, and the result goes into the prompt.
 *
 * So the rule here is not "check authorization somewhere". It is: a consumer
 * must be unable to obtain a league id it has not been authorized for, because
 * the only id this module returns is one membership proved.
 *
 * ⚠ NEVER GUESS AMONG SEVERAL. Picking the most recent, the first, or the
 * highest-scoring league is a coin flip whose loss is advice about the wrong
 * roster delivered in the same confident voice. Ambiguity is an ANSWER here —
 * `ambiguous_league` — and the user is asked.
 */

import {
  loadLeagueGroundingForUser,
  type ChimmyLeagueSnapshot,
} from '@/lib/chimmy/chimmy-league-snapshot'
import { resolveLeagueRules } from '@/lib/league-rules'
import {
  classifyEnvelopeIntent,
  detectSport,
  isSupportedSport,
  orchestrationIntentToEnvelopeIntent,
  requiresLeague,
  resolveContextScope,
  resolveTemporalScope,
} from './intent'
import type {
  AuthorizedLeagueIdentity,
  ContextScope,
  EnvelopeIntent,
  EnvelopeRefusal,
  EnvelopeSport,
  TemporalScope,
} from './types'

/** Where a candidate league id came from. Precedence is expressed by this order. */
export type LeagueIdSource =
  /** The request explicitly names one for THIS turn. */
  | 'explicit_request'
  /** The product already has one selected. */
  | 'active_selection'
  /** Inferred from the conversation, and only when it resolves to exactly one. */
  | 'conversation'

export type LeagueCandidate = {
  id: string
  source: LeagueIdSource
}

export type ContextResolutionInput = {
  message: string
  userId: string | null
  /**
   * Candidate league ids, each with its origin. ALL are treated as CLAIMS
   * regardless of source — `active_selection` is still client-supplied state.
   */
  candidates: LeagueCandidate[]
  /** The orchestration classifier's answer, when the caller already has it. */
  orchestrationIntent?: string | null
  /** Sport hint from the request. Validated, never trusted as-is. */
  sportHint?: string | null
}

export type ResolvedContext = {
  intent: EnvelopeIntent
  sport: EnvelopeSport | null
  temporalScope: TemporalScope
  contextScope: ContextScope
  /** Present ONLY when membership was verified. Null otherwise, always. */
  league: AuthorizedLeagueIdentity | null
  /** The verified snapshot, for callers that need more than identity. */
  snapshot: ChimmyLeagueSnapshot | null
  /** Non-empty when the request cannot proceed as asked. */
  refusals: EnvelopeRefusal[]
  /** Which candidate won, for diagnostics. Null when none did. */
  resolvedFrom: LeagueIdSource | null
}

/** Precedence order. Index = priority; lower wins. */
const SOURCE_PRIORITY: LeagueIdSource[] = ['explicit_request', 'active_selection', 'conversation']

function dedupeByPriority(candidates: LeagueCandidate[]): LeagueCandidate[] {
  const seen = new Map<string, LeagueCandidate>()
  for (const c of candidates) {
    const id = String(c.id ?? '').trim()
    if (!id) continue
    const existing = seen.get(id)
    if (!existing || SOURCE_PRIORITY.indexOf(c.source) < SOURCE_PRIORITY.indexOf(existing.source)) {
      seen.set(id, { id, source: c.source })
    }
  }
  return [...seen.values()]
}

function identityFrom(snapshot: ChimmyLeagueSnapshot): AuthorizedLeagueIdentity {
  /*
   * ⚠ `origin` DECIDES WHETHER A WRITE IS EVEN CONCEIVABLE, so it is derived
   * from the snapshot rather than accepted from anywhere. An imported league is
   * read-only: Sleeper has no write endpoint at all, and the others are not
   * wired. Treating `platform` as the signal is what keeps a future platform
   * from defaulting to writable.
   */
  const platform = snapshot.platform ? String(snapshot.platform).trim().toLowerCase() : ''
  const isImported = platform.length > 0 && platform !== 'allfantasy' && platform !== 'af'

  const rules = resolveLeagueRules({
    leagueType: snapshot.leagueType,
    isDynasty: snapshot.isDynasty,
    keeperCount: snapshot.keeperCount,
    keeperCostSystem: snapshot.keeperCostSystem,
    keeperRoundPenalty: snapshot.keeperRoundPenalty,
    settings: snapshot.settings,
    sport: snapshot.sport,
  })

  return {
    id: snapshot.id,
    name: snapshot.name,
    sport: isSupportedSport(snapshot.sport) ? snapshot.sport : 'NFL',
    season: snapshot.season,
    origin: isImported ? 'imported' : 'allfantasy',
    platform: isImported ? platform : null,
    rulesVersion: rules.catalogVersion,
  }
}

/**
 * Resolve intent, sport, scope and — when authorized — league identity.
 *
 * ⚠ INTENT IS CLASSIFIED BEFORE ANY AUTHORIZATION WORK, deliberately. A global
 * question must not pay for a league read, and a refusal must not depend on one.
 */
export async function resolveDecisionContext(
  input: ContextResolutionInput
): Promise<ResolvedContext> {
  const message = String(input.message ?? '')

  /*
   * The orchestration classifier wins where it has an opinion — it is the one
   * feeding the live prompt section, and two classifiers disagreeing about the
   * same question is worse than either being imperfect.
   */
  const bridged = input.orchestrationIntent
    ? orchestrationIntentToEnvelopeIntent(input.orchestrationIntent)
    : null
  const own = classifyEnvelopeIntent(message)
  /*
   * ⚠ EXCEPT FOR THE FIVE IT CANNOT EXPRESS. The orchestration taxonomy has no
   * historical / live / upcoming / gambling / action intent, so when this module
   * has identified one of those it must not be overridden by a fantasy label
   * that structurally cannot represent it.
   */
  const ownIsExclusive =
    own === 'historical_fact' ||
    own === 'live_fact' ||
    own === 'upcoming_schedule' ||
    own === 'unsupported_non_sports' ||
    own === 'action_request'
  const intent: EnvelopeIntent = ownIsExclusive ? own : (bridged ?? own)

  const sport =
    (isSupportedSport(input.sportHint) ? input.sportHint : null) ?? detectSport(message)

  const temporalScope = resolveTemporalScope(message, intent)
  const refusals: EnvelopeRefusal[] = []

  if (intent === 'unsupported_non_sports') {
    /*
     * The gambling branch. Ordinary sports analysis is unaffected — this fires
     * only on the wagering patterns, and FAAB/auction budgets are excluded from
     * them by construction.
     */
    refusals.push({
      code: 'gambling_request',
      message:
        'I do not help with wagers, betting lines or stake sizing. I can talk about the matchup, the projections and the uncertainty around them.',
      remedy: 'Ask about the matchup, player outlooks or league strategy instead.',
    })
    return {
      intent,
      sport,
      temporalScope,
      contextScope: resolveContextScope(intent, false),
      league: null,
      snapshot: null,
      refusals,
      resolvedFrom: null,
    }
  }

  const candidates = dedupeByPriority(input.candidates ?? [])

  /*
   * 🛑 AUTHORIZE, THEN COUNT — NOT THE OTHER WAY ROUND. Counting first and
   * refusing as ambiguous would leak the existence of leagues the user cannot
   * see: "you gave me two ids" is information about the second id. Every
   * candidate is authorized independently and only the survivors are counted.
   *
   * ⚠ AND A FAILED AUTHORIZATION IS INDISTINGUISHABLE FROM A NONEXISTENT
   * LEAGUE IN THE OUTPUT. `loadLeagueGroundingForUser` knows the difference and
   * the refusal deliberately does not repeat it.
   */
  const authorized: Array<{ candidate: LeagueCandidate; snapshot: ChimmyLeagueSnapshot }> = []
  if (input.userId) {
    for (const candidate of candidates) {
      const grounding = await loadLeagueGroundingForUser(input.userId, candidate.id)
      if (grounding.ok) authorized.push({ candidate, snapshot: grounding.snapshot })
    }
  }

  if (authorized.length === 0) {
    if (candidates.length > 0 && requiresLeague(intent)) {
      /*
       * ⚠ FAILS CLOSED. A league was named, none survived authorization, and the
       * question needs one. The message names no id and no reason.
       */
      refusals.push({
        code: 'not_authorized',
        message: 'I could not open that league for your account, so I will not guess about it.',
        remedy: 'Pick a league you are a member of and ask again.',
      })
    } else if (requiresLeague(intent)) {
      refusals.push({
        code: 'no_league_selected',
        message: 'That question is about a specific league, and I do not have one selected.',
        remedy: 'Choose a league and ask again.',
      })
    }
    return {
      intent,
      sport,
      temporalScope,
      contextScope: resolveContextScope(intent, false),
      league: null,
      snapshot: null,
      refusals,
      resolvedFrom: null,
    }
  }

  /*
   * Precedence: an explicit request beats an active selection beats the
   * conversation. Within one tier, more than one AUTHORIZED league is genuine
   * ambiguity and the user is asked.
   */
  for (const source of SOURCE_PRIORITY) {
    const tier = authorized.filter((a) => a.candidate.source === source)
    if (tier.length === 0) continue
    if (tier.length > 1) {
      refusals.push({
        code: 'ambiguous_league',
        message: `That could apply to ${tier.length} of your leagues, and they do not share rules or rosters, so one answer would be wrong for the others.`,
        remedy: 'Tell me which league you mean.',
      })
      return {
        intent,
        sport,
        temporalScope,
        contextScope: resolveContextScope(intent, false),
        league: null,
        snapshot: null,
        refusals,
        resolvedFrom: null,
      }
    }
    const chosen = tier[0]
    return {
      intent,
      sport: sport ?? (isSupportedSport(chosen.snapshot.sport) ? chosen.snapshot.sport : null),
      temporalScope,
      contextScope: resolveContextScope(intent, true),
      league: identityFrom(chosen.snapshot),
      snapshot: chosen.snapshot,
      refusals,
      resolvedFrom: source,
    }
  }

  /* Unreachable: `authorized` is non-empty and every entry carries a source. */
  return {
    intent,
    sport,
    temporalScope,
    contextScope: resolveContextScope(intent, false),
    league: null,
    snapshot: null,
    refusals,
    resolvedFrom: null,
  }
}
