/**
 * 🛑 WHAT A WAR ROOM SENDS THE PAGE FOR "ANALYZE THIS TRADE" (2026-09-29) — all five War Rooms.
 *
 * Each War Room engine returns the analysis's facts plus the INPUTS of its retired accept / reject /
 * neutral rule — `valueDelta`, `rosterFitDelta`, and for keeper `keeperSurplusDelta`. The War Room
 * trade shadow derives that retired verdict from them (warRoomLegacyVerdict.ts, warRoomShadow.ts); the
 * engines themselves no longer compute a verdict (2026-09-30), because a verdict outside
 * `lib/decision-os/<domain>/` is what the Decision Engine Boundary guard stops.
 *
 * None of those inputs is sent: the verdict on the page is the one grade (warRoomTradeGrade.ts), and
 * the redraft and dynasty panels printed "Verdict: accept · value 9.4" whenever no grade came back.
 * What is sent is the analysis's facts — lineup / bench / age / pick / keeper / direction impact, need
 * and injury flags, missing-data notes.
 *
 * Pure and client-safe (no "server-only"): the panels' client types are built from it.
 */
export type WarRoomTradeAnalysisView<T> = Omit<T, 'valueDelta' | 'rosterFitDelta' | 'keeperSurplusDelta'>

export function warRoomTradeAnalysisForClient<
  T extends { valueDelta: unknown; rosterFitDelta: unknown; keeperSurplusDelta?: unknown },
>(analysis: T): WarRoomTradeAnalysisView<T> {
  const { valueDelta: _valueDelta, rosterFitDelta: _rosterFitDelta, keeperSurplusDelta: _keeperSurplusDelta, ...facts } =
    analysis
  return facts
}
