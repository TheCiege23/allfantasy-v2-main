/**
 * Compatibility re-export. Waiver candidate scoring now lives in the waiver engine.
 *
 * 🛑 THE VERDICT MOVED BECAUSE IT WAS DECLARED OUTSIDE THE ENGINE.
 * `scripts/check-decision-engine-boundary.mjs` reported `scoreWaiverCandidates` here as one of its
 * backlog violations: an export whose NAME claims to answer a domain question, sitting outside
 * `lib/decision-os/waiver/`. CI runs that guard in `--changed` mode, so the violation fires for any
 * PR that touches this file — which is what made the position-coverage fix in the next commit
 * impossible to land here. Moving it is the guard's own prescribed resolution, not a way around it.
 *
 * ⚠ THIS FILE STAYS so the move is not a 16-importer rename. Ten modules and two suites import
 * `ScoredWaiverTarget`, `WaiverRosterPlayer` or `WaiverScoringContext` from this path; a re-export
 * declares no name of its own, so the guard is satisfied and every one of them keeps working.
 * Prefer `@/lib/decision-os/waiver/candidateScoring` in new code.
 */
export * from '@/lib/decision-os/waiver/candidateScoring'
