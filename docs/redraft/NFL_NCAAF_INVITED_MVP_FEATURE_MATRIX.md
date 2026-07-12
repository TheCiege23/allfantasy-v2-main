# NFL & NCAAF Invited MVP Feature Freeze

Date: 2026-07-12

This matrix freezes source scope for the invited MVP. “Included” means source-complete with deterministic tests; it does not replace authenticated runtime, database, multiplayer, mobile-browser, or live-provider certification.

## Classification key

- **Included** — in invited-MVP source scope.
- **Included with limitation** — exposed with a stated product limit.
- **Hidden** — not customer-reachable in this MVP.
- **Deferred** — outside the invited MVP.
- **Requires certification** — source-present but cannot be advertised as runtime-proven yet.

## NFL Redraft

| Capability | Freeze decision | Customer truth / limit |
| --- | --- | --- |
| Create league | Requires certification | Canonical creation and source regressions pass; authenticated DB-backed journey remains G48. |
| Sleeper import | Requires certification | Preview, commissioner gate, commit, warnings, and duplicate handling are source-tested; real account import remains G48. |
| ESPN/Yahoo/Fantrax/MFL/Fleaflicker import | Requires certification | Exposed only where canonical adapter is enabled; connection and real-provider behavior remain uncertified. |
| Snake draft | Requires certification | Authoritative live engine is source-tested; authenticated multiplayer completion remains G53B. |
| Linear draft | Requires certification | Source-supported; authenticated completion required. |
| Auction draft | Deferred | Separate live services exist but invited-MVP certification is incomplete. Mock auction remains hidden/rejected. |
| Mock draft | Included with limitation | Snake/linear preparation only; not evidence for live-draft persistence. |
| Live draft | Requires certification | Pick authority, retry idempotency, queue, timer, chat, and commissioner controls are source-present. |
| Draft-pick trades | Included with limitation | Proposal/ownership UI included; on-clock multiplayer propagation and reversal are not certified. |
| Commissioner controls | Requires certification | Permission-gated source paths included; destructive actions require authenticated review. |
| Lineups | Requires certification | Lock/eligibility/save/reconciliation source-ready; real persistence required. |
| Waivers | Requires certification | Claims, FAAB/priority, status, cancellation where supported; real processing required. |
| Trades | Requires certification | Proposal/actions/history included; Trade P0 reversal excluded. |
| Schedule | Included | Canonical source and navigation tested; real season contents still depend on authenticated lifecycle. |
| Standings | Included | Authoritative service order rendered; pending corrections disclosed. |
| Playoffs | Requires certification | Generate/advance/finalize source-present; full season certification required. |
| Chat | Requires certification | Membership-gated persistence source-present; multi-user ordering/mobile behavior required. |
| Mentions | Included with limitation | Styling/autocomplete/source identity paths included; mention delivery is not advertised as certified. |
| Draft Assist | Included with limitation | Deterministic recommendations and customer explanations; freshness depends on certified data. |
| Player stats | Requires certification | Honest unavailable states; live completeness/freshness remains G52. |
| Projections | Requires certification | No fabricated values; live-provider certification required. |
| Injuries | Requires certification | Canonical ingestion/source paths exist; freshness required. |
| Mobile web | Requires certification | Responsive source exists; 390×844 runtime review blocked. |

## NCAAF Redraft

| Capability | Freeze decision | Customer truth / limit |
| --- | --- | --- |
| Create league | Requires certification | Canonical NCAAF defaults/source contracts exist; authenticated DB journey required. |
| Sleeper import | Hidden | NFL-only in the audited provider UI. |
| Fantrax import | Requires certification | Only provider currently labelled for NCAAF; real import required. |
| Other provider imports | Hidden | Not advertised for NCAAF. |
| Snake draft | Requires certification | Sport-isolated pool path source-tested; authenticated NCAAF room required. |
| Linear draft | Requires certification | Source-supported; authenticated completion required. |
| Auction draft | Deferred | Not in invited NCAAF MVP certification scope. |
| Mock draft | Included with limitation | Snake/linear; NFL pool leakage is guarded. |
| Live draft | Requires certification | Shared authority with NCAAF isolation; multiplayer certification required. |
| Draft-pick trades | Included with limitation | Shared source path; real propagation uncertified. |
| Commissioner controls | Requires certification | Shared permission gates; real NCAAF workflow required. |
| Lineups | Requires certification | Shared lock/save/reconciliation with sport-specific eligibility; real persistence required. |
| Waivers | Requires certification | Shared engine/UI; real NCAAF pool and processing required. |
| Trades | Requires certification | Shared customer flow; reversal excluded. |
| Schedule | Included with limitation | Canonical sport-neutral surface; provider/lifecycle data required. |
| Standings | Included | Shared authoritative ordering and pending-correction truth. |
| Playoffs | Requires certification | Shared source path; NCAAF season completion required. |
| Chat | Requires certification | Shared league-scoped backend; multi-user proof required. |
| Mentions | Included with limitation | Same limitation as NFL; no delivery claim. |
| Draft Assist | Included with limitation | Sport-isolated inputs; provider freshness not certified. |
| Player stats | Requires certification | NCAAF pending/unavailable state remains visible when data is incomplete. |
| Projections | Requires certification | No NFL fallback claim; live NCAAF data required. |
| Injuries | Requires certification | Canonical path exists; completeness/freshness required. |
| Mobile web | Requires certification | Responsive source exists; runtime visual review blocked. |

## Explicit exclusions

- Trade reversal certification and Renewal Gate C.
- Mock auction and uncertified live auction.
- Unsupported NCAAF provider imports.
- Provider freshness claims.
- Authenticated, multiplayer, database-backed, or mobile-runtime claims without physical evidence.
- Platform-admin controls on commissioner surfaces.

Changes to this matrix require a separately validated phase; source presence alone cannot promote “Requires certification” to “Included.”
