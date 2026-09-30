/**
 * 🛑 WHAT A WAR ROOM SENDS THE PAGE FOR "ANALYZE THIS TRADE" (2026-09-29) — all five War Rooms.
 *
 * Each War Room engine still computes its own accept / reject / neutral `verdict`, the `valueDelta` it
 * was summed from and a `rosterFitDelta` — the War Room trade shadow records them against the one grade
 * (warRoomShadow.ts). None is sent: the verdict on the page is the one grade (warRoomTradeGrade.ts), and
 * the redraft and dynasty panels printed "Verdict: accept · value 9.4" whenever no grade came back.
 * What is sent is the analysis's facts — lineup / bench / age / pick / keeper / direction impact, need
 * and injury flags, missing-data notes.
 *
 * Pure and client-safe (no "server-only"): the panels' client types are built from it.
 */
export type WarRoomTradeAnalysisView<T> = Omit<T, 'verdict' | 'valueDelta' | 'rosterFitDelta'>

export function warRoomTradeAnalysisForClient<T extends { verdict: unknown; valueDelta: unknown; rosterFitDelta: unknown }>(
  analysis: T,
): WarRoomTradeAnalysisView<T> {
  const { verdict: _verdict, valueDelta: _valueDelta, rosterFitDelta: _rosterFitDelta, ...facts } = analysis
  return facts
}
