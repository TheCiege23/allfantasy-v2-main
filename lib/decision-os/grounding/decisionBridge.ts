import 'server-only'

import type { LineupActionItem } from '@/lib/lineup-actions/types'
import { loadLineupSetInputs } from '../lineup/loader'
import { runLineupSetDecision } from '../lineup'
import { productionLineupWorldDeps, productionLineupDecisionDeps } from '../lineup/deps'
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
