/**
 * The War Rooms' RETIRED accept / reject / neutral rule — shadow telemetry only.
 *
 * All five War Room trade engines (redraft, dynasty, keeper, guillotine, best ball) used to finish
 * their analysis with the same private verdict: `composite = valueDelta + 1.5 × rosterFitDelta`
 * (+ the keeper engine's surplus term), `≥ 3` accept, `≤ −3` reject, else neutral; `needs_more_data`
 * with no value signal; `disabled` when the league has trades off.
 *
 * 🛑 NO USER SEES THIS. Since 2026-09-28/29 the verdict on every War Room is THE grade
 * (`warRoomTradeGrade.ts`), and the page receives only the analysis's facts (`warRoomTradeView.ts`).
 * The rule survives for one reader: the War Room trade shadow (`warRoomShadow.ts`), which records it
 * against the canonical stack so the divergence stays measurable (legacyParity.ts).
 *
 * It lives HERE, not in the engines, because a verdict computed outside `lib/decision-os/<domain>/`
 * is exactly what `scripts/check-decision-engine-boundary.mjs` exists to stop — the engines now return
 * facts and the inputs below, and nothing else. Do not import this from a route, panel or prompt: a
 * second verdict beside the one grade is the thing that was removed.
 *
 * Pure; no I/O. Must not import a War Room module (`__tests__/decision-os/trade-architecture.test.ts`).
 */

export type WarRoomLegacyVerdict = 'accept' | 'reject' | 'neutral' | 'needs_more_data' | 'disabled'

export type WarRoomVerdictInputs = {
  /** Incoming − outgoing value on the engine's own scale; null means no value signal at all. */
  valueDelta: number | null | undefined
  rosterFitDelta: number | null | undefined
  /** The keeper engine's surplus term (±, capped per player there). Absent for the other four. */
  keeperSurplusDelta?: number | null
  /** Guillotine and best ball can switch trades off. Absent means enabled. */
  tradesEnabled?: boolean
}

export function warRoomLegacyVerdict(input: WarRoomVerdictInputs): WarRoomLegacyVerdict {
  if (input.tradesEnabled === false) return 'disabled'
  if (input.valueDelta == null) return 'needs_more_data'
  const composite = input.valueDelta + (input.rosterFitDelta ?? 0) * 1.5 + (input.keeperSurplusDelta ?? 0)
  if (composite >= 3) return 'accept'
  if (composite <= -3) return 'reject'
  return 'neutral'
}
