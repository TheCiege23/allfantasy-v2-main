# Chimmy roster-count evidence verification — September 27, 2026

Live production testing after PR 1415 confirmed current-request focus, selected-league injuries, Best Ball guidance and the provider roster-review destination. It also exposed contradictory summaries: the answer correctly listed six designations but called three tight ends injured, and counted five tight ends instead of the six on the visible roster. QB/RB/WR/TE counts should have been 4/7/8/6 for 25 players at that observation time.

The roster tool now supplies deterministic counts from all synced groups before display truncation, deduplicating IDs and retaining unresolved or conflicting position evidence as UNKNOWN. Missing player IDs are disclosed rather than guessed. The injury tool supplies position totals from distinct findings, with report age and coverage gaps preserved. Shared prompt guidance makes current evidence authoritative over earlier assistant claims, without removing shared conversation memory.

Waiver scenario totals now explicitly describe hypothetical optimized projections under league rules. They do not represent the provider's stored lineup projection or actual/live scores, and do not prescribe manual Best Ball starter swaps.

Validation includes a 25-player roster fixture, duplicate placement copies, unresolved names and positions, conflicting positions, missing IDs, complete counts despite display truncation, cross-league injury deduplication, and the six-designation/two-TE regression. Database queries and AI calls are mocked; the database guard remains first in test setup.

Local and hosted validation, deployment and fresh live answer verification are pending. Do not claim the answer defect fixed in production until the new release is deployed and retested.

Phone (390 CSS px) and tablet (768 CSS px) checks on PR 1415 showed no horizontal document overflow; chat input and send control remained in bounds. The phone screenshot was inspected. A drawer scope-switch observation was inconclusive because Chrome control was interrupted and the verification tab disappeared before it could be reproduced. Draft isolation remains pending.
