# Decision OS completion checklist

Scope: the complete Decision OS delivery requested from the repository audit, including integration, privacy, learning, certification and release. This is not a percentage of all existing AllFantasy features.

There are 50 acceptance milestones worth 2 points each, for a fixed 100-point denominator. A milestone earns its points only after its described behavior and tests are complete. Partial implementations earn no points. Existing infrastructure earns credit only where it satisfies an acceptance milestone. This is an engineering progress estimate, not a prediction of remaining time. Changes to scope must be recorded rather than silently changing the denominator.

Baseline on continuation: **18/100 points (18%)**. Production readiness: **not certified**. No production rollout is implied by implementation progress.

Current verified implementation: **34/100 points (34%)**.

| ID | Acceptance milestone | Points | Status |
| --- | --- | --- | --- |
| 01 | Authenticated redraft/dynasty market selection with regression tests | 2 | Complete |
| 02 | Refuse full trades with explicitly unpriced material assets | 2 | Complete |
| 03 | Preserve canonical market and IDP enrichment through both memo paths | 2 | Complete |
| 04 | Separate market, league and user value contracts with unknown-value invariants | 2 | Complete |
| 05 | Component scoring and roster-demand mathematical invariants | 2 | Complete |
| 06 | Exact flex lineup and marginal roster-change calculations with legality inputs | 2 | Complete |
| 07 | Multi-team movement and add/drop utility arithmetic | 2 | Complete |
| 08 | Default-off V2 shadow capture in canonical snapshots and trade console | 2 | Complete |
| 09 | League-aware kicker/IDP waiver eligibility and canonical scorer ownership | 2 | Complete |
| 10 | Versioned market cohort keys and full league fingerprints | 2 | Complete |
| 11 | Producer-backed market observations with original timestamps | 2 | Complete |
| 12 | Market input freshness, identity, cohort and coverage refusal gates | 2 | Complete |
| 13 | Verified market observations consumed by both runtime shadow paths | 2 | Complete |
| 14 | Persist exact cohort metadata through the market ingest history | 2 | Complete (test and production migration verified) |
| 15 | Liquidity and uncertainty estimation calibrated against observed markets | 2 | Pending |
| 16 | Exact league scoring and topology adapters from authenticated runtime facts | 2 | Complete (supported NFL rules; unmapped inputs refuse) |
| 17 | Replacement pools and best feasible open-slot value at runtime | 2 | Pending |
| 18 | First downs, threshold bonuses and kick-distance runtime scoring parity | 2 | Pending |
| 19 | Dynasty competitive-window resolver from real team facts | 2 | Pending |
| 20 | Before/after playoff and survival scenarios wired to trade and waivers | 2 | Pending |
| 21 | Evidence-backed 1/3/5-year utility and risk conversion coefficients | 2 | Pending |
| 22 | Runtime devy and college/C2C valuations and identities | 2 | Pending |
| 23 | Runtime keeper rights and keeper-cost valuations | 2 | Pending |
| 24 | Runtime contract/salary value and cap constraints | 2 | Pending |
| 25 | Best-ball, guillotine and specialty-format marginal utility adapters | 2 | Pending |
| 26 | Route-to-engine map and characterization fixtures for every surface | 2 | Pending |
| 27 | All trade surfaces consume V2 adapters with parity telemetry | 2 | Pending |
| 28 | Runtime waiver add/drop optimization with FAAB/priority opportunity costs | 2 | Pending |
| 29 | Draft recommendations consume canonical marginal utility | 2 | Pending |
| 30 | Lineup recommendations consume canonical inputs and retain lock/rule parity | 2 | Pending |
| 31 | Frontend separates market value, league value and personalized utility | 2 | Pending |
| 32 | Raw behavioral profiles unavailable through all public API paths | 2 | Pending (profile-system paths closed; separate Manager DNA and cached-output audit remains) |
| 33 | Competitive Edge UI exposes only decision-scoped evidence | 2 | Pending |
| 34 | Bounded acceptance and counteroffer model with evidence floors | 2 | Pending |
| 35 | Durable owner-scoped strategy state with concurrency control | 2 | Complete (database and owner API verified) |
| 36 | Confirmed strategy changes through Chimmy with hysteresis | 2 | Complete (trusted completed-week producer, confirmation UI and advice integration tested) |
| 37 | Chimmy consumes one deterministic V2 decision envelope | 2 | Pending |
| 38 | Automatic historical retrieval with evidence and coverage labels | 2 | Pending |
| 39 | Cancellable deadlines propagated through actual expensive producers | 2 | Pending |
| 40 | Durable multi-horizon decision/outcome ledger | 2 | Pending |
| 41 | Scheduled 30d/EOS/1y/3y/5y regrade workers with idempotency | 2 | Pending |
| 42 | Realized outcome attribution separates injuries, usage and later moves | 2 | Pending |
| 43 | Cohort backtests, acceptance/value calibration and drift monitoring | 2 | Pending |
| 44 | Persisted model registry with audited promotion and rollback | 2 | Pending |
| 45 | Sleeper and ESPN provider certification fixtures and scoring parity | 2 | Pending |
| 46 | Yahoo, MFL, Fleaflicker and Fantrax certification and capability matrix | 2 | Pending |
| 47 | Real coaching/personnel/red-zone sources and projection-factor validation | 2 | Pending |
| 48 | Repository build and authenticated browser integration gates pass | 2 | Pending |
| 49 | Deployed flags, identity coverage, latency and cohort accuracy verified | 2 | Pending |
| 50 | Controlled authority cutover and tested production rollback | 2 | Pending |

## Change log

- Manager DNA continuation: retired dedicated legacy/canonical/mock-draft/v1/profile-summary paths, preserved authenticated dashboard activity without dossiers, removed DNA card/scouting UI and excluded inferred profiles from legacy AI prompts and cached trade-email rendering. **Progress remains 34%**. User OS/command-center compositions, legacy career reports and remaining replay/export boundaries still need verification before milestone 32 is complete. Validation: 284 tests in 30 suites passed; focused typecheck passed for 112 files. No migration or authority flag change.

- Competitive Edge privacy continuation: closed profile browsing/generation routes and known profile projections in Scout, relationship/rivalry responses, Chimmy, history fingerprints and trade-context labels. Replaced profile browsing UI with an honest Competitive Edge entry. **Progress remains 34%**: the separate Manager DNA system and historical/cached outputs still require audit, so milestone 32 earns no partial credit. See `DECISION_OS_COMPETITIVE_EDGE_PRIVACY_STATUS.md` for the exact implemented boundary and next work.

- Chimmy strategy continuation: milestone 36 completed; **34%**. A trusted producer reconstructs complete NFL standings from finished weekly results in the recorded season. Visits record only the latest completed week, never replay history to simulate persistence; duplicate visits do not advance a proposal. Three consecutive observed weeks and an explicit owner confirmation are required. Current evidence, historical corrections, team identity, revision conflicts and league switching are checked. Chimmy reads the saved active preference in both standard and optional tool-loop paths. 184 tests passed across 17 suites; the expanded Chimmy route suite subsequently passed 19 tests (186 distinct tests across these runs). Focused typecheck passed for 51 files. No new migration, application deployment or authority cutover. Dynasty-window calibration (19), the deterministic V2 envelope (37) and authenticated browser/release certification (48–50) remain pending.

- Baseline: 9 completed milestones × 2 points = 18%. Pure strategy and learning helpers do not earn durable runtime milestones.
- Market contracts: milestones 10–12 verified with cohort/fingerprint, observation, stale-cache and refusal tests; 24%. Legacy history remains explicitly incomplete where team count and PPR were never stored.
- Runtime market integration: milestone 13 verified through enrichment, both canonical memo paths, shared snapshots and the console adapter. 132 tests passed across nine suites; 26%.
- League adapters and persisted observation contract: milestones 14 and 16 implemented and tested; 30%. Includes exact custom reception/TE bonuses, specific IDP eligibility, recorded team capacity, metadata writes, daily retry behavior and partial failures. Prisma schema/client generation and focused source/test type checking passed. The additive database migration has not been applied; milestone 49 remains pending. This is implementation credit, not database or deployment certification.
- Migration continuation: applied and verified `20260909130000_decision_os_market_observations` on the test and production databases, including exact column types and Prisma checksums. Test write/read proof rolled back. No extra points: milestone 14 was already counted.
- Strategy persistence: milestone 35 completed; **32%**. Added owner/league/season state, atomic revision checks plus audit events, authenticated read/confirmation endpoint and stale-observation protection. Test PostgreSQL verification proved initialization races, one winning confirmation, owner isolation and audit-failure rollback; synthetic rows removed. Applied and verified `20260909140000_decision_os_strategy_state` in test and production. 132 tests passed in 11 suites; focused typecheck passed for 37 files. Milestone 36 remains pending: trusted weekly producer and Chimmy confirmation UI are not connected. Application deployment and overall production certification remain pending.
