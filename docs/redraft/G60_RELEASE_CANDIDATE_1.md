# G60 — NFL Invited MVP Release Candidate 1 Package

## Executive summary

G60 freezes the NFL invited-MVP product scope and packages its source inventory, release notes, risks and certification checklist. Four customer-copy inconsistencies were corrected without changing canonical domain logic. The G59 certification framework remains the execution authority.

RC1 is **source-package ready but not yet a reproducible release commit**. At inspection, the repository was on `feat/fantasy-os-intelligence-coach-certified-wiring` at `3a61caf6ef7f37967d46bf7378bf3389224b342a` with a very large mixed uncommitted worktree, generated build directories, temporary/local files and multiple phases' changes. No commit, tag, branch change, merge, deployment, database action or runtime certification was performed in G60.

## Release inventory

`Owning route` names the canonical customer surface/API family, not every supporting endpoint. `Coverage` identifies the deterministic suite contract; exact runtime proof remains pending wherever status says so.

| Feature | Status | Canonical implementation | Owning route/API | Owning service/boundary | Regression coverage | Release truth |
| --- | --- | --- | --- | --- | --- | --- |
| Authentication | Runtime certification required | NextAuth session/league membership guards | `/login`, auth callbacks, protected league routes | `lib/auth.ts` and server authorization boundaries | Draft access/auth and route-scope tests in invited-MVP suite | Real login/session roles unverified |
| League creation | Runtime certification required | Canonical league creation flow | `/create-league`, league creation APIs | Redraft/canonical creation transaction | League defaults and import/creation contracts | DB-backed create/refresh pending |
| League import | Runtime certification required | Unified preview/commit adapters | `/api/leagues/import/preview`, `/commit` | ImportedLeague normalization/commit services | Preview validation, commit, warnings/dedupe tests | Sleeper and enabled adapters require real-provider/account proof |
| Invite flow | Runtime certification required | Commissioner invite/member flow | `/api/commissioner/leagues/{id}/invite*` | League membership/invite persistence | Authorization covered indirectly; runtime checklist authoritative | Delivery, expiry, join and team assignment pending |
| Draft setup | Runtime certification required | Canonical draft settings/session | League Draft tab and draft settings APIs | Draft session/config registry | Draft authorization and sport isolation suite | Snake/linear only for RC1; real setup pending |
| Mock draft | Included with limitation | Canonical mock runtime/customer room | `/mock-draft`, `/api/mock-draft/create` | `MockDraftRuntimeService` | Sport-pool isolation tests | Snake/linear practice; not live-persistence evidence |
| Live draft | Runtime certification required | Authoritative draft room/pick transaction | League draft room and pick/session/control APIs | `DraftSessionService`, `PickSubmissionService` | Auth, transaction, idempotency, conflict, pool tests | Three-client runtime pending |
| Draft Assist | Included with limitation | Existing recommendation/intelligence panels | Draft room | Recommendation engine/canonical data inputs | Draft-room and provider isolation contracts | Accuracy/freshness not live certified |
| My Team | Runtime certification required | Canonical Team tab/roster manager | League Team tab, roster APIs | Roster ownership/slot services | Lineup validation/lock tests | Authenticated ownership/render pending |
| Lineups | Runtime certification required | Existing lineup engine and reconciled UI | Team tab, lineup/roster APIs | Lineup validation, locks, roster persistence | Lineup validation/lock and G58 guardrails | Real save/lock/IR/mobile pending |
| Players | Runtime certification required | Canonical player-market surface | League Players tab/player APIs | Sport pool and normalized provider data | Sport adapter/provider guardrails | Live completeness/freshness pending |
| Waivers | Runtime certification required | Existing waiver wire and claim engine | League Waivers tab, claim/process APIs | Waiver claims/process transaction | Route scope and source guardrails | Real priority/FAAB processing pending |
| Trades | Runtime certification required | Existing native/Trade OS customer flow | League Trades tab, redraft trade APIs | Trade service/settings/validation | Native builder and authorization contracts | Supported flow pending; reversal excluded |
| Matchups | Runtime certification required | Matchup center/canonical score runtime | League matchup routes and scoring APIs | Matchup center/scoring services | Provider/score source tests outside core runner plus UI contracts | Live score/persistence pending |
| Schedule | Included at source level | Canonical schedule tab/runtime | League Schedule tab, redraft schedule APIs | Schedule runtime/engine | Canonical navigation and invited-MVP contracts | Real lifecycle contents pending |
| Standings | Included at source level | Authoritative standings/playoff view | League Standings tab and playoff APIs | Standings/playoff services | Standings/playoff wiring tests | Full-season/corrections pending |
| Chat | Runtime certification required | Existing league/draft chat | League/draft chat APIs | Chat persistence and membership boundary | Chat composer/mentions UI contract | Multi-user ordering/denial pending |
| Commissioner Workspace | Runtime certification required | G47 operations workspace | Commissioner league view/operations APIs | Commissioner authorization and operations service | Workspace source test | Real role denial/actions/audit pending |
| Settings | Runtime certification required | Existing DB-first league settings panels | League settings and commissioner APIs | Settings/scoring/roster/draft services | DB-first settings test | Persistence/frozen-state mobile pending |
| Notifications | Runtime certification required | Existing notification creation/delivery paths | Draft/transaction/invite notification APIs | Notification persistence/delivery providers | Some domain tests; not a complete RC runtime proof | Exactly-once delivery pending |
| Mobile web | Runtime certification required | Responsive league/draft surfaces | Same canonical routes at 390×844 | Browser/layout runtime | Source responsive contracts only | Physical mobile browser pending |

Auction is deferred. Trade reversal, Renewal Gate C, unsupported NCAAF imports and specialty league expansions are not RC1 features.

## Dead-feature and reachability audit

### Corrected

- Mock Draft metadata and hero no longer promise “AI-powered” or a “Sleeper-style AI” room; they use Draft Assist and AllFantasy ownership.
- Draft auto-pick customer copy now says `Smart Queue`; the persisted internal `ai_queue` identifier remains unchanged for compatibility.
- Quick Create now says `Guided Quick Create` and explains Coach-prepared settings for review.
- Create/import mode selectors no longer hard-code a list of providers before the canonical supported-provider step.

### Retained with reason

- Provider-specific names remain where the user intentionally chooses/imports that external service; this is necessary attribution, not a provider implementation leak.
- HTML input placeholders (league ID/search examples) remain genuine input guidance, not unfinished placeholder controls.
- Auction components/routes remain in the broader repository for other product scopes, but auction is deferred by the RC matrix and must be unreachable from invited-MVP creation/settings. Runtime negative-path certification remains required.
- Disabled controls that communicate a real entitlement or lifecycle lock may remain if the explanation is customer-safe. A trusted browser click audit is required to prove reachability.
- Internal comments, test IDs, enum values and file/class names may contain legacy/provider/`ai` tokens; the release rule applies to customer-rendered copy and architectural boundaries.

### Unresolved audit limits

The dirty worktree makes it impossible to prove a stable repository-wide dead-code result, and source search cannot establish runtime reachability. Full authenticated navigation/click inspection remains open.

## Customer-copy findings

The audited core creation, mock-draft, draft-room, players, waivers, standings and commissioner surfaces use AllFantasy-owned terminology and safe action/error states. The G58 guardrail already protects hardened waiver/player copy; G60 adds targeted checks for the corrected creation/mock/draft strings.

No new provider-specific business logic was introduced. No lorem ipsum was found in the audited invited-MVP surface set. Debug/log searches are not treated as customer leakage unless rendered. A browser pass must still inspect resolved translations, server errors, empty/loading states and all role-specific branches.

## Release guardrails and freeze decision

- The G58 NFL/NCAAF feature matrix remains authoritative.
- G59 evidence levels and gates remain authoritative.
- Supported provider/sport truth remains in `provider-ui-config.ts` and backend adapters; UI lists must derive from that boundary.
- Snake/linear are the invited-MVP draft modes. Auction cannot be promoted by source presence.
- Source-present features marked `Requires certification` cannot be advertised as physically proven.
- Any post-freeze change needs focused tests, risk update and rerun on the exact candidate SHA.

## Release package

- `G60_RELEASE_CANDIDATE_1.md` — inventory, audit and release truth.
- `NFL_INVITED_MVP_RELEASE_NOTES.md` — internal G46–G60 notes and limitations.
- `NFL_INVITED_MVP_RISK_REGISTER.md` — ranked source/runtime/provider/UX/operational risks.
- `NFL_INVITED_MVP_RC_CHECKLIST.md` — owners, evidence and exit actions.
- G58 feature matrix and G59 certification documents remain linked authorities.

## Validation

- `npm run certify:invited-mvp:source` final run: **18/18 files and 136/136 tests passed**; 0 failures, skips, retries or timeouts; Vitest duration 232.98 seconds (command wall time 274.4 seconds).
- Newly added/copy-focused run: `npx vitest run __tests__/redraft/g60-rc1-freeze.test.ts __tests__/draft/autopick-me-toggle.test.tsx --pool=threads --maxWorkers=1`: **2/2 files and 27/27 tests passed**; 0 failures, skips, retries or timeouts; duration 25.91 seconds.
- Targeted ESLint across five modified customer components, the G60 guardrail and curated config: exit 0; 0 errors and 0 warnings.
- Targeted `git diff --check`: exit 0; no whitespace errors; Git emitted informational LF-to-CRLF conversion warnings.
- First full runner attempt: exceeded the 300-second command window without returning a Vitest result. It is recorded as one command timeout and is not counted as passing. The unchanged suite was rerun with a larger window and produced the green final result above.

Browser, authenticated, database, provider, realtime multiplayer, deployment and mobile-runtime checks performed in G60: **0**.

## Remaining blockers

### Source/release packaging

1. Isolate the intended RC diff from the mixed worktree and remove generated/temp/local artifacts from candidate scope.
2. Produce a clean reproducible commit and review the complete exact-SHA diff.
3. Complete the full configured TypeScript check on that SHA.
4. Rerun source certification, lint and diff hygiene on the frozen SHA.

### Runtime

- Trusted authenticated browser and positively identified safe non-production DB.
- Authenticated create/import/invite/join/full-season lifecycle.
- Three-client NFL multiplayer draft.
- Live provider freshness/cache/fallback/failure evidence.
- Desktop and 390×844 mobile runtime inspection.
- Explicit owner approval for the exact SHA after P0/P1 closure.

## Decision and readiness

Published readiness is unchanged: NFL **95%**, NCAAF **80%**, August 10 Controlled Beta **70%**.

```text
G60 RC1 FREEZE AND LAUNCH PACKAGE: PARTIAL
INVITED MVP SCOPE FROZEN: YES
ADVERTISED CAPABILITIES SOURCE-MAPPED: YES
CUSTOMER COPY SOURCE AUDIT: PASS FOR AUDITED SURFACES
DEAD FEATURE AUDIT: PARTIAL
DETERMINISTIC RC COMMIT CREATED: NO
AUTHENTICATED RUNTIME CERTIFIED: NO
LIVE PROVIDER CERTIFIED: NO
RC1 READY TO ENTER AUTHENTICATED CERTIFICATION: NO — FIRST ISOLATE AND FREEZE A REPRODUCIBLE SHA
RECOMMENDED FOR LAUNCH: NO
```
