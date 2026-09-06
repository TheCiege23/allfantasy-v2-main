import 'server-only'

import { createImportOsLoaders } from '../import-os'
import { createValueOsLoaders } from '../value-os'
import { createProjectionOsLoaders } from '../projection-os'
import { createLeagueOsLoaders } from '../league-os'
import { createPsychologyOsLoaders, type PsychologyProfileFact } from '../psychology-os'
import { ChimmyContextEngine } from '@/lib/chimmy-context/ChimmyContextEngine'
import {
  resolveCommissionerGroundingOutcome,
  type CommissionerGroundingOutcome,
} from '@/lib/intelligence/chimmy/resolveChimmyGrounding'
import { resolveLeagueIntelligenceGrounding } from '@/lib/intelligence/chimmy/leagueIntelligenceGrounding'
import {
  resolvePortfolioGrounding,
  type PortfolioGroundingOutcome,
} from '@/lib/intelligence/chimmy/portfolioGrounding'
/*
 * ⚠ TYPE-ONLY, AND THAT MATTERS. `decisionToSlice` imports `GroundedSlice` from this file, so a
 * value import here would close a runtime cycle. `import type` is erased at compile time, so the
 * cycle exists only in the type graph, where it is legal and inert.
 */
import type { DecisionFact } from './decisionToSlice'
import {
  loadLineupDecisionSlice,
  loadCommissionerHealthDecisionSlice,
  loadWaiverDecisionSlice,
} from './decisionBridge'
import { loadIdpKickerValueSlice, rosterSleeperIdsFrom, rosterPositionsFrom } from './idpKickerSlice'
import { loadRosterValueGradeSlice, type RosterValueGradeFact } from './rosterValueGradeSlice'
import { loadPsychologyConsistencySlice, type PsychologyConsistencyFact } from './psychologyConsistencySlice'
import { isConclusiveFor, type ConclusivenessVerdict, type FactProfileName } from '../conclusive'
import { resolveDecisionOsFeedFlags, type DecisionOsFeed } from '../flags'
import { loadSavedThreeBrainAnalysis } from './savedAnalysis'
import { stampLineupSlots, starterSlotsFromRules } from './stampLineupSlots'
import type { ImportAssertions } from '../import/assertions'
import type { ProjectionFact } from '../projection/facts'
import type { ValueLookup } from '../value/contract'

/**
 * `buildDecisionOsGroundingPacket` — the one object Chimmy reads (4.1, D1).
 *
 * ── 🛑 THIS SHAPE WAS NOT INVENTED. IT WAS READ OFF THE FIFTEEN ─────────────────────────────
 * The plan's own instruction was "do not design the packet without reading all 15 first", and the
 * fifteen are the specification: `ChimmyContextEngine`'s 12 providers and the 3
 * `lib/intelligence/chimmy/*` grounding resolvers. Two things were taken from them directly:
 *
 *   FROM `ChimmyContextBundle`  per-slice provenance. Its `meta.providers` already records
 *                               ok / cached / durationMs / error per provider, and slices are
 *                               nullable rather than defaulted. That was right and is kept.
 *   FROM `CommissionerGrounding` the `restricted` status — a PERMISSION gap. Neither the value
 *                               contract nor the import assertions had a notion of "this user may
 *                               not see it", and D8's "not entitled" reason would have been
 *                               missing from the taxonomy entirely without it.
 *
 * What the fifteen do NOT carry, and what this adds, is the pair D8 and D16 need: how OLD each
 * fact is, and whether it may be asserted at all.
 *
 * ── WHAT MAKES THIS DIFFERENT FROM A CONTEXT BUNDLE ─────────────────────────────────────────
 * A bundle answers "what do we know". A grounding packet answers "what may we SAY, and if not,
 * why not, and what would fix it". Every slice carries a {@link ConclusivenessVerdict} and, when
 * absent, a gap with a REMEDY — because "I can't tell you that" is a dead end and "your league
 * hasn't synced since Tuesday, reconnect it and I'll have this" is an answer.
 *
 * ⚠ AND THE PACKET NEVER FABRICATES A SLICE. An unavailable fact is `present: false` with a
 * reason, never an empty array or a zero. `lib/devy/devyValueBoard.ts` records what the other
 * choice costs: `DevyPlayer.devyValue` is zero-not-null for 1,455 of 1,718 players, so 85% of a
 * board renders an absence of data as a confident "worthless".
 */

export type GroundingGapReason =
  /** The league's import is stale, diverged, or incomplete for what this fact needs. */
  | 'not_synced'
  /** This user may not see it. Taken from `CommissionerGrounding.status === 'restricted'`. */
  | 'not_entitled'
  /** A producer exists for this sport and returned nothing — cold, unscheduled, out of window. */
  | 'not_computed'
  /** No producer exists for this sport at all. A fact about the world, not a TODO. */
  | 'no_producer'
  /** The player or manager could not be resolved onto the identity registry. */
  | 'unresolved_identity'
  /** The caller did not ask for this slice. Not a defect — assembling it would be waste. */
  | 'not_requested'
  /**
   * An operator has switched this feed off (5.3).
   *
   * 🛑 A SEVENTH REASON RATHER THAN REUSING `not_computed`, BECAUSE A KILL MUST NOT LOOK
   * LIKE A COLD CACHE. "It fills on the next run" is the remedy for a cold cache and it is a lie
   * about a killed feed — nothing will fill it until someone flips the switch back. Whoever is
   * reading a support ticket needs to be able to tell those apart, and so does the operator who
   * did the killing and then forgot.
   */
  | 'disabled'

export interface GroundingGap {
  reason: GroundingGapReason
  /** What is missing, in terms a user would recognise. */
  detail: string
  /** What would fix it. Never empty — see the header. */
  remedy: string
}

/**
 * One fact, with everything needed to decide whether to say it.
 *
 * ⚠ `present` AND `conclusive` ARE DIFFERENT QUESTIONS. A slice can be present and inconclusive
 * (we have the rosters, but they are two days stale), or absent and conclusive-in-principle
 * (nothing blocks it, we simply have no producer). Collapsing them loses the distinction D16 is
 * built on.
 */
export interface GroundedSlice<T> {
  present: boolean
  value: T | null
  /** When the underlying fact was captured. Null when unknown — never `now` as a stand-in. */
  asOf: string | null
  /** From the feed's own outcome: was this served warm, derived live, or unavailable. */
  servedFrom: 'store' | 'live' | 'unavailable' | null
  /** 0..1, or null when the producer does not express one. Never 0-as-unknown. */
  confidence: number | null
  conclusive: ConclusivenessVerdict
  gap: GroundingGap | null
}

/**
 * The eight `ChimmyContextEngine` slices that are FACTS or JUDGEMENTS, brought behind Decision OS
 * (4.3, D1). Each carries a conclusiveness verdict; the three that are identity or global lookups
 * deliberately do not appear here — see {@link ContextLookups}.
 *
 * ⚠ THE PROVIDERS ARE REUSED, NOT REIMPLEMENTED. `ChimmyContextEngine` already runs them under
 * `Promise.allSettled` with a per-provider TTL cache and timeout, and it has been doing so
 * correctly the whole time — it simply had no consumer on the chat path. Rewriting twelve
 * providers to "move them behind Decision OS" would have created twelve rivals to working code,
 * which is the mistake §2.14 and §2.16 both record. Decision OS wraps them and adds the two things
 * they cannot know: how stale the league's import is, and whether a claim may be made at all.
 */
export interface ContextFacts {
  matchup: GroundedSlice<unknown>
  roster: GroundedSlice<unknown>
  standings: GroundedSlice<unknown>
  rankings: GroundedSlice<unknown>
  leagueDifficulty: GroundedSlice<unknown>
  importedHistory: GroundedSlice<unknown>
  replayInsights: GroundedSlice<unknown>
  devy: GroundedSlice<unknown>
}

/**
 * The three slices that need no verdict, kept UNGRADED and structurally separate.
 *
 * 🛑 THE SEPARATION IS THE CENSUS MADE STRUCTURAL. `user` and `activeLeague` are identity — who is
 * asking and which league, not claims that can be stale or wrong. `sportsSchedule` is a global
 * fixture list that no league's import can bear on. Routing any of them through `isConclusive`
 * would attach a freshness caveat to a fact that has no freshness, and over-declaring dependencies
 * is exactly how the per-fact machinery decays back into a league-level boolean (see
 * `conclusive.ts`).
 */
export interface ContextLookups {
  user: unknown | null
  activeLeague: unknown | null
  sportsSchedule: unknown | null
}

export interface DecisionOsGroundingPacket {
  leagueId: string | null
  userId: string | null
  builtAt: string

  /** The freshness/parity/coverage/identity assertions every other slice is judged against. */
  importAssertions: GroundedSlice<ImportAssertions>
  leagueRules: GroundedSlice<unknown>
  marketValues: GroundedSlice<ValueLookup[]>
  devyValues: GroundedSlice<ValueLookup[]>
  projections: GroundedSlice<ProjectionFact[]>

  /** The eight graded context slices (4.3). Absent when no league is in scope. */
  contextFacts: ContextFacts | null
  /** The three ungraded lookups (4.3). Absent when no league is in scope. */
  contextLookups: ContextLookups | null

  /**
   * Commissioner intelligence (4.4) — the only slice with its OWN access rule, and therefore the
   * only real producer of `not_entitled`.
   *
   * ⚠ AI ENTITLEMENT IS NOT THIS. `SubscriptionContextSlice.hasAccess` gates the whole chat turn
   * upstream via `requireFeatureEntitlement`, so by the time a packet is built the user is already
   * entitled to talk to Chimmy at all. A per-slice `not_entitled` for that would never fire.
   * Commissioner intelligence is different: an entitled user may simply not be THIS league's
   * commissioner, which is a permission gap inside a permitted conversation.
   */
  commissionerIntelligence: GroundedSlice<string>

  /**
   * The other two `lib/intelligence/chimmy/*` resolvers (4.5), completing the fifteen.
   *
   * ⚠ BOTH COLLAPSE TO `string | null` AND ARE ABSORBED AS-IS, WHICH IS A DELIBERATE STOP.
   * `leagueIntelligenceGrounding` returns null for "not your league" AND for "no data";
   * `portfolioGrounding` for "no user" AND "no imported leagues". The commissioner resolver got a
   * reason-preserving variant in 4.4 because its permission case is one a user would recognise and
   * act on — "you are not this league's commissioner". These two are not: the route already runs
   * `assertLeagueMember` upstream, so their access branches are defensive rather than reachable in
   * normal use. Splitting them would add two unions to satisfy a symmetry nobody benefits from.
   */
  leagueIntelligence: GroundedSlice<string>
  portfolio: GroundedSlice<string>

  /**
   * Three-brain's SAVED conclusion for this league (6.2).
   *
   * 🛑 READ, NOT RUN, AND THAT IS MEASURED. `runThreeBrainAnalysis` is DeepSeek ∥ Grok →
   * OpenAI synthesis → optional Claude review at 25s PER PROVIDER — ~75s worst case against this
   * route's 3s ceiling. Calling it inline would be a switch nobody could turn on. The analyses are
   * already persisted in `decisionIntelligenceRun`, so this surfaces the conclusion deterministic
   * code already reached: one indexed read, no provider call, and P3 holds by construction.
   *
   * ⚠ `locked` becomes `not_entitled` — the SECOND real producer of that reason, which until now
   * only commissioner intelligence could raise.
   */
  /**
   * Manager behavioural profiles (R4b). LEAGUE-scoped: every manager in this league.
   *
   * ⚠ The scores inside are ALREADY EVIDENCE-GATED — null means "not enough observation to say",
   * never zero. `gateScores` decides that, not this packet, so there is one floor rather than two.
   */
  managerPsychology: GroundedSlice<PsychologyProfileFact[]>
  savedAnalysis: GroundedSlice<string>

  /*
   * ── R2 — THE BRIDGE FROM PIPELINE A ─────────────────────────────────────────────────────────
   *
   * Decisions from the four LIVE engines, adapted read-only by `decisionToSlice`. Until R2 these
   * engines were the half of the system that worked and that users saw, while sharing no code with
   * the half that feeds Chimmy.
   *
   * ⚠ OPTIONAL ON PURPOSE. Every existing construction site predates them, and a required field
   * would break each one at once; the serializer already tolerates a missing slice. Optional here
   * means "this build did not ask for a decision", which is exactly what `not_requested` says.
   *
   * 🛑 TRADE IS DELIBERATELY ABSENT. `decideTradeEvaluate` requires a `TradeProposalContext` — a
   * trade decision is PROPOSAL-scoped, and a general turn ("how does my roster look?") contains no
   * proposal. Adding a trade slice here would mean inventing one. The proposal-scoped path already
   * exists at `lib/chimmy-trade/pendingTradeDecisionGrounding.ts`.
   */
  lineupDecision?: GroundedSlice<DecisionFact>
  waiverDecision?: GroundedSlice<DecisionFact>
  commissionerHealthDecision?: GroundedSlice<DecisionFact>

  /**
   * R3.1 — IDP and kicker values, priced for this roster under this league's rules.
   *
   * ⚠ ROSTER-SCOPED, so unlike `marketValues` and `devyValues` it has no feed source and never
   * will: a linebacker is worth ~9 points under `balanced` scoring and roughly double under a
   * tackle-heavy setup, so these cannot be cached sport+format the way a market board can.
   */
  idpKickerValues?: GroundedSlice<ValueLookup[]>

  /**
   * R3.3 (2.2) — "Where am I weak?" in value terms: this roster's positions ranked against the
   * rest of the league by market value. Bridges `getRosterGrade` (`lib/core-app/rosterGrade.ts`),
   * the same playbook R2 used for the four live decision engines rather than re-deriving the math.
   */
  rosterValueGrade?: GroundedSlice<RosterValueGradeFact>

  /**
   * R4b.5 — cross-league + cross-sport psychology consistency, self only (P5/P7). Derived at
   * read, never cached — see `psychologyConsistencySlice.ts`.
   */
  psychologyConsistency?: GroundedSlice<PsychologyConsistencyFact>

  /**
   * Every gap on the packet, flattened.
   *
   * ⚠ SO A PROMPT DOES NOT HAVE TO WALK THE TREE TO FIND THEM. A gap that is technically present
   * three levels down but never surfaced is the same as no gap at all, and the no-fact rule (4.4)
   * depends on these being trivially reachable.
   */
  gaps: Array<{ slice: string } & GroundingGap>

  meta: {
    durationMs: number
    /** Time inside the single `ChimmyContextEngine.loadContext` call; null when no league is in scope. */
    engineMs: number | null
    /** Per-slice feed outcomes, mirroring `ChimmyContextBundle.meta.providers`. */
    sources: Array<{ slice: string; servedFrom: string | null; ok: boolean; ms: number | null }>
    /**
     * Feeds an operator has switched off (5.3).
     *
     * ⚠ ON THE PACKET AND NOT ONLY IN THE GAPS, because a feed killed while the question never
     * wanted it produces no gap at all — correctly, it would be noise. But an operator debugging
     * "why is this answer thin" still has to be able to see that a switch is down.
     */
    killedFeeds: string[]
  }
}

const NOT_REQUESTED: GroundingGap = {
  reason: 'not_requested',
  detail: 'This was not part of the question, so it was not assembled.',
  remedy: 'Ask about it and it will be gathered.',
}

/**
 * 🛑 EMPTINESS IS ABSENCE, NOT A FACT (5.2).
 *
 * The header above says an unavailable fact is `present: false` with a reason, "never an empty
 * array or a zero" — and until this predicate existed, nothing enforced it. `rows ? present(rows)`
 * takes `[]`, because `[]` is truthy. A cold league then produced a slice reading *available* with
 * nothing in it, the serializer rendered `- Projections: available`, and no gap was raised. That
 * is the devy board failure the header cites, one layer up: an absence of data rendered as a
 * confident nothing.
 *
 * ⚠ THE THREE `value-os` / `projection-os` SOURCES ALREADY COLLAPSE EMPTY TO NULL IN THEIR OWN
 * `derive` — so this hole was latent there, not live. It is enforced here anyway because that
 * convention is repeated by hand in three places, and a fourth source added without it would
 * reintroduce the bug silently. The live case was the context providers, which are
 * `ChimmyContextEngine`'s and obey no such convention.
 *
 * ⚠ ARRAYS AND STRINGS ONLY, DELIBERATELY. An empty object is a plausible emptiness too, but
 * `Object.keys` is empty for a class instance whose data lives on its prototype — so treating
 * `{}` as absent risks declaring a REAL fact missing, which is a lie in the more damaging
 * direction. Under-refusing is recoverable; fabricating an absence is not.
 */
/**
 * The `ChimmyContextEngine` provider names, spelled as the engine registers them.
 *
 * ── 🛑 THIS EXISTS BECAUSE TWO OF THEM WERE WRONG AND NOTHING SAID SO ───────────────────────
 * `grade()` looked its provider up by a plain `string`. Two calls missed — `'rankings'` for
 * `ranking`, `'importHistory'` for `importedHistory` — so `servedBy.get()` returned `undefined`
 * for both, every time, since the slices were written.
 *
 * A miss is indistinguishable from a healthy provider, which is why it survived:
 *   - `p?.cached` undefined  → `servedFrom` reported `'live'` for what may have been a cache hit
 *   - `p?.error` undefined   → a provider that THREW was reported as "no data is available for
 *                              this league", with the remedy for an empty league rather than the
 *                              remedy for a broken provider
 *
 * Both wrong in the reassuring direction. Same family as the `pgrep`-127 and the `\s+`→`s+`
 * regex already recorded in CLAUDE.md: a lookup that fails returns a plausible value.
 *
 * ⚠ The union is duplicated here rather than imported because `ChimmyContextEngine.providers` is
 * `private`, so `keyof …["providers"]` is not reachable from this module, and the exported
 * `ProviderName` in `intent/ProviderSelector.ts` is a DIFFERENT, SHORTER list (no `replayInsights`,
 * no `devy`) — using it would have type-errored the two slices that were spelled correctly.
 * `__tests__/decision-os/grounding-provider-names.test.ts` pins this against the engine's own
 * registry so the duplication cannot drift silently, which is the whole failure above.
 */
type EngineProviderName =
  | 'matchup'
  | 'roster'
  | 'standings'
  | 'ranking'
  | 'leagueDifficulty'
  | 'importedHistory'
  | 'replayInsights'
  | 'devy'

/**
 * The ONE place a packet slice key and its engine provider name differ, so `meta.sources[].ms` can
 * find its timing. Kept to genuine differences only — an entry per slice would be a second copy of
 * the registry, which is the duplication that produced the typos above in the first place.
 */
const SLICE_TO_PROVIDER: Record<string, EngineProviderName> = { rankings: 'ranking' }

/**
 * ⚠ A ROSTER WHOSE EVERY NAME IS ITS OWN PLAYER ID IS NOT A ROSTER — AND IT GRADED ITSELF FINE.
 *
 * `RosterContextProvider.toRosterPlayerLite` falls back to `?? playerId` when the upstream row
 * carries no name. Measured against a live dynasty league on 2026-09-01, all 27 players came back
 * as `{ playerId: '6804', name: '6804', position: 'UTIL', team: null }` — and the slice still
 * reported `present: true, conclusive: { ok: true }, gap: null`.
 *
 * That is precisely the P2 violation this packet exists to prevent: an unsourced value (a name we
 * do not have) rendered as a fact (a name). A model asked "should I start my flex" and handed that
 * has nothing to reason over and no way to tell.
 *
 * 🛑 IT IS GRADED PRESENT-BUT-INCONCLUSIVE, NOT ABSENT, AND THE DISTINCTION IS THE POINT. The
 * roster IS there — the counts, the depth, the starter/bench split are all real and worth having.
 * Dropping the slice would destroy true information to punish a false field. Present-but-
 * inconclusive is the shape `toEvidencePacket` already turns into a `not_safe_to_act_on` signal,
 * so this reaches three-brain as "you have a roster, you do not have who is on it".
 */
/**
 * Name each starter's lineup slot, when the league's template and the lineup provably agree.
 *
 * ⚠ THE ROSTER AND THE RULES ARE TWO SLICES AND THIS IS THE ONLY PLACE BOTH ARE IN HAND. The
 * slot vocabulary is a LEAGUE fact and the lineup is a ROSTER fact; joining them in the provider
 * would mean a second query for `leagueRules`, which this packet has already paid for. So the
 * join happens here, costs nothing, and `lib/decision-os/grounding/stampLineupSlots.ts` owns the
 * decision about whether the two are actually in correspondence.
 *
 * Silent on failure BY DESIGN: an unstamped starter keeps `slot: null`, which is exactly what it
 * carried before this existed. There is no regression available here — only a label that is
 * right or a label that is absent.
 */
function withStampedSlots(
  slice: GroundedSlice<unknown>,
  rulesValue: unknown,
): GroundedSlice<unknown> {
  if (!slice.present) return slice
  const v = slice.value as { starters?: unknown } | null
  if (!Array.isArray(v?.starters) || v.starters.length === 0) return slice
  const starters = v.starters as Array<{ position?: unknown; slot?: unknown }>

  const rosterRules = (rulesValue as { roster?: { starters?: unknown } } | null)?.roster
  const result = stampLineupSlots({
    starters: starters.map((p) => ({
      position: typeof p?.position === 'string' ? p.position : null,
      slot: typeof p?.slot === 'string' ? p.slot : null,
    })),
    starterSlots: starterSlotsFromRules(rosterRules?.starters),
  })
  if (!result.stamped) return slice

  /*
   * Writes `slot` onto the existing starter objects rather than rebuilding the value. The value
   * is `unknown` here, so a copy would have to guess at its shape and would drop any field this
   * function does not know about — and the same objects were already enriched in place by the
   * canonical-registry pass in RosterContextProvider. One request owns this bundle.
   */
  for (let i = 0; i < starters.length; i++) starters[i].slot = result.slots[i]
  return slice
}

function withResolvedIdentity(slice: GroundedSlice<unknown>): GroundedSlice<unknown> {
  if (!slice.present) return slice
  const v = slice.value as { starters?: unknown; bench?: unknown } | null
  const players = [
    ...(Array.isArray(v?.starters) ? v!.starters : []),
    ...(Array.isArray(v?.bench) ? v!.bench : []),
  ] as Array<{ playerId?: unknown; name?: unknown }>

  // No players at all is a different complaint, and `hasSubstance` already owns it.
  if (players.length === 0) return slice
  const named = players.filter((pl) => typeof pl?.name === 'string' && pl.name !== pl.playerId)
  if (named.length > 0) return slice

  const gap: GroundingGap = {
    reason: 'unresolved_identity',
    detail: `The roster holds ${players.length} players but none resolved to a name — every entry is its own player id.`,
    remedy: 'The league needs a player-identity re-sync; until then the roster can be counted but not read.',
  }
  /*
   * The blocker's assertion is `identity` — already a member of `ConclusivenessAssertion`, which
   * means this failure was anticipated by the conclusiveness model and simply never wired to a
   * producer. The gap and the blocker carry the same detail and remedy on purpose: a reader who
   * reaches this through `conclusive.blockedBy` and one who reaches it through `gap` must not be
   * told two different stories about the same fact.
   */
  return {
    ...slice,
    conclusive: {
      ok: false,
      blockedBy: [{ assertion: 'identity', detail: gap.detail, remedy: gap.remedy }],
    },
    gap,
  }
}

function hasSubstance<T>(v: T | null | undefined): v is T {
  if (v == null) return false
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'string') return v.trim().length > 0
  return true
}

function absent<T>(gap: GroundingGap, conclusive: ConclusivenessVerdict = { ok: true }): GroundedSlice<T> {
  return { present: false, value: null, asOf: null, servedFrom: null, confidence: null, conclusive, gap }
}

function present<T>(
  value: T,
  opts: { asOf?: string | null; servedFrom?: 'store' | 'live' | null; confidence?: number | null; conclusive: ConclusivenessVerdict },
): GroundedSlice<T> {
  return {
    present: true,
    value,
    asOf: opts.asOf ?? null,
    servedFrom: opts.servedFrom ?? null,
    confidence: opts.confidence ?? null,
    conclusive: opts.conclusive,
    gap: null,
  }
}

/**
 * A blocked verdict becomes a user-facing gap, carrying the blocker's OWN remedy.
 *
 * ⚠ NOT A GENERIC ONE. `isConclusive` adapts its remedy to the situation — it says "syncing has
 * failed 4 times, reconnecting usually clears it" rather than "try refreshing" when
 * `consecutiveFailures > 0`. Substituting a generic string here would throw that away at the last
 * step, and the specific remedy is the whole reason the refusal is useful.
 */
export function gapFromVerdict(v: ConclusivenessVerdict): GroundingGap | null {
  if (v.ok || v.blockedBy.length === 0) return null
  const first = v.blockedBy[0]!
  return { reason: 'not_synced', detail: first.detail, remedy: first.remedy }
}

/**
 * Flatten the gaps a packet should surface. PURE, and exported so the exclusion below is pinned.
 *
 * 🛑 `not_requested` IS EXCLUDED, AND THAT IS A DECISION RATHER THAN AN OVERSIGHT. It is not a gap
 * in what we KNOW, only in what was ASKED. Surfacing it would put "no devy board" on every NFL
 * answer and teach a reader to ignore the gap list — which is exactly how a real gap gets missed.
 */
export function collectGaps(
  slices: ReadonlyArray<readonly [string, GroundedSlice<unknown>]>,
): Array<{ slice: string } & GroundingGap> {
  return slices
    .filter(([, s]) => s.gap != null && s.gap.reason !== 'not_requested')
    .map(([slice, s]) => ({ slice, ...(s.gap as GroundingGap) }))
}

/**
 * Date a COLLECTION by its oldest member.
 *
 * 🛑 THIS REPLACED `facts[0]?.computedAt`, WHICH DATED 1,576 PROJECTIONS BY WHICHEVER ROW HAPPENED
 * TO LAND FIRST. Measured on production 2026-09-02: the packet announced "Projections: available
 * (13 days old)" while the newest `AFProjectionSnapshot` had been written the previous morning.
 * The rows span three weeks, they arrive in no guaranteed order, and an arbitrary element's
 * timestamp was being presented as the freshness of the whole slice.
 *
 * ⚠ OLDEST, NOT NEWEST — a single `asOf` cannot express a range, so the only real question is
 * which way to be wrong. This codebase already answered it: `ImportAssertions` carries BOTH
 * `lastAttemptedSyncAt` and `lastSuccessfulSyncAt` precisely so a surface cannot show the
 * flattering one and tell a user their league synced two minutes ago when it has been failing for
 * four days. Overstating age makes a model hedge more than it must; understating it makes a model
 * assert stale numbers as current. Only the first is recoverable.
 *
 * ⚠ Lexicographic comparison is correct AND intentional here: every `computedAt` in this codebase
 * is an ISO-8601 UTC string, which sorts chronologically as text. `Date.parse` would introduce a
 * `NaN` path for a malformed value that silently wins every comparison.
 */
export function oldestAsOf(rows: ReadonlyArray<{ computedAt?: string | null }>): string | null {
  let oldest: string | null = null
  for (const r of rows) {
    const c = r?.computedAt
    if (typeof c !== 'string' || c.length === 0) continue
    if (oldest === null || c < oldest) oldest = c
  }
  return oldest
}

/*
 * ⚠ MOVED to ./leagueValueFormat and RE-EXPORTED here, so every existing importer and test is
 * untouched. It moved because `lib/ai/deterministic.ts` needs the same derivation on a far hotter
 * path — it runs on every chat message — and importing it from THIS module would evaluate all 17
 * of packet.ts's imports, `ChimmyContextEngine` included, on messages that never build a packet.
 * One implementation, two callers, no second copy to drift.
 */
export { deriveValueFormat, deriveIdpRules, deriveWantsDevyBoard } from './leagueValueFormat'
import { deriveValueFormat, deriveIdpRules, deriveLeagueSizeAndPpr, deriveWantsDevyBoard } from './leagueValueFormat'

/**
 * Date the psychology slice by its OLDEST profile, for the same reason `oldestAsOf` exists:
 * a single `asOf` cannot express a range, and a model told the freshest date will treat the
 * stalest profile as equally current.
 */
function oldestPsychAsOf(rows: ReadonlyArray<{ updatedAt?: string | null }>): string | null {
  let oldest: string | null = null
  for (const r of rows) {
    const c = r?.updatedAt
    if (typeof c !== 'string' || c.length === 0) continue
    if (oldest === null || c < oldest) oldest = c
  }
  return oldest
}

export interface GroundingPacketArgs {
  leagueId?: string | null
  userId?: string | null
  sport: string
  season: number
  week?: number | null
  /** Market value format, when the question touches player prices. */
  valueFormat?: { format: string; qbFormat: string } | null
  /** The user's question, so the commissioner-intelligence intent gate can run. */
  question?: string | null
  /** This league's IDP rules, so projections arrive rescored. Null = canonical. */
  leagueIdpRules?: Record<string, number> | null
  /** Which slices the question actually needs. Omitted slices report `not_requested`. */
  want?: {
    values?: boolean
    devy?: boolean
    projections?: boolean
    leagueRules?: boolean
    /**
     * R2.4 — run the live lineup engine and carry its decision (default OFF).
     *
     * 🛑 OPT-IN, UNLIKE EVERY FLAG ABOVE IT, AND THE ASYMMETRY IS DELIBERATE. The others gate a
     * READ; this gates running a decision engine inside the chat route's latency ceiling. Costing
     * every turn a lineup decision — including the ones asking about trade values — is how the
     * packet went 5.4s over that ceiling before R0.8. A caller asks for this when the question is
     * about a lineup.
     */
    lineupDecision?: boolean
    /**
     * R2.3 — run the live commissioner-health engine (default OFF, and the most expensive slice
     * here). `getCommissionerHubHealthForUser` is TEN parallel queries, and the decision is only
     * meaningful to a commissioner, so it is opt-in twice over: the caller must ask, and the user
     * must actually commission the league.
     */
    commissionerHealthDecision?: boolean
    /**
     * R3.1 — IDP and kicker values for THIS roster (default OFF).
     *
     * 🛑 THE ONLY SLICE THAT CANNOT JOIN THE CONCURRENT WAVE. Every other producer takes `args`,
     * `leagueId` or `userId` — all known before assembly starts — so they all fire together. This
     * one needs the ROSTER, which means it cannot begin until the context engine has returned. It
     * is a serialized second hop by construction, which is why it is opt-in and why the cheap exit
     * in `loadIdpKickerValueSlice` matters: four leagues in five stop before any query.
     */
    idpKicker?: boolean
    /**
     * R3.3 (2.2) — roster value grade (default OFF). Joins the concurrent wave like the two
     * decision bridges above: it does its own DB reads and does not depend on the roster slice, so
     * unlike `idpKicker` it is not a serialized second hop — it is opt-in purely because it is a
     * real query cost (`getRosterGrade` reads every roster in the league to rank against), not
     * because of an ordering constraint.
     */
    rosterValueGrade?: boolean
    /**
     * R4b.5 — cross-league + cross-sport psychology consistency, self only (default OFF). Joins
     * the concurrent wave; opt-in because it is a real query cost (walks every league the caller
     * manages), not because of an ordering constraint.
     */
    psychologyConsistency?: boolean
    /**
     * R2.6 — the waiver claim decision (default OFF).
     *
     * 🛑 ASKING FOR THIS TODAY GETS AN HONEST GAP, NOT A DECISION. There is no producer: the
     * waiver engine at `lib/decision-os/waiver/` is a WRAP-FIDELITY wrapper over the legacy
     * `/api/waiver-ai/engine` output, and the input it needs — `availablePlayers`, the waiver
     * wire pool — is supplied by that route and is not available from
     * `loadWaiverWorldFacts`. So the flag exists to make the absence VISIBLE to a caller who
     * wanted it, not to switch on work that happens.
     *
     * ⚠ IT IS STILL OPT-IN, AND THAT IS THE POINT. An always-surfaced "no waiver decision"
     * would put the same line on every answer and teach a reader to skim the gap block — the
     * exact failure `not_requested` is excluded for, and the one R1.6 just spent a commit
     * fixing. Unasked, it stays `not_requested` and never renders.
     */
    waiverDecision?: boolean
  }
}

/**
 * Assemble the packet.
 *
 * ⚠ EVERY READ IS ISOLATED. One slow or failing producer must never take the packet down —
 * `Promise.allSettled` semantics via per-slice catch, the same reason `ChimmyContextEngine` runs
 * its providers that way. A failed slice becomes an honest gap, not an exception.
 */
export async function buildDecisionOsGroundingPacket(
  args: GroundingPacketArgs,
): Promise<DecisionOsGroundingPacket> {
  const startedAt = Date.now()
  const want = args.want ?? { values: true, projections: true, leagueRules: true }
  const leagueId = args.leagueId ?? null

  /*
   * ⚠ ONE RESOLUTION PER PACKET, NOT ONE PER SLICE. A flag that changed midway through assembly
   * would produce a packet gathered under two different policies with nothing recording that it
   * happened. Steady state is zero queries — see `flags.ts` on why this is batched and cached
   * rather than nine `getBoolean` calls inside the chat route's 3-second ceiling.
   */
  const flags = await resolveDecisionOsFeedFlags()
  const killed = (feed: DecisionOsFeed): GroundingGap | null =>
    flags.enabled(feed)
      ? null
      : {
          reason: 'disabled',
          detail: `The ${feed} feed is switched off.`,
          // Honest about there being nothing the USER can do. An invented "try again" would be
          // worse than saying so — the same call the not_entitled remedy makes.
          remedy: 'An operator disabled it; it returns when they switch it back on.',
        }

  const importOs = createImportOsLoaders()
  const valueOs = createValueOsLoaders()
  const projectionOs = createProjectionOsLoaders()
  const leagueOs = createLeagueOsLoaders()
  const psychologyOs = createPsychologyOsLoaders()

  /*
   * ⚠ `meta.durationMs` ALONE CANNOT BE ACTED ON, WHICH IS WHY THESE EXIST.
   *
   * The proof surface measured 5354ms, 6178ms and 5442ms against the chat route's 3000ms ceiling
   * on live leagues (2026-09-01) — so Chimmy paid to build this packet and discarded it on every
   * turn, which from outside is indistinguishable from the feature being switched off. A single
   * total says that is happening and nothing about where to cut.
   *
   * `engineMs` splits the one `loadContext` call from everything else, and `sliceMs` carries a
   * per-slice figure. Together they turn "it is too slow" into a named cause.
   */
  const sliceMs = new Map<string, number | null>()
  let engineMs: number | null = null

  /*
   * ── 🛑 THE PACKET WAS A WATERFALL, AND THAT WAS THE WHOLE 5.4 SECONDS ──────────────────
   *
   * Measured on a live 8-team dynasty league once `engineMs` existed to split it:
   *
   *     buildMs   5441
   *     engineMs   457   ← twelve context providers, ALREADY concurrent inside the engine
   *     the rest  4984   ← eight independent reads, each awaited after the last one finished
   *
   * ⚠ AND THE OBVIOUS SUSPECT WAS WRONG, WHICH IS WHY IT WAS MEASURED BEFORE ANYTHING WAS CUT.
   * The `ranking` provider returns difficulty ratings for ~400 leagues and dominates the payload;
   * it costs 166ms. Removing it would have bought 3% and left the packet over the ceiling. The
   * engine had the right shape all along — one `allSettled`, twelve providers, 457ms — and the
   * builder wrapped around it did not.
   *
   * None of these reads consumes another's result: every argument is `args`, `leagueId` or
   * `userId`, all known here. So they START here, together, and each `await` below stays exactly
   * where it was — the grading is untouched and still reads top to bottom in slice order.
   *
   * `flags` is the one true dependency and is already awaited above: it decides which of these may
   * run at all, and a feed gathered then discarded would be a killed feed that still cost a query.
   */
  const kick = <T,>(slice: string, promise: Promise<T>): Promise<T> => {
    const startedAt = Date.now()
    return promise.then((value) => {
      sliceMs.set(slice, Date.now() - startedAt)
      return value
    })
  }

  const importKill = killed('importAssertions')
  const rulesKill = killed('leagueRules')
  const marketKill = killed('marketValues')
  const devyKill = killed('devyValues')
  const projectionKill = killed('projections')
  const contextKill = killed('contextFacts')
  const commishKill = killed('commissionerIntelligence')
  const leagueIntelKill = killed('leagueIntelligence')
  const portfolioKill = killed('portfolio')
  const psychologyKill = killed('managerPsychology')
  const lineupDecisionKill = killed('lineupDecision')
  const commishHealthKill = killed('commissionerHealthDecision')
  const idpKickerKill = killed('idpKickerValues')
  const rosterValueGradeKill = killed('rosterValueGrade')
  const psychologyConsistencyKill = killed('psychologyConsistency')

  const pAssertions =
    leagueId && !importKill
      ? kick('importAssertions', importOs.loadAssertions(leagueId).catch(() => null))
      : Promise.resolve(null)

  const pRules =
    want.leagueRules && leagueId && !rulesKill
      ? kick('leagueRules', leagueOs.loadRules(leagueId).catch(() => null))
      : Promise.resolve(null)

  /*
   * ⚠ THE ONE DELIBERATE DEPENDENCY IN AN OTHERWISE FLAT ASSEMBLY (R1.2).
   *
   * Everything else here starts together because nothing consumes another's result. These two do:
   * the market format and this league's IDP scoring are both READ OFF the rules. That costs one
   * hop — and `leagueRules` is served from the store in ~765ms against ~1250ms of measured
   * headroom (R0.10), so it fits.
   *
   * An explicit argument still wins and stays fully parallel, which is why the resolution is a
   * promise rather than an await: a caller that already knows the format pays nothing for this.
   */
  const pValueFormat: Promise<{ format: string; qbFormat: string } | null> = args.valueFormat
    ? Promise.resolve(args.valueFormat)
    : pRules.then(deriveValueFormat).catch(() => null)

  const pMarket =
    want.values && !marketKill
      ? kick(
          'marketValues',
          pValueFormat.then((vf) =>
            vf
              ? valueOs
                  .loadMarket({ sport: args.sport, format: vf.format, qbFormat: vf.qbFormat })
                  .catch(() => null)
              : null,
          ),
        )
      : Promise.resolve(null)

  /*
   * ⚠ Gated on `leagueId` because a profile is per (league, manager) — with no league there is
   * nothing to look up, and firing it would spend a query to learn that.
   */
  const pPsychology =
    leagueId && !psychologyKill
      ? kick('managerPsychology', psychologyOs.loadProfiles({ leagueId, sport: args.sport }).catch(() => null))
      : Promise.resolve(null)

  /*
   * R2.4 — the lineup decision, bridged from the live engine.
   *
   * ⚠ STARTED HERE WITH THE OTHERS, NOT AWAITED HERE. It joins the same concurrent wave the
   * waterfall fix established: none of these reads consumes another's result, so they all start
   * together and each `await` stays in slice order below. An engine run awaited in sequence would
   * put the packet straight back over the ceiling R0.8 measured.
   *
   * ⚠ `.catch` IS INSIDE THE BRIDGE, not here. `loadLineupDecisionSlice` returns an honest gap
   * slice rather than throwing, so unlike the loaders above it never resolves to null — which is
   * why the assembly below reads it directly instead of testing for substance.
   */
  const pLineupDecision =
    want.lineupDecision && !lineupDecisionKill
      ? kick('lineupDecision', loadLineupDecisionSlice({ userId: args.userId, leagueId }))
      : Promise.resolve(null)

  /*
   * R2.3 — the commissioner health decision. Same wave, same rules as the lineup bridge.
   *
   * ⚠ THE PERMISSION CHECK LIVES IN THE BRIDGE, NOT HERE, and deliberately so: it is the same
   * `assertLeagueCommissioner` the commissionerIntelligence slice already uses, and duplicating a
   * permission rule in two places is how the two copies drift apart.
   */
  const pCommishHealth =
    want.commissionerHealthDecision && !commishHealthKill
      ? kick('commissionerHealthDecision', loadCommissionerHealthDecisionSlice({ userId: args.userId, leagueId }))
      : Promise.resolve(null)

  /*
   * R2.6 — the waiver claim decision. Same wave, same rules as the two bridges above.
   *
   * 🛑 KICKED HERE RATHER THAN AWAITED AT THE ASSIGNMENT, and that is not a style choice. This
   * producer reads the league's rosters AND the sport's player pool before running an engine — the
   * most expensive slice in the packet. Awaited inline down in the assembly it would run strictly
   * after every other producer had finished, turning parallel work into a serial tail. In this wave
   * it overlaps with them and costs roughly its own slowest read.
   */
  const pWaiverDecision = want.waiverDecision
    ? kick('waiverDecision', loadWaiverDecisionSlice({ userId: args.userId, leagueId }))
    : Promise.resolve(null)

  /*
   * R3.3 (2.2) — roster value grade. Same wave, same rules: its own DB reads, no dependency on the
   * roster slice, so it joins the concurrent wave rather than serialising behind context like
   * `idpKicker` does.
   */
  const pRosterValueGrade =
    want.rosterValueGrade && !rosterValueGradeKill
      ? kick('rosterValueGrade', loadRosterValueGradeSlice({ userId: args.userId, leagueId }))
      : Promise.resolve(null)

  /*
   * R4b.5 — cross-league + cross-sport psychology. Same wave, same rules: its own DB reads, no
   * dependency on any other slice.
   */
  const pPsychologyConsistency =
    want.psychologyConsistency && !psychologyConsistencyKill
      ? kick('psychologyConsistency', loadPsychologyConsistencySlice({ userId: args.userId, leagueId }))
      : Promise.resolve(null)

  /*
   * R1.5 — devy is requested for NCAAF, OR for a league whose VARIANT says it rosters college
   * players (a C2C / devy-slot NFL dynasty league). The sport test alone missed the second kind.
   *
   * ⚠ THE NCAAF PATH IS UNCHANGED AND STAYS FULLY PARALLEL. When the caller already asked for
   * devy this resolves immediately and the load kicks with the rest of the wave — exactly the
   * escape `pValueFormat` gives a caller who supplies `args.valueFormat`. Only the case that
   * previously got NOTHING pays the one hop off `pRules`, and it is the same hop the market lane
   * already pays for the same reason.
   */
  const pWantsDevy: Promise<boolean> = want.devy
    ? Promise.resolve(true)
    : pRules.then(deriveWantsDevyBoard).catch(() => false)

  const pDevy = !devyKill
    ? kick(
        'devyValues',
        pWantsDevy.then((wants) =>
          wants
            ? valueOs.loadDevy({ sport: args.sport, currentSeason: args.season }).catch(() => null)
            : null,
        ),
      )
    : Promise.resolve(null)

  /*
   * ⚠ `undefined` AND `null` MEAN DIFFERENT THINGS HERE, AND THE DISTINCTION IS LOAD-BEARING.
   * `null` is a caller saying "give me the canonical value" — legitimate, and `ProjectionFact.
   * rescored: false` reports it honestly. `undefined` is a caller with no opinion, which is every
   * caller today, and is what this derivation is for. Collapsing them with `??` would make an
   * explicit request for canonical numbers silently return league-scored ones.
   */
  const pIdpRules: Promise<Record<string, number> | null> =
    args.leagueIdpRules !== undefined
      ? Promise.resolve(args.leagueIdpRules)
      : pRules.then(deriveIdpRules).catch(() => null)

  const pProjections = want.projections && !projectionKill
    ? kick(
        'projections',
        pIdpRules.then((idp) =>
          projectionOs
            .loadFor({ sport: args.sport, season: args.season, week: args.week ?? null }, idp)
            .catch(() => null),
        ),
      )
    : Promise.resolve(null)

  const pCommissioner =
    leagueId && args.userId && !commishKill
      ? kick(
          'commissionerIntelligence',
          resolveCommissionerGroundingOutcome({
            leagueId,
            userId: args.userId,
            question: args.question ?? null,
          }).catch((): CommissionerGroundingOutcome => ({ status: 'unavailable' })),
        )
      : null

  const pSavedAnalysis =
    leagueId && args.userId && flags.enabled('savedAnalysis')
      ? kick(
          'savedAnalysis',
          loadSavedThreeBrainAnalysis({
            leagueId,
            userId: args.userId,
            tool: 'mission_control',
            decisionType: 'league_health',
          }).catch(() => ({ status: 'not_computed', reason: 'loader_threw' }) as const),
        )
      : null

  const pLeagueIntel =
    leagueId && args.userId && !leagueIntelKill
      ? kick(
          'leagueIntelligence',
          resolveLeagueIntelligenceGrounding({ leagueId, userId: args.userId }).catch(() => null),
        )
      : Promise.resolve(null)

  /*
   * ⚠ THE SLOWEST SLICE, SO THE ONE THAT MOST NEEDED HOISTING — AND THE ONE I MISSED FIRST TIME.
   * It sat in a trailing `Promise.all`, starting only once the other nine had finished.
   */
  const pPortfolio =
    args.userId && !portfolioKill
      ? kick(
          'portfolio',
          resolvePortfolioGrounding({ userId: args.userId }).catch(
            () => ({ status: 'empty' }) as PortfolioGroundingOutcome,
          ),
        )
      : Promise.resolve(null)

  // ── The assertions first: everything else is judged against them. ─────────────────────────
  const assertions = await pAssertions

  const importSlice: GroundedSlice<ImportAssertions> = importKill
    ? absent<ImportAssertions>(importKill)
    : assertions
    ? present(assertions, {
        asOf: assertions.lastSuccessfulSyncAt,
        servedFrom: 'store',
        conclusive: { ok: true },
      })
    : absent<ImportAssertions>({
        reason: leagueId ? 'not_computed' : 'not_requested',
        detail: leagueId
          ? 'No import state could be read for this league.'
          : 'No league was in scope for this question.',
        remedy: leagueId ? 'A sync will create it; native AllFantasy leagues never have one.' : 'Name a league.',
      })

  const verdictFor = (profile: FactProfileName): ConclusivenessVerdict =>
    isConclusiveFor(profile, assertions)

  // ── League rules ──────────────────────────────────────────────────────────────────────────
  let leagueRules: GroundedSlice<unknown> = absent(NOT_REQUESTED)
  if (want.leagueRules && leagueId && rulesKill) leagueRules = absent(rulesKill)
  else if (want.leagueRules && leagueId) {
    const rules = await pRules
    const v = verdictFor('leagueRules')
    leagueRules = rules
      ? present(rules, { servedFrom: 'store', conclusive: v })
      : absent({
          reason: 'not_computed',
          detail: 'This league\'s rules could not be resolved.',
          remedy: 'Check the league still exists and has settings; a re-import rebuilds them.',
        }, v)
  }

  // ── Market values ─────────────────────────────────────────────────────────────────────────
  let marketValues: GroundedSlice<ValueLookup[]> = absent(NOT_REQUESTED)
  if (want.values && marketKill) marketValues = absent(marketKill)
  else if (want.values) {
    const v = verdictFor('globalPlayerValue') // global — no league import can block it
    const vf = await pValueFormat
    const rows = await pMarket
    if (!vf) {
      // ⚠ A DISTINCT REASON FROM "no values held". The market is fine; we could not work out
      // which of its four format buckets to read, which is a LEAGUE-side gap with a different
      // remedy. Collapsing it into `not_computed` would send someone to look at the wrong system.
      marketValues = absent({
        reason: 'not_computed',
        detail: "This league's format could not be resolved, so no market bucket could be chosen.",
        remedy: 'Re-import the league so its settings and starting slots are rebuilt.',
      }, v)
    } else {
      marketValues = hasSubstance(rows)
        ? present(rows, { servedFrom: 'store', conclusive: v })
        : absent({
            reason: 'not_computed',
            detail: `No market values are held for ${args.sport} in ${vf.format}/${vf.qbFormat}.`,
            remedy: 'They refresh daily; a cold cache fills on the next run.',
          }, v)
    }
  }

  // ── Devy values ───────────────────────────────────────────────────────────────────────────
  /*
   * R1.5 — gated on the RESOLVED eligibility, not on `want.devy`.
   *
   * 🛑 GATING THE LOAD ALONE WAS NOT ENOUGH, AND THE WIRING TEST IS WHAT CAUGHT IT. The first
   * version of this change chained the FETCH off the rules but left this block reading
   * `want.devy`, so a devy-variant league fetched the board and then threw it away as
   * `not_requested`. Both halves have to consult the same answer.
   */
  const wantsDevy = await pWantsDevy
  /*
   * Whether the BOARD APPLIES at all, which is what the failure wording turns on. An NCAAF
   * league and a devy-variant league both roster college players, so an empty result means "the
   * board is empty" for either. Only a league that never wanted it gets "no such model".
   */
  /*
   * ⚠ `wantsDevy` ALONE IS THE WRONG TEST, AND AN EXISTING SUITE CAUGHT IT. A caller passing
   * `want.devy` for a sport with no model does not make a model exist — that case must still
   * read `no_producer`, which is what "does not claim it is merely cold" asserts. So the board
   * applies only when the sport is NCAAF, or when the VARIANT said so: if the caller did not ask
   * and `wantsDevy` still resolved true, it can only have come from `deriveWantsDevyBoard`.
   */
  const devyBoardApplies = args.sport.toUpperCase() === 'NCAAF' || (!want.devy && wantsDevy)
  let devyValues: GroundedSlice<ValueLookup[]> = absent(NOT_REQUESTED)
  if (wantsDevy && devyKill) devyValues = absent(devyKill)
  else if (wantsDevy) {
    const v = verdictFor('globalPlayerValue')
    const rows = await pDevy
    devyValues = hasSubstance(rows)
      ? present(rows, { servedFrom: 'store', conclusive: v })
      : absent({
          reason: devyBoardApplies ? 'not_computed' : 'no_producer',
          detail: devyBoardApplies
            ? 'The devy board is empty for this season.'
            : `There is no devy valuation model for ${args.sport}. The board is college football only.`,
          remedy: devyBoardApplies
            ? 'The pool seeds on the import-players cron; it fills on the next run.'
            : 'Nothing to fix — no such model exists.',
        }, v)
  }

  // ── Projections ───────────────────────────────────────────────────────────────────────────
  let projections: GroundedSlice<ProjectionFact[]> = absent(NOT_REQUESTED)
  if (want.projections && projectionKill) projections = absent(projectionKill)
  else if (want.projections) {
    const v = verdictFor('lineupDecision')
    const facts = await pProjections
    if (!hasSubstance(facts)) {
      projections = absent({
        reason: 'not_computed',
        detail: `No projections are held for ${args.sport} ${args.season}${args.week ? ` week ${args.week}` : ''}.`,
        remedy: 'They compute daily; a cold cache fills on the next run.',
      }, v)
    } else {
      // ⚠ Present but possibly INCONCLUSIVE: we have the numbers, the league may be too stale to
      // act on them. The verdict travels with the slice rather than gating its presence.
      const slice = present(facts, { asOf: oldestAsOf(facts), servedFrom: 'store', conclusive: v })
      projections = v.ok ? slice : { ...slice, gap: gapFromVerdict(v) }
    }
  }

  // ── The eight graded context slices, and the three ungraded lookups (4.3) ─────────────────
  let contextFacts: ContextFacts | null = null
  let contextLookups: ContextLookups | null = null
  /*
   * ⚠ `meta.durationMs` ALONE CANNOT BE ACTED ON, WHICH IS WHY THESE EXIST.
   *
   * The proof surface measured 5354ms and 6178ms against the chat route's 3000ms ceiling on two
   * live leagues (2026-09-01) — so Chimmy pays to build this packet and then discards it on every
   * turn, which from outside is indistinguishable from the feature being switched off. A single
   * total says that is happening and nothing about where to cut.
   *
   * `engineMs` splits the one `loadContext` call from everything else, and `sliceMs` carries the
   * engine's OWN per-provider `durationMs` — already measured, previously thrown away. Together
   * they turn "it is too slow" into a named provider, which is the difference between fixing this
   * and guessing at it.
   */

  if (args.userId && leagueId && contextKill) {
    // Killed, not missing — all eight say so rather than vanishing, per §2.20.
    contextFacts = {
      matchup: absent(contextKill),
      roster: absent(contextKill),
      standings: absent(contextKill),
      rankings: absent(contextKill),
      leagueDifficulty: absent(contextKill),
      importedHistory: absent(contextKill),
      replayInsights: absent(contextKill),
      devy: absent(contextKill),
    }
  } else if (args.userId && leagueId) {
    /*
     * ⚠ ONE ENGINE CALL, NOT TWELVE. `loadContext` already runs its providers concurrently under
     * allSettled with a per-provider TTL cache and timeout. Calling it once and grading the result
     * is what "moving the providers behind Decision OS" means; calling each provider separately
     * would discard the caching and the isolation it already does correctly.
     */
    const engineStartedAt = Date.now()
    const bundle = await new ChimmyContextEngine()
      .loadContext({ userId: args.userId, leagueId, week: args.week ?? null })
      .catch(() => null)
    engineMs = Date.now() - engineStartedAt

    if (bundle) {
      // `meta.providers[].cached` is the engine's own answer to "was this served warm".
      const servedBy = new Map(bundle.meta.providers.map((p) => [p.name, p]))
      const grade = (
        name: EngineProviderName,
        value: unknown,
        profile: FactProfileName,
      ): GroundedSlice<unknown> => {
        const p = servedBy.get(name)
        sliceMs.set(name, p?.durationMs ?? null)
        if (!hasSubstance(value)) {
          /*
           * ⚠ THE REASON IS `not_computed` EITHER WAY, AND THAT IS CORRECT RATHER THAN LAZY: a
           * producer exists for this and returned nothing, which is exactly what the reason means.
           * It was previously written as a ternary with the SAME value in both branches — a dead
           * expression that reads as a distinction being made. The distinction is real, but it
           * lives in the detail and the remedy, so it is made there and only there.
           */
          const failed = p?.error != null
          return absent({
            reason: 'not_computed',
            detail: failed
              ? `The ${name} provider failed: ${String(p!.error).slice(0, 120)}`
              : `No ${name} data is available for this league.`,
            remedy: failed
              ? 'It is retried on the next question; if it keeps failing the league needs a re-sync.'
              : 'A league re-sync refreshes it; a league with no recorded activity yet stays empty.',
          })
        }
        const v = verdictFor(profile)
        const slice = present(value, { servedFrom: p?.cached ? 'store' : 'live', conclusive: v })
        return v.ok ? slice : { ...slice, gap: gapFromVerdict(v) }
      }

      /*
       * Profile choices, each the narrowest true dependency — over-declaring rebuilds the
       * league-level boolean `conclusive.ts` exists to avoid.
       *
       *   matchup / roster   lineupDecision   act-on-it-now data; 2h and needs parity
       *   standings / rankings / difficulty   standings   derived from rosters, tolerates lag
       *   importedHistory / replay            managerBehaviour   claims ABOUT a manager
       *   devy                                globalPlayerValue  a global board; no league
       *                                                          import can bear on it
       */
      contextFacts = {
        matchup: grade('matchup', bundle.matchup, 'lineupDecision'),
        roster: withStampedSlots(
          withResolvedIdentity(grade('roster', bundle.roster, 'lineupDecision')),
          leagueRules.present ? leagueRules.value : null,
        ),
        standings: grade('standings', bundle.standings, 'standings'),
        rankings: grade('ranking', bundle.rankings, 'standings'),
        leagueDifficulty: grade('leagueDifficulty', bundle.leagueDifficulty, 'standings'),
        importedHistory: grade('importedHistory', bundle.importedHistory, 'managerBehaviour'),
        replayInsights: grade('replayInsights', bundle.replayInsights, 'managerBehaviour'),
        devy: grade('devy', bundle.devy, 'globalPlayerValue'),
      }

      contextLookups = {
        user: bundle.user,
        activeLeague: bundle.activeLeague,
        sportsSchedule: bundle.sportsSchedule,
      }
    } else {
      /*
       * 🛑 THE WORST DEGRADATION IN THIS FILE, AND IT WAS SILENCE RATHER THAN A ZERO (5.2).
       *
       * `loadContext` is one call behind twelve providers. When IT throws — not a provider, the
       * engine — the catch above turned eight facts into `contextFacts = null`, and because the
       * gap list is built by walking `contextFacts`, the packet then carried ZERO gaps for them.
       * The serializer renders neither an availability line nor a missing line, so the model was
       * handed a complete-LOOKING picture with matchup, roster, standings, rankings, difficulty,
       * history, replay and the devy board quietly absent.
       *
       * An absent fact that announces itself is recoverable. An absent fact that does not is the
       * single failure mode this packet exists to prevent, so the eight are materialised as named
       * gaps instead.
       */
      const engineDown: GroundingGap = {
        reason: 'not_computed',
        detail: 'League context could not be assembled — the context engine did not return.',
        remedy: 'Ask again; if it persists, re-sync the league and the providers rebuild from it.',
      }
      contextFacts = {
        matchup: absent(engineDown),
        roster: absent(engineDown),
        standings: absent(engineDown),
        rankings: absent(engineDown),
        leagueDifficulty: absent(engineDown),
        importedHistory: absent(engineDown),
        replayInsights: absent(engineDown),
        devy: absent(engineDown),
      }
    }
  }

  // ── Commissioner intelligence (4.4): the one slice with its own access rule ────────────────
  let commissionerIntelligence: GroundedSlice<string> = absent(NOT_REQUESTED)
  if (leagueId && args.userId && commishKill) commissionerIntelligence = absent(commishKill)
  else if (leagueId && args.userId) {
    const outcome = (await pCommissioner) ?? ({ status: 'unavailable' } as CommissionerGroundingOutcome)

    if (outcome.status === 'ok') {
      commissionerIntelligence = present(outcome.text, {
        servedFrom: 'live',
        conclusive: verdictFor('managerBehaviour'),
      })
    } else if (outcome.status === 'not_entitled') {
      commissionerIntelligence = absent({
        reason: 'not_entitled',
        detail: 'Commissioner intelligence for this league is only available to its commissioner.',
        // ⚠ A remedy that is honest about there being nothing the user can do themselves. An
        // invented "try again" here would be worse than saying so.
        remedy: 'Ask the league commissioner, who can see it.',
      })
    } else if (outcome.status === 'unavailable') {
      commissionerIntelligence = absent({
        reason: 'not_computed',
        detail: 'Commissioner intelligence was requested and could not be produced.',
        remedy: 'It is retried on the next question; recorded league activity also has to exist for it.',
      })
    }
    // `not_asked` leaves NOT_REQUESTED, which collectGaps excludes — the question was not about it.
  }

  // ── The other two resolvers (4.5) ─────────────────────────────────────────────────────────
  /*
   * ⚠ THESE TWO WERE NOT ACTUALLY HOISTED, AND THE MEASUREMENT CAUGHT THE CLAIM.
   *
   * The parallelisation commit said "all ten reads start together". Eight did. These two kept
   * their `Promise.all` HERE, at the end of the builder, and only gained `kick()` timing — so
   * they still began after everything else had finished. The proof surface showed it plainly:
   * ~1700ms of everything else, then portfolio's 4500ms starting from cold, total 6203ms.
   *
   * A `Promise.all` looks like parallelism and is, between its own members — but it starts when
   * control reaches it, which is the thing that mattered here.
   */
  const [leagueIntelText, portfolioOutcome] = await Promise.all([pLeagueIntel, pPortfolio])

  const leagueIntelligence: GroundedSlice<string> = leagueIntelKill
    ? absent<string>(leagueIntelKill)
    : hasSubstance(leagueIntelText)
    ? present(leagueIntelText, { servedFrom: 'live', conclusive: verdictFor('standings') })
    : absent({
        reason: 'not_computed',
        detail: 'No league intelligence brief could be built for this league.',
        remedy: 'It needs recorded league activity — trades, matchups, valuations — to summarise.',
      })

  /*
   * Manager psychology (R4b).
   *
   * ⚠ `managerBehaviour` IS THE RIGHT PROFILE AND IT ALREADY EXISTED. It requires manager identity
   * and bounds staleness at 24h — a profile is about WHO a manager is, so an unresolved identity
   * makes the claim meaningless, and a day-old read of years of behaviour is still current.
   * Nothing new was added to the conclusiveness taxonomy for this.
   *
   * 🛑 `anySufficient` IS THE PRESENCE TEST, NOT `length > 0`. A league can hold twelve profiles
   * that every one of them is below its evidence floor — rows exist, and there is nothing that may
   * honestly be said. Grading that PRESENT would put twelve managers of null scores in front of a
   * model and invite it to characterise them anyway, which is the "[] presented as available"
   * failure §5.2 exists to prevent, reached through a non-empty array.
   */
  /*
   * R2.4 — the bridged lineup decision.
   *
   * ⚠ THREE STATES, AND THE THIRD IS THE ONE WORTH NAMING. A killed feed and an unrequested one
   * are different absences: `disabled` says an operator switched it off and the user can do
   * nothing, `not_requested` says the question did not call for a lineup decision and assembling
   * one would be waste. Collapsing them would report an operator action as a user's phrasing.
   */
  const lineupDecisionSlice = await pLineupDecision
  const lineupDecision: GroundedSlice<DecisionFact> = lineupDecisionKill
    ? absent<DecisionFact>(lineupDecisionKill)
    : lineupDecisionSlice ??
      absent<DecisionFact>({
        reason: 'not_requested',
        detail: 'This question did not call for a lineup decision.',
        remedy: 'Ask about your lineup and the deterministic engine runs.',
      })

  const commissionerHealthDecision: GroundedSlice<DecisionFact> = commishHealthKill
    ? absent<DecisionFact>(commishHealthKill)
    : (await pCommishHealth) ??
      absent<DecisionFact>({
        reason: 'not_requested',
        detail: 'This question did not call for a league health decision.',
        remedy: 'Ask about your league’s health and the deterministic engine runs.',
      })

  const rosterValueGrade: GroundedSlice<RosterValueGradeFact> = rosterValueGradeKill
    ? absent<RosterValueGradeFact>(rosterValueGradeKill)
    : (await pRosterValueGrade) ??
      absent<RosterValueGradeFact>({
        reason: 'not_requested',
        detail: 'This question did not call for a roster value grade.',
        remedy: 'Ask where you are weak or how your roster compares and it runs.',
      })

  const psychologyConsistency: GroundedSlice<PsychologyConsistencyFact> = psychologyConsistencyKill
    ? absent<PsychologyConsistencyFact>(psychologyConsistencyKill)
    : (await pPsychologyConsistency) ??
      absent<PsychologyConsistencyFact>({
        reason: 'not_requested',
        detail: 'This question did not call for a cross-league or cross-sport read.',
        remedy: 'Ask how consistent you are across leagues or sports and it runs.',
      })

  /*
   * R2.6 — waiverDecision. THE ONE SLICE WITH NO PRODUCER, AND IT SAYS SO.
   *
   * 🛑 IT WAS INVISIBLE BEFORE THIS. The field was declared on the packet type, rendered by the
   * serializer, and assigned NOWHERE — so it was `undefined` on every packet, and `sliceLine`
   * tolerates undefined by emitting nothing. It also was not in the array above that feeds
   * `collectGaps`. The result: a declared fact that was neither reported as available nor
   * reported as missing, in a packet whose entire contract is that those are the only two
   * options.
   *
   * ✅ IT NOW HAS A PRODUCER, AND THE DIAGNOSIS ABOVE IS WHAT MADE IT BUILDABLE. This comment used
   * to end "the blocker is INPUT: `WaiverAIEngineInput` needs `availablePlayers`, the waiver wire
   * pool, which the legacy route already holds and `loadWaiverWorldFacts` does not load." That was
   * exactly right, and only one clause was wrong: the legacy route does not hold the pool either —
   * its CLIENT posts it (`availablePlayers: z.array(...).min(1)`), so there was never a server-side
   * assembly to reuse. `lib/decision-os/waiver/pool.ts` is that assembly, built on the same
   * resolver and the same rostered-player subtraction the waiver assistant already uses.
   *
   * ⚠ THE RUN IS LIVE, NOT WRAP-FIDELITY. Every other waiver path replays the legacy engine's
   * output as a memo to prove the wrapper adds no drift. A packet slice doing that would report an
   * answer this question never produced, so `loadWaiverDecisionSlice` runs the real recommender —
   * deterministic, no LLM unless `includeAIExplanation` is set, and it is not set.
   *
   * ⚠ THE COST IS BOUNDED BY `want.waiverDecision`, which `intentToWant` sets only for
   * `intent === 'waiver'`. The pool read and the engine run land on waiver questions and nothing
   * else — the gate below is load-bearing, not decorative.
   */
  const waiverDecision: GroundedSlice<DecisionFact> =
    (await pWaiverDecision) ??
    absent<DecisionFact>({
        reason: 'not_requested',
        detail: 'This question did not call for a waiver claim decision.',
        remedy: 'Ask who to claim off waivers and it is requested.',
      })

  const psychologyRows = await pPsychology
  const managerPsychology: GroundedSlice<PsychologyProfileFact[]> = psychologyKill
    ? absent<PsychologyProfileFact[]>(psychologyKill)
    : !leagueId
    ? absent<PsychologyProfileFact[]>({
        reason: 'not_requested',
        detail: 'No league was in scope, and a behavioural profile is per league.',
        remedy: 'Ask about a specific league and it is included.',
      })
    : hasSubstance(psychologyRows) && psychologyRows!.some((p) => p.anySufficient)
    ? present(psychologyRows!, {
        servedFrom: 'store',
        conclusive: verdictFor('managerBehaviour'),
        // Deliberately the OLDEST profile in the league, per the same rule as projections: a
        // single asOf cannot express a range, and overstating freshness is the unrecoverable
        // direction.
        asOf: oldestPsychAsOf(psychologyRows!),
      })
    : hasSubstance(psychologyRows)
    ? absent<PsychologyProfileFact[]>({
        reason: 'not_computed',
        detail:
          `Profiles exist for ${psychologyRows!.length} manager(s) in this league, but none has ` +
          'enough recorded activity to clear its evidence floor yet.',
        remedy: 'They fill in as trades, drafts and waiver moves accumulate — no action needed.',
      }, verdictFor('managerBehaviour'))
    : absent<PsychologyProfileFact[]>({
        reason: 'not_computed',
        detail: 'No behavioural profiles have been built for this league yet.',
        remedy: 'They are written by the profile refresh; one has not run for this league yet.',
      }, verdictFor('managerBehaviour'))

  const portfolio: GroundedSlice<string> = portfolioKill
    ? absent<string>(portfolioKill)
    : portfolioOutcome?.status === 'ok' && hasSubstance(portfolioOutcome.text)
    ? /*
       * ⚠ `status === 'ok'` IS NOT ENOUGH, AND SWAPPING `hasSubstance` FOR IT WAS A REGRESSION.
       * The status says the resolver finished; it says nothing about whether it produced text. An
       * `ok` carrying `''` graded PRESENT for one commit, which is the "[] presented as available"
       * failure §5.2 exists to prevent. Both checks, or neither is worth having.
       *
       * Cross-league by nature: one league's import cannot bear on it, so no verdict applies.
       */
      present(portfolioOutcome.text, { servedFrom: 'live', conclusive: { ok: true } })
    : portfolioOutcome?.status === 'timeout'
    ? /*
       * 🛑 A TIMEOUT IS NOT AN ABSENCE, AND SAYING SO COST A USER WITH 543 LEAGUES THE TRUTH.
       *
       * This branch did not exist: both paths collapsed to `null` and were graded
       * `not_computed` — "No cross-league snapshot is available. Fix: Import at least one league
       * and it appears." Told to an account with 543 imported leagues, that remedy is not merely
       * unhelpful, it is false, and it sends someone to fix a thing that is not broken.
       *
       * `not_synced` is the honest reason: the data exists and was not gathered in time.
       */
      absent({
        reason: 'not_synced',
        detail: `The cross-league snapshot did not finish within its ${portfolioOutcome.budgetMs}ms budget.`,
        remedy:
          'Nothing for you to fix — it is retried next turn, and a warm dashboard cache usually returns it.',
      })
    : absent({
        reason: 'not_computed',
        detail: 'No cross-league snapshot is available.',
        remedy: 'Import at least one league and it appears.',
      })

  /*
   * ⚠ Gated with the rest of the context, and only with a league AND a user — the read is
   * entitlement-checked per user, so asking without one is meaningless rather than merely empty.
   */
  let savedAnalysis: GroundedSlice<string> = absent(NOT_REQUESTED)
  if (leagueId && args.userId && flags.enabled('savedAnalysis')) {
    const outcome =
      (await pSavedAnalysis) ?? ({ status: 'not_computed', reason: 'loader_threw' } as const)

    if (outcome.status === 'ok') {
      savedAnalysis = present(outcome.text, {
        asOf: outcome.generatedAt,
        servedFrom: 'store',
        // A stale conclusion is still worth having as long as the verdict says so.
        conclusive: outcome.stale ? verdictFor('managerBehaviour') : { ok: true },
      })
    } else if (outcome.status === 'not_entitled') {
      savedAnalysis = absent({
        reason: 'not_entitled',
        // No apostrophe on purpose: this string has been through a shell heredoc and a Python
        // literal, and an escaped one arrived unescaped and broke the parse.
        detail: 'The saved analysis for this league is not available to you.',
        remedy: 'Ask the league commissioner, who can see it.',
      })
    } else {
      savedAnalysis = absent({
        reason: 'not_computed',
        detail: 'No saved analysis has been produced for this league yet.',
        remedy: 'It is written by the intelligence runs; one has not succeeded here yet.',
      })
    }
  } else if (leagueId && args.userId) {
    savedAnalysis = absent(killed('savedAnalysis') ?? NOT_REQUESTED)
  }

  /*
   * ── R3.1 — IDP + KICKER VALUES. THE ONE SERIALISED PRODUCER. ────────────────────────────────
   *
   * 🛑 IT STARTS HERE, NOT IN THE CONCURRENT WAVE, AND THAT IS NOT AN OVERSIGHT. Every producer
   * above takes `args`, `leagueId` or `userId` — all known before assembly begins — so they fire
   * together and each `await` merely collects. This one needs the ROSTER, which does not exist
   * until the context engine has returned. It cannot be hoisted without hoisting the engine, and
   * the engine is the single most expensive thing in the packet.
   *
   * So it is opt-in (`want.idpKicker`, default off), separately killable, and its own cheap exit
   * does the real work: 10 of 94 NFL leagues roster IDP slots and 19 roster a kicker, so four
   * leagues in five return before a single query runs.
   */
  let idpKickerValues: GroundedSlice<ValueLookup[]> = absent<ValueLookup[]>(NOT_REQUESTED)
  if (want.idpKicker && idpKickerKill) idpKickerValues = absent<ValueLookup[]>(idpKickerKill)
  else if (want.idpKicker && leagueId && !contextFacts) {
    /*
     * 🛑 THE ENGINE IS DOWN, AND THAT IS NOT THE SAME AS AN UNSYNCED LEAGUE. `contextFacts` is
     * null only when the context engine threw — the catch above turns eight facts into null at
     * once. Reading `contextFacts.roster` here would throw and take the WHOLE packet build down
     * for every other slice in the turn, which is the one thing every producer in this file is
     * written to avoid.
     *
     * ⚠ AND IT MUST NOT FALL THROUGH TO THE SLICE'S OWN "no rostered players" GAP. That reason
     * tells the user to re-sync a league that may be perfectly synced; the roster is missing
     * because our engine failed, not because their data is absent. Different cause, different
     * remedy, so it gets its own.
     */
    idpKickerValues = absent<ValueLookup[]>({
      reason: 'not_computed',
      detail: 'The context engine did not return a roster, so IDP and kicker values could not be priced.',
      remedy: 'It retries on the next request; nothing on your side needs changing.',
    })
  } else if (want.idpKicker && leagueId) {
    const rulesValue = leagueRules.present ? leagueRules.value : null
    const fmt = deriveValueFormat(rulesValue)
    const size = deriveLeagueSizeAndPpr(rulesValue)
    idpKickerValues = await kick(
      'idpKickerValues',
      loadIdpKickerValueSlice({
        sport: args.sport,
        leagueId,
        // Optional-chained rather than relying on narrowing: the guard above tests a COMPOUND
        // condition, so TypeScript cannot conclude `contextFacts` is non-null here from its
        // negation alone. `rosterSleeperIdsFrom` returns [] for anything unusable.
        rosterPlayerIds: rosterSleeperIdsFrom(contextFacts?.roster?.value ?? null),
        rosterPositions: rosterPositionsFrom(rulesValue),
        /*
         * ⚠ 12 IS A STATED FALLBACK, NOT A MEASUREMENT, and it is confined to replacement level.
         * `buildIdpValuations` refuses outright without a team count — "replacement level is
         * meaningless without it" — so the alternative to a default is no IDP values at all for a
         * league whose size we failed to read. `resolveLeagueKickerValue` already defaults the
         * same way internally.
         */
        numTeams: size.numTeams ?? 12,
        isDynasty: fmt?.format === 'DYNASTY',
      }),
    )
  }

  const slices: Array<[string, GroundedSlice<unknown>]> = [
    ['importAssertions', importSlice as GroundedSlice<unknown>],
    ['commissionerIntelligence', commissionerIntelligence as GroundedSlice<unknown>],
    ['leagueIntelligence', leagueIntelligence as GroundedSlice<unknown>],
    ['portfolio', portfolio as GroundedSlice<unknown>],
    ['savedAnalysis', savedAnalysis as GroundedSlice<unknown>],
    ['managerPsychology', managerPsychology as GroundedSlice<unknown>],
    ['lineupDecision', lineupDecision as GroundedSlice<unknown>],
    ['commissionerHealthDecision', commissionerHealthDecision as GroundedSlice<unknown>],
    ['idpKickerValues', idpKickerValues as GroundedSlice<unknown>],
    ['rosterValueGrade', rosterValueGrade as GroundedSlice<unknown>],
    ['psychologyConsistency', psychologyConsistency as GroundedSlice<unknown>],
    ['waiverDecision', waiverDecision as GroundedSlice<unknown>],
    ...(contextFacts
      ? (Object.entries(contextFacts) as Array<[string, GroundedSlice<unknown>]>)
      : []),
    ['leagueRules', leagueRules],
    ['marketValues', marketValues as GroundedSlice<unknown>],
    ['devyValues', devyValues as GroundedSlice<unknown>],
    ['projections', projections as GroundedSlice<unknown>],
  ]

  return {
    leagueId,
    userId: args.userId ?? null,
    builtAt: new Date().toISOString(),
    importAssertions: importSlice,
    leagueRules,
    marketValues,
    devyValues,
    projections,
    contextFacts,
    contextLookups,
    commissionerIntelligence,
    leagueIntelligence,
    portfolio,
    savedAnalysis,
    managerPsychology,
    waiverDecision,
    lineupDecision,
    commissionerHealthDecision,
    idpKickerValues,
    rosterValueGrade,
    psychologyConsistency,
    gaps: collectGaps(slices),
    meta: {
      durationMs: Date.now() - startedAt,
      engineMs,
      sources: slices.map(([slice, s]) => ({
        slice,
        servedFrom: s.servedFrom,
        ok: s.present,
        // Null where nothing timed it: the engine keys on ITS provider name, not the packet's.
        ms: sliceMs.get(slice) ?? sliceMs.get(SLICE_TO_PROVIDER[slice] ?? slice) ?? null,
      })),
      killedFeeds: flags.killed,
    },
  }
}
