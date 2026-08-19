/**
 * Decision OS — production dependency wiring for `manager.waiver.claim` (Slice 2).
 *
 * The ONLY place the real engines are referenced for the production path. The decision layer never
 * imports these directly (architecture rule) — they are injected here. Tests use fakes instead, so
 * this file is never exercised by unit tests.
 */
import { runWaiverAIService } from '@/lib/waiver-ai-engine'
import { assertWaiverClaimEligibility } from '@/lib/waiver-wire/transaction-eligibility'
import type { WaiverAIServiceOutput } from '@/lib/waiver-ai-engine'
import type { WaiverWorldFacts } from './loader'
import type { WaiverDecisionDeps } from './decision'
import type { WaiverRuleDeps } from './rules'

function newId(): string {
  return (
    (globalThis.crypto?.randomUUID?.() as string | undefined) ??
    `dec_${Date.now()}_${Math.random().toString(36).slice(2)}`
  )
}

/**
 * Wire the canonical eligibility gate (assertWaiverClaimEligibility — THROWS, does prisma) into the
 * Rule Framework, closed over the loaded league/roster. Read-only. Never rewritten.
 */
export function buildProductionWaiverRuleDeps(facts: WaiverWorldFacts): WaiverRuleDeps {
  return {
    assertEligibility: async (claim) => {
      await assertWaiverClaimEligibility({
        leagueId: facts.leagueId,
        rosterId: facts.rosterId,
        addPlayerId: claim.addPlayerId,
        dropPlayerId: claim.dropPlayerId,
        faabBid: claim.faabBid,
      })
    },
    // validateCanonical seam (second validator for parity) is wired in a later step — composed,
    // never retired. Left undefined here so the active gate stays primary-only.
  }
}

/**
 * Production decision deps. In SHADOW the recommender is fed the already-computed legacy engine
 * output (`memo`) so parity proves wrapper fidelity (the recommender is wrapped, not recomputed).
 * For a non-shadow live run, pass the real recommender instead.
 */
export function buildProductionWaiverDecisionDeps(facts: WaiverWorldFacts, memo: WaiverAIServiceOutput): WaiverDecisionDeps {
  return {
    recommend: async () => memo, // wrap-fidelity: reuse the legacy engine output, no second run
    ruleDeps: buildProductionWaiverRuleDeps(facts),
    newId,
  }
}

/** The real recommender, for a future live (non-shadow) run. Exposed but unused in Slice 2 shadow. */
export function productionWaiverRecommend(): WaiverDecisionDeps['recommend'] {
  return runWaiverAIService
}
