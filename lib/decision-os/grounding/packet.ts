import 'server-only'

import { createImportOsLoaders } from '../import-os'
import { createValueOsLoaders } from '../value-os'
import { createProjectionOsLoaders } from '../projection-os'
import { createLeagueOsLoaders } from '../league-os'
import { isConclusiveFor, type ConclusivenessVerdict, type FactProfileName } from '../conclusive'
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
    /** Per-slice feed outcomes, mirroring `ChimmyContextBundle.meta.providers`. */
    sources: Array<{ slice: string; servedFrom: string | null; ok: boolean }>
  }
}

const NOT_REQUESTED: GroundingGap = {
  reason: 'not_requested',
  detail: 'This was not part of the question, so it was not assembled.',
  remedy: 'Ask about it and it will be gathered.',
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

  const importOs = createImportOsLoaders()
  const valueOs = createValueOsLoaders()
  const projectionOs = createProjectionOsLoaders()
  const leagueOs = createLeagueOsLoaders()

  // ── The assertions first: everything else is judged against them. ─────────────────────────
  const assertions = leagueId ? await importOs.loadAssertions(leagueId).catch(() => null) : null

  const importSlice: GroundedSlice<ImportAssertions> = assertions
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
  if (want.leagueRules && leagueId) {
    const rules = await leagueOs.loadRules(leagueId).catch(() => null)
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
  if (want.values && args.valueFormat) {
    const v = verdictFor('globalPlayerValue') // global — no league import can block it
    const rows = await valueOs
      .loadMarket({ sport: args.sport, format: args.valueFormat.format, qbFormat: args.valueFormat.qbFormat })
      .catch(() => null)
    marketValues = rows
      ? present(rows, { servedFrom: 'store', conclusive: v })
      : absent({
          reason: 'not_computed',
          detail: `No market values are held for ${args.sport} in this format.`,
          remedy: 'They refresh daily; a cold cache fills on the next run.',
        }, v)
  }

  // ── Devy values ───────────────────────────────────────────────────────────────────────────
  let devyValues: GroundedSlice<ValueLookup[]> = absent(NOT_REQUESTED)
  if (want.devy) {
    const v = verdictFor('globalPlayerValue')
    const rows = await valueOs.loadDevy({ sport: args.sport, currentSeason: args.season }).catch(() => null)
    devyValues = rows
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
  if (want.projections) {
    const v = verdictFor('lineupDecision')
    const facts = await projectionOs
      .loadFor({ sport: args.sport, season: args.season, week: args.week ?? null }, args.leagueIdpRules ?? null)
      .catch(() => null)
    if (!facts) {
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

  const slices: Array<[string, GroundedSlice<unknown>]> = [
    ['importAssertions', importSlice as GroundedSlice<unknown>],
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
    gaps: collectGaps(slices),
    meta: {
      durationMs: Date.now() - startedAt,
      sources: slices.map(([slice, s]) => ({ slice, servedFrom: s.servedFrom, ok: s.present })),
    },
  }
}
