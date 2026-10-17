# Chimmy roster-count evidence verification — September 27, 2026

Live production testing after PR 1415 confirmed current-request focus, selected-league injuries, Best Ball guidance and the provider roster-review destination. It also exposed contradictory summaries: the answer correctly listed six designations but called three tight ends injured, and counted five tight ends instead of the six on the visible roster. QB/RB/WR/TE counts should have been 4/7/8/6 for 25 players at that observation time.

The roster tool now supplies deterministic counts from all synced groups before display truncation, deduplicating IDs and retaining unresolved or conflicting position evidence as UNKNOWN. Missing player IDs are disclosed rather than guessed. The injury tool supplies position totals from distinct findings, with report age and coverage gaps preserved. Shared prompt guidance makes current evidence authoritative over earlier assistant claims, without removing shared conversation memory.

Waiver scenario totals now explicitly describe hypothetical optimized projections under league rules. They do not represent the provider's stored lineup projection or actual/live scores, and do not prescribe manual Best Ball starter swaps.

Validation includes a 25-player roster fixture, duplicate placement copies, unresolved names and positions, conflicting positions, missing IDs, complete counts despite display truncation, cross-league injury deduplication, and the six-designation/two-TE regression. Database queries and AI calls are mocked; the database guard remains first in test setup.

Local validation passed 128 unique tests across seven suites: 96 count, injury, prompt and scenario tests plus 32 My Team board tests. Hosted validation, deployment and fresh live answer verification are pending. Do not claim the answer defect fixed in production until the new release is deployed and retested.

Phone (390 CSS px) and tablet (768 CSS px) checks on PR 1415 showed no horizontal document overflow; chat input and send control remained in bounds. The phone screenshot was inspected. A fresh dedicated Chrome tab passed scope/draft isolation: selecting KBFL showed an empty draft, returning to Best Ball restored its unsent question, and neither switch auto-submitted anything.

The explicit account-wide production test correctly expanded beyond the selected KBFL league and disclosed 39 readable rosters, one empty roster, the 40-league scan cap and 24 unscanned leagues. It also exposed misleading action guidance: the injury tool said to lead with Out/IR starters as actions without checking kickoff locks. That block now describes stored roster placement, explicitly discloses unverified locks/transaction/AutoSubs eligibility, and requires verification before actionable swaps. Shared request guidance reinforces this distinction. The cross-league scan remains partial by design; this patch does not claim complete account-wide injury coverage.

Roster activity tokens ACT/INACT (including canonical rows and the undated player-feed fallback) are now excluded from injury designations, consistent with the existing portfolio injury contract. A dedicated regression retains a genuine IR while excluding ACT, INACT, Active and NA from both sources. This corrects inflated cross-league injury totals without declaring those players healthy or eligible for transactions.

The inventory and its Back to lineup priorities link passed live. The priorities footer nevertheless described excluded pre-draft/completed/inactive leagues as set, and displayed a zero Best Ball count when those teams had been excluded earlier. The board now prints only positive exclusion counts and labels the remaining group as having no manual task or being excluded, rather than claiming every excluded lineup was checked and set.

The footer also uses the loader's full needsTotal so urgent teams beyond the top-ten display are described as still needing review. A truncated-payload regression verifies that those teams are not falsely called set.

Database-enforced READ ONLY verification of the patched tools also passed without AI calls. The selected Best Ball roster returned 25 players (QB 4, RB 7, TE 6, WR 8) and eight stored designations (QB 1, RB 4, TE 2, WR 1), retaining dates and stale-report flags. The explicit NFL cross-league read checked 39 readable leagues and 430 distinct players and returned 67 designations with no ACT/INACT leakage. It still disclosed 24 unscanned leagues at the 40-league cap and one empty synced roster. These are dated saved-data measurements, not proof of final model prose or complete account-wide coverage.

Empty starter-slot markers (player ID 0) are excluded from distinct-player totals and rendered as empty slots rather than unnamed athletes. Regression assertions cover a full roster with a vacant starter and ensure capacity/placeholder rows do not inflate its player count.

Vacant slot markers also skip injury identity lookups and do not create false unidentified-player coverage gaps. The six-designation fixture uses nonzero athlete IDs so it remains distinct from an empty provider slot.
