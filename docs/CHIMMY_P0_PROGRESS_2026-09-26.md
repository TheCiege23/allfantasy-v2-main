# Chimmy P0 — first implementation batch

This starts the three P0 items in the [intelligence audit](./CHIMMY_INTELLIGENCE_AUDIT_2026-09-26.md). It is not a P0 completion or production release.

## Shared evidence and authority contract

Implemented a versioned decision-answer contract with decision type, explanation-only authority, ready/missing-data status, authorized league identity, source categories and actionable gaps. The main Chimmy route (used by bubble/full chat and public league advice) and generic private mention replies now use the same membership-checked decision service for recognized trade, lineup and waiver action questions.

Engine output supplies the answer's pick, grade, projection and comparison. The model cannot replace those fields because this path returns the engine-derived response before model execution. Missing settings, roster, projection or valuation evidence produces a specific next step. It never substitutes a generic market valuation as a league decision. Narrative and factual conversations retain their existing paths.

The service supports named trade comparisons, trade-target verdicts, engine-generated trade ideas, named add/drop comparisons, two-player start/sit and full lineup optimization. Trade ideas explicitly remain starting offers rather than completed verdicts. FAAB bids without waiver-engine evidence produce a gap. Engine-supported start/sit calls retain advice tracking after delivery. Private reply metadata stores the same contract without changing sender-only visibility.

Main-chat missing-data outcomes return before token spending or allowance consumption. Ready outcomes retain the existing token confirmation and subscription allowance flow. Private mentions retain their existing billing behavior; this batch does not introduce a new charge on that surface.

This is deliberately a bounded first authority slice. The classifier is not proof that every possible natural-language action request is covered. Specialty league handlers, playoff probabilities, draft advice, unsolicited recommendations in narrative answers, and compound questions still need shared-contract coverage and behavioral evaluation. User-facing model explanations can be layered onto the canonical result later, with validation that they preserve the engine's decisions and limits.

## Billing on delivery

The primary tool-loop return now judges delivery before returning, matching the existing fallback path's intent. Recognized non-answers use the original spend-ledger refund identity, release the included answer when applicable, and report actual refunded cost. Refund failure is reported as pending rather than falsely claiming zero cost. Non-delivered tool-loop replies do not write start/sit advice.

The allowance release service now reports success/failure instead of swallowing failure and letting the UI claim the answer was given back. Both the tool-loop settlement and fallback response honor that result.

Still open: request-level retry deduplication, allowance reservation/release identity and day-boundary behavior, refund reconciliation after database failure, and live confirmation/exhaustion tests. Returning the same refund key is not proof that a whole chat request is idempotent.

## Live Chrome audit

Verified against the deployed site, separately from these local changes:

- Poll form accepted a question and two options, staged a pending poll, and removed it without sending.
- GIF picker loaded KLIPY results, accepted a football search, staged a selected GIF, and removed it without sending.
- Keyboard entry opened the private `@chimmy` suggestion and selection inserted the mention. No league message was sent.
- Deployed GIF selection buttons have no accessible names. The local source already includes those names; this batch does not claim authorship of that fix or production verification.
- Discord setup showed account linking, bot installation, channel creation, invite and copy controls. The selected league has no configured channel; outbound copying is disabled. Inbound copying is explicitly unavailable in the deployed UI.
- Browser navigation/control interruptions remain intermittent. A recipient lookup was started but not verified; no DM was sent.

The user designated two test accounts. Receiving-side verification needs the second account signed into a separate Chrome profile. The supplied Discord identifiers do not yet identify a disposable channel link/ID. No bot permissions, server membership, channels, bridge settings or invites were changed.

## Validation

Initial shared-service checks: 109 passed. Expanded engine, tool-loop, security and routing run: 608 passed. Subsequent focused runs caught two source-wiring assumptions (three paid response shapes became four; allowance release now returns a status). Those assertions were corrected; the final focused run passed all 135 tests.

Final expanded regression run: **797 passed, 3 skipped**, across 20 files (19 passed and one skipped). The skipped tests require Prisma chat-model integration support unavailable in the test runtime. This is not evidence of real two-account delivery.

Full TypeScript checking completed and reported repository errors outside the changed Chimmy files, including World Cup types and draft routes. The final incremental run also completed with those repository errors and no diagnostics in the changed Chimmy files. This is not a clean repository typecheck. The changed-file whitespace check passed.

Changes are local. No deployment, merge or purchase was performed.
