# NFL Invited MVP RC1 Risk Register

Scale: severity `P0–P3`; likelihood `High/Medium/Low`. P0/P1 blocks release. P2 requires explicit owner disposition. Owners are accountable roles, not claims that a person accepted the assignment.

| Rank | Category | Risk | Severity | Likelihood | Impact | Mitigation | Certification step | Owner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Operational/source | RC package is a large mixed uncommitted worktree, not a reproducible SHA | P1 | High | Wrong files can ship; evidence cannot bind to candidate | Isolate release-owned diff, remove artifacts, commit, review exact SHA | Rerun all RC checks and inventory on frozen SHA | Release owner |
| 2 | Runtime | Authenticated full-season journey has not run | P1 | High | Create/import/draft/season defects may remain undiscovered | Certified non-prod DB and real commissioner/managers | G59 journey checklist | Product QA |
| 3 | Runtime | Multiplayer draft not physically certified | P1 | High | Lost/duplicate picks, desync or reconnect defects | Three independent authenticated clients and disposable drafts | Multiplayer certification script | Draft QA |
| 4 | Provider | Live scoring/injury/valuation freshness and fallback unverified | P1 | High | Incorrect or stale customer decisions/matchups | Authorized providers, trace/cache/health packet, outage tests | Provider matrix | Data QA |
| 5 | Source | Full TypeScript check timed out | P1 if redraft-relevant; otherwise P2 | Medium | Hidden compile error can block build/release | Run clean exact-SHA typecheck with adequate resources; classify every diagnostic | Gate 2 | Build owner |
| 6 | Operational | Non-production DB identity/access remains uncertified in prior attempts | P1 | Medium | Wrong environment or unsafe mutation | Positive control-plane lineage and DB identity before writes | Certification stop gate | Infrastructure owner |
| 7 | UX/runtime | Mobile 390×844 workflows not physically certified | P1 if action blocked; otherwise P2 | Medium | Managers cannot draft/transact on mobile | Real mobile viewport across core journey, console/network capture | Mobile gate | UX QA |
| 8 | Runtime | Invite delivery, expiry, dedupe and join assignment unverified | P1 | Medium | League cannot onboard managers | Real mail/delivery path and two identities in safe environment | Invite checklist | Membership QA |
| 9 | Runtime | Post-draft roster and season completion persistence unverified | P1 | Medium | League may not transition or record champion | Complete disposable draft/season and inspect persisted invariants | Lifecycle checklist | League QA |
| 10 | Provider | Trace history, bounded timeouts and per-attempt latency are incomplete | P2; P1 if load-bearing call hangs | Medium | Certification ambiguity or poor outage behavior | External timing/correlation during run or narrow instrumentation | Provider failure scenarios | Data platform owner |
| 11 | UX | Customer copy could regress to provider branding/internal “AI” wording | P2 | Medium | Confusing/overpromised customer experience | G58/G60 source guardrails and review | Source runner plus route smoke | Product owner |
| 12 | Source/UX | Auction services exist although auction is deferred | P1 if reachable; otherwise P2 | Medium | Unsupported mode is accidentally advertised/created | Feature matrix, creation/settings rejection or hidden selection | Negative mode checks | Draft owner |
| 13 | Source/UX | Provider import list can diverge from sport support | P1 if wrong-sport commit; otherwise P2 | Medium | NCAAF user sees an unusable NFL provider | Canonical provider support config and sport-filter runtime check | Create/import certification | Import owner |
| 14 | Runtime | Chat mention canonical identity/delivery unverified | P2 | Medium | Wrong user mention or misleading notification promise | Duplicate-name multi-client case; do not claim delivery absent evidence | Chat checklist | Collaboration owner |
| 15 | Operational | Notification exactly-once/delivery behavior unverified | P2; P1 for critical transaction notices | Medium | Duplicate/missing customer notices | Trigger each event and compare persisted/delivery IDs | Notification checklist | Messaging owner |
| 16 | UX | Disabled/placeholder controls may exist outside curated reachable paths | P2 | Low–Medium | Dead-end or confusing action | Authenticated click audit of every advertised RC surface | Browser journey | UX QA |

## Release policy

- Any P0: stop, preserve evidence, isolate/rollback using the established path.
- Any P1: RC cannot advance to owner approval until fixed and recertified.
- Any P2: record issue, owner, target and explicit owner acceptance before launch.
- Any P3: may defer with a tracked issue if it does not mislead, reduce accessibility or block an action.

Current top blocker is reproducibility of the candidate itself, followed by the external runtime gates. No percentage increase is justified by this register.
