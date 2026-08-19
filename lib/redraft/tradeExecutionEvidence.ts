/**
 * Shared types for the immutable trade execution snapshot's structured
 * validation evidence. A snapshot's `validations` field must record what was
 * actually re-checked at settlement time, not just a static "passed" flag —
 * this is what makes the snapshot sufficient for deterministic reversal
 * preflight and audit reconstruction (it proves which specific player/roster
 * was checked, not merely that "checks happened").
 */

export type TradeValidationEvidence = {
  check: string
  result: 'passed' | 'failed' | 'skipped'
  subjectId?: string | null
  detail?: string | null
  evaluatedAt: string
}

export function passedEvidence(check: string, subjectId?: string | null, detail?: string | null): TradeValidationEvidence {
  return { check, result: 'passed', subjectId: subjectId ?? null, detail: detail ?? null, evaluatedAt: new Date().toISOString() }
}
