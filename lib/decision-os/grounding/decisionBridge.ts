import 'server-only'

import { assertLeagueCommissioner } from '@/lib/league/league-access'
import { runCommissionerHealthDecision } from '../commissioner-health'
import { buildProductionCommissionerHealthDecisionDeps } from '../commissioner-health/deps'
import type { CommissionerActionSuggestion, CommissionerHealthAssessment } from '../commissioner-health/decision'
import { runWaiverClaimDecision } from '../waiver'
import type { WaiverClaimRecommendation } from '../waiver/decision'
import { worldInputFromFacts } from '../waiver/loader'
import { createWaiverOsLoaders } from '../waiver-os'
import { buildLiveWaiverDecisionDeps } from '../waiver/deps'
import { loadWaiverPool } from '../waiver/pool'
import { loadWaiverCalibrationForLeague } from '../waiver/calibrationStore'
import { createCommissionerOsLoaders } from '../commissioner-os'
// The inactive flag's graded record — the one loader the hub's flag also reads, so the two never disagree.
import { loadInactiveFlagRecord } from '@/lib/commissioner-hub/inactiveFlagRecord'
import { waiverEngineInputFrom } from '../waiver/engineInput'
import { decisionToSlice, type DecisionFact } from './decisionToSlice'
import type { GroundedSlice } from './packet'

/**
 * R2.3 / R2.6 — producers that RUN a live engine and hand the packet its decision.
 *
 * ⚠ THE R2.4 LINEUP BRIDGE IS GONE (2026-11-17). Owner decision 2026-09-29 made My Team's
 * `optimizeLineup` (`lineup/bestLineup.ts`) the one start/sit answer, and Chimmy reads it through
 * `lib/chimmy/myTeamLineupGrounding.ts`. The `lineupDecision` slice that ran the second engine here
 * had not been requested by any intent since it measured 37s against a 3s ceiling, so the bridge,
 * the slice and the engine behind it were deleted together.
 *
 * ── 🛑 WHY THIS IS A SEPARATE MODULE FROM `packet.ts` ───────────────────────────────────────
 * `packet.ts` already carries nineteen imports. Pulling an engine's dependency tree into it would
 * make every consumer of the packet type pay for an engine's loader, and `leagueValueFormat.ts` was
 * split out earlier in exactly this situation for exactly this reason. The packet calls one
 * function per engine and knows nothing about how a decision is produced.
 *
 * ── 🛑 WHY THE ENGINES ARE RUN AND NOT READ ─────────────────────────────────────────────────
 * R2's spec called this a "read-only adapter over the engines' decision objects". There are no
 * decision objects to read: `canonical_decisions` exists, has a 46-column schema and a writer, and
 * holds ZERO rows in production. The engines run inline per request on their own routes and
 * nothing persists the result. A bridge reading that table would return nothing, for every league,
 * silently — the `ingestCFBDStats` failure this codebase has already paid for once.
 *
 * ── ⚠ NO SHADOW DEPS ARE PASSED, DELIBERATELY ───────────────────────────────────────────────
 * An engine's optional `shadow` runs a LEGACY recommender too and compares them. That is parity
 * infrastructure for the route that owns it; a chat turn wants the decision, not a second opinion.
 *
 * ── ⚠ THE ENGINES ARE NOT MODIFIED, AND NOTHING HERE MAY CHANGE ONE ────────────────────────
 * Every function below is a caller. Pipeline A is live, load-bearing and correct; if a change here
 * appears to need an engine change, that is the signal to stop and re-scope.
 */

/** Never let an engine failure surface as an exception — the packet's contract is gaps, not throws. */
function failed(engine: string, detail: string): GroundedSlice<DecisionFact> {
  return {
    present: false,
    value: null,
    asOf: null,
    servedFrom: null,
    confidence: null,
    conclusive: { ok: true },
    gap: {
      reason: 'not_computed',
      detail: `The ${engine} engine could not produce a decision: ${detail}`,
      remedy: 'It runs again on the next request once its inputs are available.',
    },
  }
}

export interface DecisionBridgeArgs {
  userId?: string | null
  leagueId?: string | null
}

/**
 * One health assessment, in one line.
 *
 * 🛑 THE ACTION TYPE HERE IS `CommissionerHealthAssessment`, NOT `CommissionerActionSuggestion`,
 * and getting that wrong is how this function was first written. `decideCommissionerHealth` returns
 * `Decision<CommissionerHealthAssessment>`, so each "recommended action" is a whole assessment that
 * CONTAINS suggestions, rather than being one.
 *
 * ⚠ THE TESTS DID NOT CATCH IT AND STRUCTURALLY COULD NOT. The mock asserted a
 * `{ key, label, href, tone }` shape the engine never produces, and `tsconfig` excludes
 * `__tests__`, so that fabricated shape was never checked against the real contract. The
 * same-artifact typecheck pair caught it — one error appeared that was not in the base — which is
 * the entire argument for running the pair rather than trusting a green suite.
 */
const MAX_ALERTS = 3

function moreSuffix(total: number, shown: number, noun: string): string {
  const cut = total - shown
  return cut > 0 ? ` (+${cut} more ${noun}${cut === 1 ? '' : 's'} not shown)` : ''
}

function describeCommissionerAssessment(a: CommissionerHealthAssessment): string | null {
  if (!a) return null
  const parts: string[] = []
  if (a.overallStatus) parts.push(String(a.overallStatus))
  if (typeof a.healthScore === 'number') parts.push(`health ${a.healthScore}`)
  // The alerts are the substance a commissioner acts on; bounded, because a struggling league can
  // carry a lot of them and this line ends up in a prompt.
  const alerts = Array.isArray(a.topAlerts) ? a.topAlerts.filter((x) => typeof x === 'string') : []
  // ⚠ What the bound leaves out is COUNTED (2026-11-23): a bare `.slice(0, 3)` read as "these are all the alerts".
  if (alerts.length > 0) parts.push(`alerts: ${alerts.slice(0, MAX_ALERTS).join('; ')}${moreSuffix(alerts.length, MAX_ALERTS, 'alert')}`)
  const suggestions = Array.isArray(a.suggestedActions)
    ? a.suggestedActions.map((s: CommissionerActionSuggestion) => s?.label).filter((l): l is string => Boolean(l))
    : []
  if (suggestions.length > 0) parts.push(`suggested: ${suggestions.slice(0, MAX_ALERTS).join(', ')}${moreSuffix(suggestions.length, MAX_ALERTS, 'suggestion')}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** A slice that is absent because this user may not see it. Distinct from "we could not compute it". */
function notEntitled(): GroundedSlice<DecisionFact> {
  return {
    present: false,
    value: null,
    asOf: null,
    servedFrom: null,
    confidence: null,
    conclusive: { ok: true },
    gap: {
      reason: 'not_entitled',
      detail: 'League health is a commissioner view, and you do not commission this league.',
      remedy: 'Nothing to fix — ask your commissioner, who can see it.',
    },
  }
}

/**
 * R2.3 — the commissioner health decision for this league.
 *
 * ── 🛑 THE PERMISSION CHECK IS FIRST AND IS NOT MINE ────────────────────────────────────────
 * `assertLeagueCommissioner` is the same check `resolveCommissionerGroundingOutcome` already uses
 * for the commissionerIntelligence slice. Reusing it matters: two implementations of one
 * permission rule is the bug, and the packet already has `not_entitled` as a first-class gap
 * reason precisely so a permission absence never reads as a missing fact.
 *
 * ⚠ IT RUNS BEFORE THE LOADER, NOT ALONGSIDE IT. The loader below is handed
 * `isCommissioner: true`, which it trusts and filters on — so asserting that without having
 * verified it would hand a non-commissioner a commissioner's view. The check is what earns the
 * right to set that flag.
 *
 * ── ⚠ THE LOADER IS REUSED RATHER THAN NARROWED, AND THAT IS A DELIBERATE TRADE ─────────────
 * `getCommissionerHubHealthForUser` runs TEN parallel queries and returns snapshots for every
 * league the user commissions. A single-league version would be cheaper and would duplicate all
 * ten — a rival to working code, which is the mistake this codebase records twice. So the cost is
 * accepted and paid for by the flag instead: `want.commissionerHealthDecision` is set only on a
 * `commissioner`-classified turn (`deriveWantFromIntent`), and the `get_league_health` tool reads the same
 * slice on demand. (It said "defaults OFF" until the 2026-11-24 re-score — true of the raw flag, misleading
 * about the chat, which turns it on for every commissioner question.)
 */
export async function loadCommissionerHealthDecisionSlice(
  args: DecisionBridgeArgs,
): Promise<GroundedSlice<DecisionFact>> {
  const userId = args.userId ?? null
  const leagueId = args.leagueId ?? null
  if (!userId || !leagueId) {
    return {
      present: false,
      value: null,
      asOf: null,
      servedFrom: null,
      confidence: null,
      conclusive: { ok: true },
      gap: {
        reason: 'not_requested',
        detail: 'League health needs both a signed-in user and a league.',
        remedy: 'Ask about a specific league while signed in.',
      },
    }
  }

  try {
    const access = await assertLeagueCommissioner(leagueId, userId, 'view')
    if (!access?.ok) return notEntitled()

    /*
     * Through Commissioner OS (2026-11-20): the same snapshot the hub builds — `getCommissionerHubHealthForUser`
     * with dynasty signals, so a dynasty league's pick balance and taxi findings ride in `alerts` — held for five
     * minutes per (commissioner, league) instead of rebuilt on every question. Access was proved just above, on
     * this request; a stored snapshot never stands in for that check.
     */
    const snapshot = await createCommissionerOsLoaders().loadHealthSnapshot({ userId, leagueId })

    if (!snapshot) {
      return {
        present: false,
        value: null,
        asOf: null,
        servedFrom: null,
        confidence: null,
        conclusive: { ok: true },
        gap: {
          reason: 'not_computed',
          detail: 'No health snapshot could be assembled for this league.',
          remedy: 'It fills once the league has rosters and recent activity to measure.',
        },
      }
    }

    /*
     * 🛑 A `dashboard-fallback` SNAPSHOT IS REFUSED, AND THIS GUARD HAD TO BE CARRIED HERE BY HAND.
     *
     * `runCommissionerHealthShadow` declines exactly this case — "skip the non-authoritative
     * fallback path (no live roster reads)" — but that guard lives in the SHADOW wrapper, not in
     * `runCommissionerHealthDecision`. Calling the decider directly, as this bridge does, walks
     * straight past it. A fallback snapshot is assembled from dashboard fields rather than live
     * rosters, so deciding on one would produce a confident league-health verdict from data the
     * live path considers unfit to decide on.
     */
    if (snapshot.source === 'dashboard-fallback') {
      return {
        present: false,
        value: null,
        asOf: null,
        servedFrom: null,
        confidence: null,
        conclusive: { ok: true },
        gap: {
          reason: 'not_synced',
          detail: 'Only a dashboard fallback snapshot exists, which is not built from live rosters.',
          remedy: 'Re-sync the league so health is measured from real roster data.',
        },
      }
    }

    const result = await runCommissionerHealthDecision(
      { snapshot, userId },
      // The inactive flag's graded record (the learning loop, 2026-11-20); the rules use it only in a native league.
      { decision: buildProductionCommissionerHealthDecisionDeps(snapshot, { inactiveFlags: await loadInactiveFlagRecord() }) },
      // No `shadow` — see the header.
    )

    return decisionToSlice(result.decision, {
      reason: 'not_computed',
      detail: 'The commissioner health engine returned no decision.',
      remedy: 'It runs again on the next request.',
    }, { describeAction: describeCommissionerAssessment })
  } catch (err) {
    return failed('commissioner health', err instanceof Error ? err.message.slice(0, 120) : 'unknown error')
  }
}

/**
 * R2.6 — the waiver claim decision for this user in this league.
 *
 * 🛑 THIS IS THE SLICE THAT HAD NO PRODUCER, AND THE BLOCKER WAS AN INPUT, NOT AN ENGINE.
 * `lib/decision-os/waiver/` has been complete for a while; what it lacked was `availablePlayers` —
 * the wire pool. The legacy route never assembled one server-side either (its client POSTs the
 * pool), so there was nothing to reuse until `loadWaiverPool` was written. `packet.ts` stated that
 * blocker precisely, and this discharges it.
 *
 * ⚠ THE RECOMMENDER RUNS FOR REAL. Every OTHER waiver path here is WRAP-FIDELITY — fed the legacy
 * engine's output as a memo, proving the wrapper adds no drift. Right for a parity shadow, wrong
 * here: a packet slice replaying a memo would report an answer this question never produced.
 * `buildLiveWaiverDecisionDeps` runs `runWaiverAIService`, which is deterministic — no LLM unless
 * `includeAIExplanation` is set, and it is not set.
 *
 * ⚠ COST IS BOUNDED BY INTENT, NOT BY LUCK. `intentToWant` sets `waiverDecision` only when the
 * question is about waivers (`intent === 'waiver'`), so the pool read and the engine run land on
 * waiver questions and no others. That gate already existed; this producer relies on it.
 */
export interface WaiverDecisionBridgeArgs extends DecisionBridgeArgs {
  /**
   * Receives the engine's claim recommendations, as produced — the side channel Chimmy advice
   * receipts record from (user decision, 2026-09-14).
   *
   * 🛑 NEVER PART OF THE SLICE. The slice stays prompt text; these objects go only to the sink, so
   * nothing here can put an id or a raw action into a prompt. A sink that throws is swallowed: it
   * can never cost the packet its waiver slice.
   */
  onClaims?: (claims: readonly WaiverClaimRecommendation[], confidencePct: number | null) => void
}

/*
 * 🛑 THE WAIVER FACTS GO THROUGH WAIVER OS NOW (2026-11-20 re-score, Kernel ⚠ → ✅). This bridge — every Chimmy waiver
 * question and the weekly engine run (`weeklyEngineCalls.ts`) — called `loadWaiverWorldFacts` directly, so the
 * domain's registered feed was read only by `/api/waiver-ai/engine` behind `DECISION_OS_WAIVER_LIVE`. It reads the
 * user-level resource entry: FAAB, priority and settings for this manager, held five minutes (`waiverResourceSource`
 * — short because FAAB moves on every processed claim), derived by the same `loadWaiverWorldFacts` on a miss, and a
 * store problem falls through to that derivation. A null result is still "no roster resolved", never cached.
 */
const waiverOs = createWaiverOsLoaders()

export async function loadWaiverDecisionSlice(args: WaiverDecisionBridgeArgs): Promise<GroundedSlice<DecisionFact>> {
  const userId = args.userId ?? null
  const leagueId = args.leagueId ?? null
  if (!userId || !leagueId) {
    return {
      present: false,
      value: null,
      asOf: null,
      servedFrom: null,
      confidence: null,
      conclusive: { ok: true },
      gap: {
        reason: 'not_requested',
        detail: 'A waiver claim decision is about one manager in one league, and neither was in scope.',
        remedy: 'Ask who to claim in a specific league and it runs.',
      },
    }
  }

  try {
    const facts = await waiverOs.loadWorldFacts(userId, leagueId)
    if (!facts) {
      /*
       * ⚠ THE HONEST DEGRADE, AND IT IS THE LIKELY PATH FOR SOME PROVIDERS.
       * `loadWaiverWorldFacts` returns null when no roster resolves for this user, and
       * the (since retired) `WaiverRecommendationAdapter` recorded that the userId/managerKey pairing can legitimately
       * disagree by provider. An unresolved manager gets a stated gap, never an invented claim.
       */
      return {
        present: false,
        value: null,
        asOf: null,
        servedFrom: null,
        confidence: null,
        conclusive: { ok: true },
        gap: {
          reason: 'not_synced',
          detail: 'No roster is resolved for you in this league yet, so there is nothing to claim onto.',
          remedy: 'Import or re-sync the league so your roster is known.',
        },
      }
    }

    const [pool, calibration] = await Promise.all([
      loadWaiverPool(leagueId, facts.sport, facts.rosterId),
      // The engine's graded record — only in a redraft full-PPR NFL league; elsewhere nothing changes.
      loadWaiverCalibrationForLeague(leagueId),
    ])
    if (pool.availablePlayers.length === 0) {
      /*
       * Distinct from "no roster": the league resolved and the wire is empty after subtraction.
       * Reporting "could not compute" there would be false — it computed, and the answer is nobody.
       */
      return {
        present: false,
        value: null,
        asOf: null,
        servedFrom: null,
        confidence: null,
        conclusive: { ok: true },
        gap: {
          reason: 'not_synced',
          detail:
            pool.leagueRosterCount === 0
              ? 'No rosters are loaded for this league, so the available pool cannot be trusted.'
              : 'Every player in the loaded pool is already rostered in this league.',
          remedy: 'Re-sync the league so the player pool and rosters are current.',
        },
      }
    }

    /*
     * 🛑 A ROSTERED PLAYER WE COULD NOT EVEN NAME MAY STILL BE ON THE WIRE. `loadWaiverPool` hides an
     * ESPN league's untranslated rostered players by their ESPN names; one with no name was not
     * hidden, so any claim could be a player somebody already rosters. Say so rather than recommend.
     */
    if ((pool.untranslatedRostered?.unnamed ?? 0) > 0) {
      return {
        present: false,
        value: null,
        asOf: null,
        servedFrom: null,
        confidence: null,
        conclusive: { ok: true },
        gap: {
          reason: 'not_synced',
          detail: `${pool.untranslatedRostered!.unnamed} rostered player(s) in this league could not be identified, so the free-agent list cannot be trusted.`,
          remedy: 'Re-sync the league so its player identities are current.',
        },
      }
    }

    const result = await runWaiverClaimDecision(
      {
        worldInput: worldInputFromFacts(facts),
        userId,
        leagueId,
        sport: facts.sport,
        rosterId: facts.rosterId,
        // The whole input, built once — shared with /api/ai/waivers/recommend (see engineInput.ts).
        engineInput: waiverEngineInputFrom(facts, pool),
        poolIncomplete: pool.poolIncomplete,
        pricing: pool.pricing,
      },
      { decision: buildLiveWaiverDecisionDeps(facts, calibration.calibration) },
    )

    if (args.onClaims) {
      try {
        const d = result.decision
        args.onClaims(d?.recommended_actions ?? [], typeof d?.confidence === 'number' ? d.confidence : null)
      } catch {
        /* the sink is advisory; the slice below is what the packet needs */
      }
    }

    return decisionToSlice(result.decision, {
      reason: 'not_computed',
      detail: 'The waiver engine returned no decision.',
      remedy: 'It runs again on the next request.',
    })
  } catch (err) {
    return failed('waiver', err instanceof Error ? err.message.slice(0, 120) : 'unknown error')
  }
}
