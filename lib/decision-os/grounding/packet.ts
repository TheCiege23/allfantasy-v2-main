import 'server-only'

import { createImportOsLoaders } from '../import-os'
import { createValueOsLoaders } from '../value-os'
import { createProjectionOsLoaders } from '../projection-os'
import { createLeagueOsLoaders } from '../league-os'
import { ChimmyContextEngine } from '@/lib/chimmy-context/ChimmyContextEngine'
import {
  resolveCommissionerGroundingOutcome,
  type CommissionerGroundingOutcome,
} from '@/lib/intelligence/chimmy/resolveChimmyGrounding'
import { resolveLeagueIntelligenceGrounding } from '@/lib/intelligence/chimmy/leagueIntelligenceGrounding'
import { resolvePortfolioGrounding } from '@/lib/intelligence/chimmy/portfolioGrounding'
import { isConclusiveFor, type ConclusivenessVerdict, type FactProfileName } from '../conclusive'
import { resolveDecisionOsFeedFlags, type DecisionOsFeed } from '../flags'
import { loadSavedThreeBrainAnalysis } from './savedAnalysis'
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
  savedAnalysis: GroundedSlice<string>

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

  const pAssertions =
    leagueId && !importKill
      ? kick('importAssertions', importOs.loadAssertions(leagueId).catch(() => null))
      : Promise.resolve(null)

  const pRules =
    want.leagueRules && leagueId && !rulesKill
      ? kick('leagueRules', leagueOs.loadRules(leagueId).catch(() => null))
      : Promise.resolve(null)

  const pMarket =
    want.values && args.valueFormat && !marketKill
      ? kick(
          'marketValues',
          valueOs
            .loadMarket({
              sport: args.sport,
              format: args.valueFormat.format,
              qbFormat: args.valueFormat.qbFormat,
            })
            .catch(() => null),
        )
      : Promise.resolve(null)

  const pDevy = want.devy && !devyKill
    ? kick(
        'devyValues',
        valueOs.loadDevy({ sport: args.sport, currentSeason: args.season }).catch(() => null),
      )
    : Promise.resolve(null)

  const pProjections = want.projections && !projectionKill
    ? kick(
        'projections',
        projectionOs
          .loadFor(
            { sport: args.sport, season: args.season, week: args.week ?? null },
            args.leagueIdpRules ?? null,
          )
          .catch(() => null),
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
  if (want.values && args.valueFormat && marketKill) marketValues = absent(marketKill)
  else if (want.values && args.valueFormat) {
    const v = verdictFor('globalPlayerValue') // global — no league import can block it
    const rows = await pMarket
    marketValues = hasSubstance(rows)
      ? present(rows, { servedFrom: 'store', conclusive: v })
      : absent({
          reason: 'not_computed',
          detail: `No market values are held for ${args.sport} in this format.`,
          remedy: 'They refresh daily; a cold cache fills on the next run.',
        }, v)
  }

  // ── Devy values ───────────────────────────────────────────────────────────────────────────
  let devyValues: GroundedSlice<ValueLookup[]> = absent(NOT_REQUESTED)
  if (want.devy && devyKill) devyValues = absent(devyKill)
  else if (want.devy) {
    const v = verdictFor('globalPlayerValue')
    const rows = await pDevy
    devyValues = hasSubstance(rows)
      ? present(rows, { servedFrom: 'store', conclusive: v })
      : absent({
          reason: args.sport.toUpperCase() === 'NCAAF' ? 'not_computed' : 'no_producer',
          detail:
            args.sport.toUpperCase() === 'NCAAF'
              ? 'The devy board is empty for this season.'
              : `There is no devy valuation model for ${args.sport}. The board is college football only.`,
          remedy:
            args.sport.toUpperCase() === 'NCAAF'
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
      const slice = present(facts, { asOf: facts[0]?.computedAt ?? null, servedFrom: 'store', conclusive: v })
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
        roster: withResolvedIdentity(grade('roster', bundle.roster, 'lineupDecision')),
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
  const [leagueIntelText, portfolioText] = await Promise.all([
    leagueId && args.userId && !leagueIntelKill
      ? kick(
          'leagueIntelligence',
          resolveLeagueIntelligenceGrounding({ leagueId, userId: args.userId }).catch(() => null),
        )
      : Promise.resolve(null),
    args.userId && !portfolioKill
      ? kick('portfolio', resolvePortfolioGrounding({ userId: args.userId }).catch(() => null))
      : Promise.resolve(null),
  ])

  const leagueIntelligence: GroundedSlice<string> = leagueIntelKill
    ? absent<string>(leagueIntelKill)
    : hasSubstance(leagueIntelText)
    ? present(leagueIntelText, { servedFrom: 'live', conclusive: verdictFor('standings') })
    : absent({
        reason: 'not_computed',
        detail: 'No league intelligence brief could be built for this league.',
        remedy: 'It needs recorded league activity — trades, matchups, valuations — to summarise.',
      })

  const portfolio: GroundedSlice<string> = portfolioKill
    ? absent<string>(portfolioKill)
    : hasSubstance(portfolioText)
    ? // Cross-league by nature: one league's import cannot bear on it, so no verdict applies.
      present(portfolioText, { servedFrom: 'live', conclusive: { ok: true } })
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

  const slices: Array<[string, GroundedSlice<unknown>]> = [
    ['importAssertions', importSlice as GroundedSlice<unknown>],
    ['commissionerIntelligence', commissionerIntelligence as GroundedSlice<unknown>],
    ['leagueIntelligence', leagueIntelligence as GroundedSlice<unknown>],
    ['portfolio', portfolio as GroundedSlice<unknown>],
    ['savedAnalysis', savedAnalysis as GroundedSlice<unknown>],
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
