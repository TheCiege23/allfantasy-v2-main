import type { ImportAssertions } from '../import/assertions'
import { buildEvidencePacket } from '../three-brain/evidencePacket'
import type {
  DecisionFreshness,
  DecisionMode,
  DecisionOSEvidencePacket,
  DecisionOSSignal,
  DecisionProviderStatus,
  VerifiedDecisionFact,
} from '../three-brain/types'
import type { DecisionOsGroundingPacket, GroundedSlice } from './packet'

/**
 * `DecisionOsGroundingPacket` → `DecisionOSEvidencePacket` (6.2).
 *
 * ── 🛑 6.2 IS AN ADAPTER, NOT AN INTEGRATION, AND THAT IS A MEASURED CLAIM ──────────────────
 * `runThreeBrainAnalysis` takes an evidence packet and never fetches anything, so invariant P3
 * — AI may explain but never generate facts — holds structurally rather than by discipline. Its
 * input shape and the grounding packet's already line up almost one-to-one:
 *
 *   missingInformation[]  ←  gaps, which carry a REASON and a REMEDY the target has no field for
 *   freshness             ←  the import assertions' own staleness
 *   providerStatus[]      ←  meta.sources, plus meta.killedFeeds
 *   relevantFacts[]       ←  the present slices
 *
 * So the work is translation, not plumbing. What the target does NOT have is a place for a
 * remedy, so gaps are flattened into one sentence each rather than dropping the half that makes
 * a refusal useful.
 *
 * ── ⚠ THE TARGET IS "MINIMIZED" EVIDENCE AND THIS PACKET IS NOT ─────────────────────────────
 * `DecisionOSEvidencePacket` is documented as "the verified, MINIMIZED evidence supplied to the
 * models", and it is sent to Anthropic. The grounding packet holds whole projection arrays,
 * rosters and standings. Passing slice values through verbatim would put thousands of rows into
 * a prompt — cost, latency, and a context window spent on data no model was asked to read.
 *
 * So every fact is SUMMARISED to a deterministic one-liner. A model that needs the detail should
 * be given a narrower packet, not a bigger one.
 *
 * ── ⚠ NOT WIRED TO CHIMMY HERE, DELIBERATELY ────────────────────────────────────────────────
 * three-brain calls Anthropic. Putting it on `/api/chat/chimmy` adds a model call per turn to the
 * highest-traffic route in the product, and that needs the same treatment the grounding packet
 * got — a flag, a ceiling, and an outcome marker — plus the `buildMs` number nobody has read yet.
 * This file makes the call possible and cheap to add; it does not make it.
 */

/** How stale a fact may be before the evidence says so. Mirrors `conclusive.ts`'s 2h lineup band. */
const AGING_MS = 2 * 60 * 60 * 1000
const STALE_MS = 24 * 60 * 60 * 1000

/**
 * One deterministic line per fact.
 *
 * 🛑 NEVER `JSON.stringify(value)`. That is the whole point of this function: the slice values are
 * arrays of hundreds of players, and the target type exists to be small.
 */
function summarise(slice: GroundedSlice<unknown>): string {
  const v = slice.value
  if (v == null) return 'unavailable'
  if (Array.isArray(v)) return `${v.length} row${v.length === 1 ? '' : 's'}`
  if (typeof v === 'string') {
    const trimmed = v.trim()
    // Text slices (the three resolvers) are prose a model can genuinely use, so they survive —
    // bounded, because "available" would throw away the only slices worth reading verbatim.
    return trimmed.length <= 400 ? trimmed : `${trimmed.slice(0, 400)}…`
  }
  if (typeof v === 'object') return 'available'
  return String(v)
}

/** `2h old`, or null when the slice does not know when it was captured. */
function ageLabel(asOf: string | null, now: number): string | null {
  if (!asOf) return null
  const ms = now - Date.parse(asOf)
  if (!Number.isFinite(ms) || ms < 0) return null
  const mins = Math.round(ms / 60_000)
  if (mins < 60) return `${mins}m old`
  const hours = Math.round(mins / 60)
  return hours < 48 ? `${hours}h old` : `${Math.round(hours / 24)}d old`
}

/**
 * Freshness from the league's own import state, not from a clock.
 *
 * ⚠ `unknown` IS A REAL STATE HERE AND MUST NOT COLLAPSE TO `fresh`. A native AllFantasy league
 * has no import assertions at all, and neither does one that has never synced — reporting either
 * as fresh would be exactly the fabrication the grounding packet exists to prevent.
 */
function freshnessFrom(assertions: GroundedSlice<ImportAssertions>): DecisionFreshness {
  const a = assertions.present ? assertions.value : null
  if (!a || a.staleMs == null) {
    return { state: 'unknown', providerUpdatedAt: a?.lastSuccessfulSyncAt ?? null, ingestedAt: null, ageSeconds: null }
  }
  const state: DecisionFreshness['state'] =
    a.staleMs >= STALE_MS ? 'stale' : a.staleMs >= AGING_MS ? 'aging' : 'fresh'
  return {
    state,
    providerUpdatedAt: a.lastSuccessfulSyncAt,
    ingestedAt: a.lastSuccessfulSyncAt,
    ageSeconds: Math.round(a.staleMs / 1000),
  }
}

export interface GroundingToEvidenceArgs {
  /** Required by the target and NOT carried on the grounding packet, so it must be supplied. */
  sport: string
  season?: number | string | null
  /** e.g. 'lineup', 'trade', 'league_health'. Free-form on the target. */
  decisionType: string
  mode?: DecisionMode
  requestId?: string
  now?: number
}

/**
 * Translate a grounding packet into evidence three-brain can reason over.
 *
 * PURE — no IO, no clock unless you pass one — so what a model would be handed is assertable in a
 * test rather than inspected in a log.
 */
export function groundingPacketToEvidence(
  packet: DecisionOsGroundingPacket,
  args: GroundingToEvidenceArgs,
): DecisionOSEvidencePacket {
  const now = args.now ?? Date.now()

  const named: Array<[string, GroundedSlice<unknown>]> = [
    ['importAssertions', packet.importAssertions as GroundedSlice<unknown>],
    ['leagueRules', packet.leagueRules],
    ['marketValues', packet.marketValues as GroundedSlice<unknown>],
    ['devyValues', packet.devyValues as GroundedSlice<unknown>],
    ['projections', packet.projections as GroundedSlice<unknown>],
    ['commissionerIntelligence', packet.commissionerIntelligence as GroundedSlice<unknown>],
    ['leagueIntelligence', packet.leagueIntelligence as GroundedSlice<unknown>],
    ['portfolio', packet.portfolio as GroundedSlice<unknown>],
    ['savedAnalysis', packet.savedAnalysis as GroundedSlice<unknown>],
    ...(packet.contextFacts
      ? (Object.entries(packet.contextFacts) as Array<[string, GroundedSlice<unknown>]>)
      : []),
  ]

  /*
   * ⚠ ONLY PRESENT SLICES BECOME FACTS. An absent one is already represented in
   * `missingInformation` with its reason and remedy; emitting it here as "unavailable" would put
   * the same absence in front of the model twice, once stripped of why.
   */
  const facts: Array<Omit<VerifiedDecisionFact, 'id'> & { id?: string }> = named
    .filter(([, s]) => s.present)
    .map(([name, s]) => {
      const age = ageLabel(s.asOf, now)
      return {
        id: name,
        label: name,
        value: age ? `${summarise(s)} (${age})` : summarise(s),
        // Provenance, never a URL — the target's own constraint.
        source: s.servedFrom ? `decision-os:${s.servedFrom}` : 'decision-os',
      }
    })

  /*
   * 🛑 PRESENT-BUT-INCONCLUSIVE IS A SIGNAL, NOT A FACT AND NOT A GAP. "We have your roster, and
   * your league has not synced in two days, so do not act on it" is the single most useful thing
   * this packet knows, and the target has no other field that can carry it. Dropping it would
   * hand a model stale numbers with nothing marking them stale.
   */
  const signals: Array<Omit<DecisionOSSignal, 'id'> & { id?: string }> = named
    .filter(([, s]) => s.present && !s.conclusive.ok)
    .map(([name, s]) => ({
      id: `inconclusive_${name}`,
      kind: 'not_safe_to_act_on',
      summary: `${name}: ${s.gap?.detail ?? 'present but not safe to act on'}`,
      severity: 'warning' as const,
    }))

  /*
   * The gap's REMEDY is the half that makes a refusal an answer, and the target has no field for
   * it — so it is flattened into the sentence rather than dropped.
   */
  const missingInformation = packet.gaps.map(
    (g) => `${g.slice}: ${g.detail} (${g.reason}) Fix: ${g.remedy}`,
  )

  const providerStatus: DecisionProviderStatus[] = [
    ...packet.meta.sources.map((s) => ({
      provider: s.slice,
      ok: s.ok,
      note: s.servedFrom ?? undefined,
    })),
    /*
     * ⚠ A KILLED FEED IS REPORTED EVEN WHEN THE QUESTION NEVER WANTED IT. It raises no gap by
     * design — that would be noise on every answer — but an operator kill is exactly the kind of
     * thing that makes a later answer inexplicable, so it belongs in provider status.
     */
    ...packet.meta.killedFeeds.map((feed) => ({
      provider: feed,
      ok: false,
      note: 'disabled by operator',
    })),
  ]

  return buildEvidencePacket({
    userId: packet.userId ?? 'unknown',
    canonicalLeagueId: packet.leagueId ?? undefined,
    sport: args.sport,
    season: args.season == null ? undefined : String(args.season),
    decisionType: args.decisionType,
    // League scope whenever a league is in play; the packet's own leagueId decides it rather than
    // the caller, so the two cannot disagree.
    mode: args.mode ?? (packet.leagueId ? 'league' : 'global'),
    signals,
    facts,
    freshness: freshnessFrom(packet.importAssertions),
    missingInformation,
    providerStatus,
    requestId: args.requestId,
    generatedAt: packet.builtAt,
  })
}
