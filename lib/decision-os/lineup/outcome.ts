/**
 * Decision OS — Outcome/Learning hooks for `manager.lineup.set` (Slice 1).
 *
 * MINIMAL placeholders only — the full Learning/Decision-Quality system (Decision↔Outcome nodes,
 * confidence recalibration) is a later slice. These lightweight events mark the seams; the actual
 * projected-vs-actual comparison will reuse scoringEngine / playerWeeklyScoreService / live-scoring.
 */
import { emitDecisionTelemetry } from '@/lib/decision-os/core/telemetry'

export type LineupOutcomeEvent =
  | 'decision_accepted'
  | 'decision_ignored'
  | 'lineup_result_available' // scoring finalized — compute projected-vs-actual (TODO: reuse scoring)
  | 'projected_vs_actual'

export function recordLineupOutcome(
  decisionId: string,
  event: LineupOutcomeEvent,
  meta?: Record<string, unknown>,
): void {
  const telemetryEvent = event === 'decision_accepted' ? 'decision.adopted' : 'decision.resolved'
  emitDecisionTelemetry(telemetryEvent, 'manager.lineup.set', { outcome_event: event, ...meta }, decisionId)
}
