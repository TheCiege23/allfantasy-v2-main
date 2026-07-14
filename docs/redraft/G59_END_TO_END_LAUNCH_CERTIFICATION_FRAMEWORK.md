# G59 — NFL & NCAAF End-to-End Launch Certification Framework

## Purpose and evidence policy

This is the permanent release-certification framework for redraft invited-MVP releases. A result may advance only to the evidence level actually exercised:

| Label | Meaning |
| --- | --- |
| Source verified | Implementation and route/service wiring were inspected. |
| Test verified | A named deterministic suite passed without skips, retries, or timeouts. |
| Browser verified | The real rendered application was exercised in a JavaScript browser. |
| Authenticated verified | A real authorized role completed the workflow against the declared environment. |
| DB-backed verified | Authoritative persisted state was inspected before and after the action. |
| Live provider verified | Authorized external provider data, freshness, cache and failure behavior were observed. |

Fixtures and mocked identities can support source tests but can never satisfy browser, authenticated, DB-backed, multiplayer, or live-provider gates. Every evidence item must record timestamp, environment, build SHA, sport, league/draft ID where applicable, role, expected result, observed result, and artifact location. Secrets and raw credentials are prohibited.

## Customer journey certification matrix

Statuses below describe the current highest honest level. `Runtime blocked` means source/test evidence may exist but authenticated certification has not occurred.

| Step | Route / surface | API boundary | Domain and persistence boundary | Runtime dependencies | Auth / browser / provider | Current status | Owner | Required evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Landing | `/` | Public page data | None required | App build, assets | Public / browser / no | Runtime blocked | Release QA | Desktop/mobile render, console, network, links |
| Sign Up | `/signup` | Auth provider callbacks | User/account/session | Auth service, mail if required | Public-to-auth / browser / no | Runtime blocked | Identity QA | Created non-prod account, callback and session proof |
| Login | `/login` | Auth callbacks/session | Session store | Auth service | Public-to-auth / browser / no | Runtime blocked | Identity QA | Successful and rejected login, secure session proof |
| Dashboard | `/dashboard` | League/user APIs | User leagues | DB, session | Member / browser / no | Runtime blocked | Product QA | Correct leagues, empty state, refresh persistence |
| Create league | `/create-league` | League creation APIs | Canonical creation transaction | DB | Commissioner / browser / no | Test verified | League QA | Request, league row/ID, settings, refresh |
| Import league | Create/import flow | `/api/leagues/import/preview`, `/api/leagues/import/commit` | Import normalization and commit | DB, source provider | Commissioner / browser / provider for import | Test verified | Import QA | Preview, ownership proof, warnings, commit and dedupe |
| Configure league | `/league/{id}` settings | `/api/commissioner/leagues/{id}/…` | Settings services and league rows | DB | Commissioner / browser / no | Test verified | Commissioner QA | Before/after values, denial proof, refresh |
| Invite members | Commissioner workspace | `/api/commissioner/leagues/{id}/invite` and `/invite/send` | Invite token/member state | DB, mail/delivery | Commissioner / browser / delivery | Runtime blocked | Membership QA | Token, delivery, expiry, duplicate and revoke behavior |
| Join league | Invite destination | Join/membership boundary | LeagueMember/team assignment | DB, auth | Invited member / browser / no | Runtime blocked | Membership QA | Correct identity/league/team, cross-league denial |
| Draft preparation | League Draft tab | Commissioner draft APIs | Draft configuration/session | DB | Commissioner / browser / player data | Test verified | Draft QA | Order, timer, pool, permissions, unsupported-mode rejection |
| Draft room | Draft room route | Draft pool/session/pick/chat APIs | Pick submission transaction, realtime state | DB, realtime, provider cache | Three members / browser / cached provider | Test verified | Multiplayer QA | See multiplayer script |
| Draft completion | Draft room and league | Completion/lifecycle APIs | Draft completion and roster materialization | DB, realtime | Commissioner/managers / browser / no | Runtime blocked | Lifecycle QA | Final pick, roster rows, state transition, refresh |
| My Team | League Team tab | Roster API | Roster ownership and slots | DB | Member / browser / projections optional | Test verified | Roster QA | Correct ownership, states, cross-team denial |
| Lineup | Team tab | Lineup/roster APIs | Lineup validation and locked slots | DB, game locks | Member / browser / score/injury cache | Test verified | Roster QA | Save/reload, invalid/locked denial, failure reconciliation |
| Waivers | League Waivers tab | Waiver claim/process APIs | Claim, priority/FAAB, roster transaction | DB, scheduler | Member/commissioner / browser / enrichment optional | Test verified | Transaction QA | Claim lifecycle, dedupe, processing and balances |
| Trades | League Trades tab | Redraft trade APIs | Existing Trade OS/native transaction state | DB, notices | Members/commissioner / browser / valuation optional | Test verified | Transaction QA | Propose/accept/reject/review/history and authorization |
| Matchups | Matchup center | Scoring/matchup APIs | Matchup and weekly score state | DB, score ingestion | Member / browser / scores | Runtime blocked | Scoring QA | Lineups, projections vs actual, refresh, missing/stale state |
| Schedule | League Schedule tab | Redraft schedule APIs | Canonical league schedule | DB | Member / browser / no | Test verified | Schedule QA | Week navigation, byes, playoff transition, mobile |
| Standings | League Standings tab | Standings/playoff APIs | Authoritative standings engine | DB, completed scoring | Member / browser / scores | Test verified | Standings QA | Rank/tiebreak, corrections, playoff states, mobile |
| Commissioner workspace | League commissioner view | `/api/commissioner/leagues/{id}/operations` and action APIs | Permissioned league operations/audit | DB | Commissioner / browser / no | Test verified | Commissioner QA | Action reachability, member denial, confirmations, audit |
| Season completion | League lifecycle/playoffs | Playoff/finalize/lifecycle APIs | Champion, final standings, season state | DB, final scores | Commissioner / browser / scores | Runtime blocked | Release owner | Final matchup, champion/history, locked state, renewal handoff |

The exact route may resolve through the canonical league shell/tab rather than a distinct URL. During execution, record the resolved URL and API calls instead of assuming this table is exhaustive.

## Release gates

| Gate | Entry criteria | Exit criteria | Blocking defects | Evidence required | Current state |
| --- | --- | --- | --- | --- | --- |
| 1 — Source complete | Feature scope frozen | No known P0/P1 source gap; unsupported paths hidden/labeled | Security, data-loss, unreachable core path | G58 report, matrix, reviewed diff | Pass at source level |
| 2 — Type safety | Gate 1; clean dependencies | Full configured typecheck succeeds | Any redraft/auth/shared compile failure; timeout | Command, SHA, diagnostics, exit code | Open: full check timed out |
| 3 — Auth create/import | Trusted browser, commissioner, safe DB | NFL create and Sleeper import; NCAAF supported create/import; invite/join persist | Any P0/P1; wrong ownership/tenant | Browser, API, DB before/after, refresh | Blocked externally |
| 4 — Multiplayer draft | Gate 3; three sessions; disposable drafts | NFL/NCAAF supported drafts synchronize, persist and recover | Lost/duplicate pick, wrong sport, auth bypass, unrecoverable desync | Full multiplayer evidence script | Blocked externally |
| 5 — Provider certification | Authorized credentials and safe runtime | Scores, injuries, valuations meet freshness/cache/fallback/error contract | Fabricated/stale-as-live data, raw provider leakage, load-bearing outage | Provider matrix packet | Blocked externally |
| 6 — Mobile runtime | Gates 3–5; real responsive browser | Core journey works at 390×844 and desktop | Unusable core action, overflow hiding controls, hydration/global error | Screenshots/video, console/network | Blocked externally |
| 7 — Invited MVP approval | Gates 1–6 complete; no open P0/P1 | Owner explicitly approves defined build/environment | Open P0/P1, missing evidence, mismatched SHA | Signed gate summary, defect disposition, deployment/smoke evidence | Not ready |

No gate may be waived by a percentage. Conditional approval is not approval. A rerun invalidates only the evidence it supersedes; retain the earlier failed artifact.

## Defect severity and launch policy

| Severity | Definition and examples | Policy |
| --- | --- | --- |
| P0 | Data corruption/loss, duplicate ownership, lost/duplicate draft pick, cross-tenant access, unsafe production mutation | Stop immediately; rollback/isolate; no release; preserve evidence |
| P1 | Core journey cannot complete: login/create/import/join/draft/lineup/waiver fails; material incorrect scoring/standings; commissioner auth bypass | Release blocked until fixed and the affected gate plus regressions pass |
| P2 | Workaround exists; incorrect customer messaging, non-core notification issue, significant responsive/visual regression | Triage before approval; owner must explicitly accept any deferral with issue and target |
| P3 | Cosmetic polish with no misleading state, accessibility loss, or blocked action | May defer with recorded issue; does not independently block invited MVP |

Security, privacy, data-integrity, or truthfulness impact raises severity regardless of visual size. Timeouts are failures, not passes.

## Evidence templates

### Browser evidence

`ID | timestamp/timezone | environment URL | build SHA | browser/device/viewport | role | sport | league/draft ID | route | steps | expected | observed | screenshot/video path | console errors | failed requests | classification`

### API evidence

`ID | timestamp | environment | build SHA | sanitized method/path | role | correlation/request ID | sanitized request shape | status | sanitized response/hash | latency | expected | observed`

### Database evidence

`ID | timestamp | certified non-prod identity | schema | transaction/correlation ID | entity IDs | read-only before query/result hash | action | read-only after query/result hash | invariant | observed`

Never store connection strings, passwords, session tokens, personal data, or broad table dumps.

### Realtime evidence

`ID | timestamp | client roles | draft/league ID | connection IDs (sanitized) | action | expected ordering | observed ordering | reconnect window | duplicate/missing messages | persisted result`

### Provider evidence

Use the packet in `PROVIDER_CERTIFICATION_MATRIX.md`: provider/capability, timestamps, selected/attempted providers, normalized payload hash, cache/fallback/freshness, health, timeout/retry/rate-limit, customer render, console/network.

### Regression evidence

`ID | build SHA | command | config/test files | start/end | files passed/total | tests passed/total | failures | skips | retries | timeouts | exit code | log artifact`

## Automated source runner

Run from repository root:

```text
npm run certify:invited-mvp:source
```

It invokes the frozen G58 configuration with `--pool=threads --maxWorkers=1`. It is source/test evidence only. Any failure, skip, retry or timeout prevents the source-runner result from passing.

## G59 files and validation

Created or updated:

- `docs/redraft/G59_END_TO_END_LAUNCH_CERTIFICATION_FRAMEWORK.md`
- `docs/redraft/INVITED_MVP_CERTIFICATION_CHECKLIST.md`
- `docs/redraft/PROVIDER_CERTIFICATION_MATRIX.md`
- `docs/redraft/MULTIPLAYER_DRAFT_CERTIFICATION_SCRIPT.md`
- `__tests__/redraft/g59-certification-framework.test.ts`
- `vitest.invited-mvp.config.ts`
- `package.json`

Validation history:

- `npm run certify:invited-mvp:source` final run: 17/17 files and 132/132 tests passed; 0 failures, skips, retries or timeouts; duration 200.72 seconds.
- Framework-only run: 1/1 file and 5/5 tests passed; 0 failures, skips, retries or timeouts; duration 6.28 seconds.
- Targeted ESLint for the G59 test and curated config: exit 0, no errors or warnings.
- Targeted `git diff --check`: exit 0, no whitespace errors; line-ending conversion warning only.
- First normal-timeout source-runner attempt: 16 files and 131 tests passed, 1 framework assertion failed because the guard expected lowercase `no` while the document correctly used sentence-case `No`. The assertion was corrected without weakening the requirement. This failed attempt is not counted as a pass.
- An earlier five-second shell probe was terminated before Vitest started and is recorded as a command timeout, not a test result or pass.

Browser, authentication, database, realtime multiplayer, mobile runtime and live-provider checks performed during G59: **0**.

## G59 decision

The framework is complete at source level. Runtime certification is still blocked by the absence of a trusted authenticated browser, a positively identified safe DB-backed environment, three authenticated draft clients, authorized live-provider access, and mobile runtime evidence.

Readiness is unchanged: NFL **95%**, NCAAF **80%**, Controlled Beta **70%**.

```text
G59 END-TO-END LAUNCH CERTIFICATION FRAMEWORK: PASS
AUTHENTICATED CERTIFICATION PERFORMED: NO
LIVE PROVIDER CERTIFICATION PERFORMED: NO
READY TO BEGIN AUTHENTICATED CERTIFICATION WHEN PREREQUISITES ARE RESTORED: YES
```
