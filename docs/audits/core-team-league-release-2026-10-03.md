# My Team / League Home release audit — 2026-10-03

## Released P0/P1
PR #2006 merged as 82f42cbd4fc1755dbe98cd698319c7f311104b60. Railway deployment bb134ac8-0f27-47b6-92c4-6e53ea47a25e succeeded. Post-deploy health reports connected database and valid environment; /core, /core/my-team and /core/trades return 200.

## P2/P3 trade release
PR #2015 adds partner roster evidence, saved/current variant comparison, verified saved-history handling, responsive controls and Spanish copy. 10 component regressions and 12 existing API/counteroffer regressions passed in the clean checkout. Chromium/WebKit fixture checks passed at desktop, Android/iOS phone and portrait/landscape tablet sizes. Visible controls measured at least 44px tall, no horizontal overflow or page errors; keyboard return to current analysis works. Screenshots visually reviewed. P3 was not defined in the original backlog; this release uses comparison and responsive polish as the working scope.

## Nested P2 review
Reviewed the Core waiver handoffs/unknown-budget states, Draft HQ entry points, commissioner server role gate, portfolio league links, league-list preferences and notification actions. This was source review, not authenticated end-to-end certification.
A confirmed notification error was fixed: HTTP success with missing or malformed stored preferences previously fell through as empty settings, allowing a mute to replace an existing league override. The read now requires explicit preference evidence and validates league override structure before any write. Explicit null remains valid for a first-time setting. 23 notification regressions passed, including eight malformed-success cases which must send no PATCH.

## Live-score evidence
Production ESPN college game rows matched six current provider games across two polls at 02:04 and 02:06 UTC. TCU's recorded home score changed from 7 to 10 and matched the provider. This verifies sampled backend ingestion; it does not verify signed-in My Team / League Home NFL fantasy totals or their browser polling.

## Open verification
Both supported local browser runtimes fail before access with Windows sandbox "apply deny-read ACLs", including the prescribed reset/retry. A Codex restart was requested. Signed-in per-provider/account refresh, reload/retry recovery, NFL fantasy totals across active-game polls, full nested control interactions, cold/warm timing, and physical iOS/Android/tablet checks remain open. Fixture device profiles are not physical-device certification. No production trade, waiver or settings actions were submitted by tests.
