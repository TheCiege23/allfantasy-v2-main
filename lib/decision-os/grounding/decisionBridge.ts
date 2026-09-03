import 'server-only'

import type { UserLeague } from '@/app/dashboard/types'
import type { LineupActionItem } from '@/lib/lineup-actions/types'
import { assertLeagueCommissioner } from '@/lib/league/league-access'
import { getCommissionerHubHealthForUser } from '@/lib/commissioner-hub/commissionerHubHealth'
import { loadLineupSetInputs } from '../lineup/loader'
import { runLineupSetDecision } from '../lineup'
import { productionLineupWorldDeps, productionLineupDecisionDeps } from '../lineup/deps'
import { runCommissionerHealthDecision } from '../commissioner-health'
import { buildProductionCommissionerHealthDecisionDeps } from '../commissioner-health/deps'
import type { CommissionerActionSuggestion, CommissionerHealthAssessment } from '../commissioner-health/decision'
import { decisionToSlice, type DecisionFact } from './decisionToSlice'
import type { GroundedSlice, GroundingGap } from './packet'

/**
 * R2.3–R2.5 — producers that RUN a live engine and hand the packet its decision.
 *
 * ── 🛑 WHY THIS IS A SEPARATE MODULE FROM `packet.ts` ───────────────────────────────────────
 * `packet.ts` already carries nineteen imports. Pulling an engine's dependency tree into it would
 * make every consumer of the packet type pay for the lineup loader, and `leagueValueFormat.ts` was
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
 * Running them is cheap: `resolveLineupWorld` and `buildLineupDCO` are pure and synchronous, and
 * the orchestrator's own docstring says Prisma reads live in an injected loader at the route seam.
 * The cost is the loader, and it is one call.
 *
 * ── ⚠ NO SHADOW DEPS ARE PASSED, DELIBERATELY ───────────────────────────────────────────────
 * `runLineupSetDecision` accepts an optional `shadow` that runs the LEGACY recommender too and
 * compares them. That is parity infrastructure for the route that owns it; a chat turn wants the
 * decision, not a second opinion, and passing it would double the work for a comparison nobody
 * reads here.
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

/**
 * One recommended lineup change, in one line.
 *
 * ⚠ NAMED FIELDS ONLY. A generic stringifier over this shape would emit `[object Object]` into a
 * prompt as though it were a fact, which is why `decisionToSlice` requires a describer rather than
 * guessing. Returns null when there is nothing nameable, and the count still reports the action.
 */
function describeLineupAction(a: LineupActionItem): string | null {
  const who = a.playerName ?? a.playerId
  if (!who) return null
  const slot = a.slotLabel ? ` at ${a.slotLabel}` : ''
  const why = a.reasonType ? ` (${a.reasonType})` : ''
  const act = a.recommendedAction ? `${a.recommendedAction}: ` : ''
  return `${act}${who}${slot}${why}`
}

export interface DecisionBridgeArgs {
  userId?: string | null
  leagueId?: string | null
}

/**
 * R2.4 — the lineup decision for this user in this league.
 *
 * ⚠ USER- AND WEEK-SCOPED, WHICH IS WHY IT BELONGS IN THE PACKET AND NOT IN A FEED. The scorecard
 * marks the lineup FEED ineligible for the domain-os store precisely because a lineup fact is
 * never a league fact — it is about one manager in one week. The packet is built per request with
 * a userId, so it can carry what a league-keyed store cannot. That distinction is the reason this
 * bridge lives here.
 */
export async function loadLineupDecisionSlice(args: DecisionBridgeArgs): Promise<GroundedSlice<DecisionFact>> {
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
        detail: 'A lineup decision needs both a signed-in user and a league.',
        remedy: 'Ask about a specific league while signed in.',
      },
    }
  }

  try {
    const input = await loadLineupSetInputs(userId, leagueId)
    if (!input) {
      /*
       * ⚠ A NULL LOADER RESULT IS NOT AN ERROR AND MUST NOT READ AS ONE. `loadLineupSetInputs`
       * returns null when the league has no roster for this user or no resolved season — normal
       * states for an unimported or off-season league, and `not_synced` is the honest reason.
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
          detail: 'No roster or season is resolved for this user in this league yet.',
          remedy: 'Import or re-sync the league so the roster and current week are known.',
        },
      }
    }

    const result = await runLineupSetDecision(input, {
      world: productionLineupWorldDeps(),
      decision: productionLineupDecisionDeps(),
      // No `shadow` — see the header.
    })

    return decisionToSlice(result.decision, {
      reason: 'not_computed',
      detail: 'The lineup engine returned no decision.',
      remedy: 'It runs again on the next request.',
    }, { describeAction: describeLineupAction })
  } catch (err) {
    return failed('lineup', err instanceof Error ? err.message.slice(0, 120) : 'unknown error')
  }
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
function describeCommissionerAssessment(a: CommissionerHealthAssessment): string | null {
  if (!a) return null
  const parts: string[] = []
  if (a.overallStatus) parts.push(String(a.overallStatus))
  if (typeof a.healthScore === 'number') parts.push(`health ${a.healthScore}`)
  // The alerts are the substance a commissioner acts on; bounded, because a struggling league can
  // carry a lot of them and this line ends up in a prompt.
  const alerts = Array.isArray(a.topAlerts) ? a.topAlerts.filter((x) => typeof x === 'string') : []
  if (alerts.length > 0) parts.push(`alerts: ${alerts.slice(0, 3).join('; ')}`)
  const suggestions = Array.isArray(a.suggestedActions)
    ? a.suggestedActions.map((s: CommissionerActionSuggestion) => s?.label).filter((l): l is string => Boolean(l))
    : []
  if (suggestions.length > 0) parts.push(`suggested: ${suggestions.slice(0, 3).join(', ')}`)
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
 * accepted and paid for by the flag instead: `want.commissionerHealthDecision` defaults OFF.
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
    const access = await assertLeagueCommissioner(leagueId, userId)
    if (!access?.ok) return notEntitled()

    // Safe to assert: the line above verified it. The loader filters on this flag.
    const minimal = [{ id: leagueId, isCommissioner: true } as unknown as UserLeague]
    const snapshots = await getCommissionerHubHealthForUser(userId, minimal)
    const snapshot = snapshots.find((s) => s?.leagueId === leagueId) ?? null

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
      { decision: buildProductionCommissionerHealthDecisionDeps(snapshot) },
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
