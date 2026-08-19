# AllFantasy — Authoritative Launch Program Plan

**Status:** ACTIVE · **Owner:** Guap (founder) · **Last updated:** 2026-07-24
**Branch of record:** `feat/launch-phase0-truth-attribution` · **Draft PR:** #339
**Base:** `origin/main` @ `e61a63886` (also the current production SHA)

> **This is the single authoritative execution plan for the AllFantasy unified-platform
> launch.** It supersedes ad-hoc phase tracking that previously lived only in chat.
>
> It does **not** compete with existing documents; it sits above them:
> - `AF_B2C_USER_READINESS_PLAN.md` — go-to-market *positioning and wedge*. Strategy, not gating.
> - `docs/DECISION_OS_TRUTH_AUDIT.md`, `docs/admin/PRODUCTION_TRUTH_AUDIT.md`, `docs/import/IMPORT_CERTIFICATION_PHASE1.md` — evidence inputs.
> - Per-feature build briefs under `docs/` — implementation detail for work this plan sequences.
>
> Where any of those conflict with this document on **sequencing or gate status**, this document wins.

---

## 0. The non-negotiable workflow rule

AllFantasy now follows **gated, sequential implementation**. For every phase:

1. Complete one bounded phase.
2. Verify with automated tests.
3. Verify in the browser.
4. Verify desktop **and** mobile.
5. Verify authenticated and role-specific behavior where applicable.
6. Verify persisted data and API behavior.
7. Verify production/deployment behavior where applicable.
8. Record evidence, known limitations, and unresolved failures.
9. Obtain an **explicit PASS** from the founder.
10. **Only then** begin the next phase.

**Prohibited:** skipping ahead because later work looks related; combining unfinished phases;
building dependents on an unverified foundation; redesigning completed systems without
verification proving a correction is required.

**Status vocabulary:** `PASS` · `FAIL` · `BLOCKED` · `IN PROGRESS` · `NOT STARTED` · `DEFERRED` ·
`PARTIALLY VERIFIED` (code-complete and test-verified, but a required verification tier is missing).

**Verification tiers** are tracked separately and never conflated:
`code-complete` → `test-verified` → `browser-verified` → `visually-verified` → `deployment-verified`.

---

## 1. Standing product invariants

These bind **every** phase. A phase that violates one cannot PASS.

| # | Invariant |
|---|---|
| I1 | **Imported external leagues are read-only upstream.** Sleeper, ESPN, Yahoo, MFL, Fantrax, Fleaflicker. AllFantasy may analyze, recommend, alert, and deep-link back — never imply it changed an external league. Native write actions only for AF-created leagues where the user holds permission. |
| I2 | **Never render unavailable as zero.** `confirmed` / `no_activity` / `not_configured` / `collection_disabled` / `provider_unavailable` / `delayed` / `stale` / `partial` / `query_failed` / `insufficient_evidence` stay distinguishable in payload *and* UI. |
| I3 | **No fabricated facts.** No synthetic, demo, or placeholder data on production surfaces. Missing evidence produces an honest limited/unavailable result, never generic filler advice. |
| I4 | **First-party DB is authoritative** for the authenticated funnel (`AppUser`, `AnalyticsEvent`, Stripe webhooks). GA4/Meta Pixel are labeled comparison estimates and are **never summed** with confirmed events. |
| I5 | **Identity is server-derived.** No caller-supplied `userId` is ever trusted. No cross-user data leakage. Attribution is analytics, never an authorization input. |
| I6 | **Commissioner dual-role.** A commissioner keeps their personal manager experience; oversight is additive. Ordinary managers never see commissioner-only facts. |
| I7 | **Manager ≠ franchise.** Manager history follows the person across leagues/platforms; franchise history follows the team slot. They are never silently merged. |
| I8 | **Entitlements enforced consistently** across free / subscription / token, on every surface. No charge on failure. |
| I9 | **Freshness is always visible** where a number could be stale — with source and "as of". NFL/NCAAF game-day surfaces carry an explicit freshness target. |
| I10 | **Production DB is never modified by verification.** Local/browser certification runs against `.env.test` (`ep-muddy-leaf`) only. |
| I11 | **Route budget respected.** Measured by parsing `scripts/vercel-next-build.cjs` (routes ×1, App Router pages ×2, +22 overhead). The legacy counter under-reports by ~276 and is not authoritative. |
| I12 | **No schema migration applied to production** without an explicit, separately approved migration gate. |

---

## 2. Completed and verified work (do not rebuild)

Seven commits on `feat/launch-phase0-truth-attribution`, all pushed and independently green.

| SHA | What | Tiers reached |
|---|---|---|
| `395e4a347` | Deployment identity + governed attribution capture; **fixed client-controlled `userId` in `/api/analytics/track`** | deployment-verified |
| `b053979dc` | Anonymous journey → account link at NextAuth `signIn` | deployment-verified |
| `3af0e6b3c` | `signup_completed` at both email and OAuth-create paths | deployment-verified |
| `0733232c7` | **Fixed double-encoded attribution cookie**; 9 browser tests | deployment-verified |
| `3324c47a5` | Campaign attribution reporting service + admin endpoint | deployment-verified |
| `86ee60e83` | Admin Social & Campaigns panel | deployment-verified (**not** visually verified) |
| `d00642247` | `landing_viewed` + `dashboard_activated` instrumentation | deployment-verified (**not** visually verified) |

**Current totals:** 121 unit tests (10 files) + 11 browser tests passing.
**Route budget:** 2009 / 2048 — **headroom 39**.
**Schema:** no migration introduced. `AnalyticsEvent` is the first-party event store.
**Preservation commit:** `1864204ec` (40 uncommitted paths preserved before branching).

### Two bugs found that a passing test had hidden — recorded so they are not re-introduced

1. **Client-chosen `userId`** — `/api/analytics/track` read `body.userId || session.user.id`, letting any
   anonymous caller attribute events to any user. Every admin funnel metric derives from that table.
2. **Double-encoded cookie** — readers parsing the raw `Cookie` header got no campaign fields, so
   `/api/analytics/track` recorded every event as effectively direct traffic. Both unit fixtures were
   built with the encoder, so they were self-consistent with the bug. **Lesson: build cookie fixtures
   from a real `Set-Cookie` header, never from the encoder.**

---

## 3. Pre-existing issues — NOT regressions from this work

Recorded separately, per instruction. None was introduced by the seven commits.

| ID | Issue | Evidence it is pre-existing |
|---|---|---|
| P1 | `__tests__/route-budget.test.ts` → `/api/ai/providers is not fetched from production source` fails | Callers are `AIProviderSelector.tsx` + `ChimmyProviderStatus.tsx`, untouched by this branch; fails on `origin/main`. Spawned as its own task. |
| P2 | `Vercel – allfantasy-v2` check red | Stale **duplicate project** (the `vercelrepo` mirror remote); its own status link points to "why is my account blocked". Authoritative `allfantasy-v2-main` is green. |
| P3 | `tsc` errors in `world-cup` files, `DuplicateManagerRiskService`, `ReferralService` | Byte-identical to `origin/main`; pulled in only transitively. |
| P4 | `/api/ai/tools` route-budget assertion times out at 30s | Filesystem-scan slowness on this machine, not an assertion failure. |
| P5 | Main Playwright suite red tree-wide | Long-standing; see memory `main-playwright-suite-red`. |

---

## 4. Ordered phase / gate table

Sections A–J. **A phase may not start until its predecessor is PASS.**

| # | Phase | Section | Status | Gate to start |
|---|---|---|---|---|
| **A1** | Production & deployment truth | A | ✅ **PASS** | — (complete) |
| **A2** | Governed attribution + funnel instrumentation | A | ✅ **PASS** (code/test/browser/deployment) | — (complete) |
| **A3** | **Authenticated attribution & activation verification** | A | 🔴 **BLOCKED — ACTIVE GATE** | Needs a genuine admin session |
| A4 | Authentication certification (all providers) | A | ⬜ NOT STARTED | A3 PASS |
| A5 | Remaining funnel emitters (`start_clicked`, `signup_started`, `email_verified`, onboarding, import) | A | ⬜ NOT STARTED | A3 PASS |
| A6 | Stripe entitlements + webhook-confirmed conversion | A | ⬜ NOT STARTED | A4, A5 PASS |
| A7 | Support, observability, release certification | A | ⬜ NOT STARTED | A6 PASS |
| **B1** | Import certification completion (6 providers, capability matrix) | B | 🟡 PARTIAL (#336 Phase A shipped) | A3 PASS |
| B2 | Five-minute-target durable sync engine | B | ⬜ NOT STARTED | B1 PASS |
| B3 | Normalized league context (single authoritative resolver) | B | ⬜ NOT STARTED | B1, B2 PASS |
| B4 | Dashboard + Decision OS on normalized context | B | 🟡 PARTIAL (Decision OS Truth Phase 1 merged) | B3 PASS |
| B5 | Player Search as a first-class product | B | ⬜ NOT STARTED | B3 PASS |
| B6 | Injury/news ingestion + notifications | B | ⬜ NOT STARTED | B3 PASS |
| B7 | NFL/NCAAF data, headshots, logos via governed resolvers | B | ⬜ NOT STARTED | B3 PASS |
| B8 | NFL redraft controlled beta readiness | B | ⬜ NOT STARTED | B4–B7 PASS |
| **C1** | Event bus + recalculation ledger | C | ⬜ NOT STARTED | B2, B3 PASS |
| C2 | Continuous Intelligence / Real-Time Evolution Engine | C | ⬜ NOT STARTED | C1 PASS |
| C3 | Game-day freshness SLOs (NFL/NCAAF) | C | ⬜ NOT STARTED | C2, B7 PASS |
| **D1** | Specialty League Rules Engine — rule model | D | ⬜ NOT STARTED | B3 PASS |
| D2 | Specialty rules → scoring/lineup/eligibility enforcement | D | ⬜ NOT STARTED | D1 PASS |
| **E1** | Manager Intelligence Foundation — behavioral event model | E | ⬜ NOT STARTED | C1, F1 PASS |
| E2 | Behavioral change detection + confidence model | E | ⬜ NOT STARTED | E1 PASS |
| **F1** | AF Legacy identity foundation (manager vs franchise, ownership history, identity correction, privacy) | F | 🔒 **DEFERRED** | A3–A7, B1–B4 PASS |
| F2 | AF Legacy historical data foundation (cross-platform history) | F | 🔒 DEFERRED | **F1 PASS — ordering locked, see §8** |
| F3 | AF Legacy grading engine (explainable, evolving) | F | 🔒 DEFERRED | F2, C2 PASS |
| **G1** | AF Legacy user experience (timelines, Legacy Stories) | G | 🔒 DEFERRED | F3 PASS |
| G2 | AF Legacy dashboard + league-workspace signals | G | 🔒 DEFERRED | G1, B4 PASS |
| **H1** | AF Legacy → Decision OS integration | H | 🔒 DEFERRED | G2, B4 PASS |
| H2 | AF Legacy → Chimmy context integration | H | 🔒 DEFERRED | H1 PASS |
| **I1** | Trade Evaluator + Trade Partner Finder + Proposal Engine | I | 🔒 DEFERRED | H1, D2 PASS |
| I2 | Waiver Intelligence + bid intelligence | I | 🔒 DEFERRED | H1, D2 PASS |
| I3 | Player / Team / Manager Stock | I | 🔒 DEFERRED | F3, C2 PASS |
| I4 | League + career rankings, comparisons, rivalries | I | 🔒 DEFERRED | F3 PASS |
| I5 | Social share cards + Discord connection | I | 🔒 DEFERRED | I4, F1 PASS |
| **J1** | Controlled pilot | J | 🔒 DEFERRED | A7, B8 PASS |
| J2 | Monitoring, recalibration, expansion | J | 🔒 DEFERRED | J1 PASS |

---

## 5. The single active gate

### 🔴 A3 — Authenticated attribution & activation verification · **BLOCKED**

**Purpose.** Prove with live, authenticated evidence that the instrumented journey works end to
end and that the admin surface reporting it is truthful — before anything is built on top of it.

**Prerequisites.** A1 PASS, A2 PASS. ✅ Both met.

**In scope.**
- A genuine, authorized admin session (founder-provided or founder-operated).
- Authenticated `/admin` **desktop** QA of the Social & Campaigns panel.
- Authenticated `/admin` **mobile** QA of the same panel.
- Live tracked-campaign-link walk: TikTok, Instagram, X, and direct.
- Signup attribution persistence across email **and** OAuth.
- `dashboard_activated` verified by an authenticated live click-through.
- Admin reporting reflecting that journey with correct first-touch grouping.
- Honest zero-league behavior confirmed on screen.

**Explicitly out of scope.** Any new emitter; AF Legacy work of any kind; Stripe; import
certification; any schema change; fixing P1–P5.

**Dependencies.** An admin session. Nothing else blocks.

**Risks.**
- *Fabricated auth.* Mitigation: **prohibited**. If unavailable, the gate stays BLOCKED.
- *Verifying against production.* Mitigation: `.env.test` only (I10); production reporting may be
  **read** but never written to by verification.
- *Preview SSO.* Preview URLs are reachable in real Chrome with an authenticated Vercel session;
  plain HTTP gets a 302 to `vercel.com/sso-api`.

**Automated verification.** Already green: 121 unit + 11 browser. Re-run before sign-off.
**Browser verification.** Live tracked-link → landing → signup → activation walk.
**Desktop/mobile verification.** `/admin` panel at desktop and mobile widths; ~30% lower mobile
density; tables scroll inside their own container; keyboard navigation and contrast.
**Auth/role verification.** Admin sees the panel; a non-admin authenticated user receives 401/403
from the data endpoint and sees no admin navigation.
**Data persistence verification.** `AnalyticsEvent` rows for `landing_viewed`, `signup_completed`,
`auth.attribution_linked`, `dashboard_activated` with correct `userId`, `sessionId`, campaign meta.
**Production verification.** Deployed SHA confirmed; deployment error fields inspected; no
`too_many_routes`. Already true for `d00642247` (`dpl_BYG6QV9nDnqrmbda8zB3aA4kWgMp`).

**Acceptance criteria.**
1. Admin panel renders correctly, authenticated, on desktop and mobile.
2. `not_implemented` and `query_failed` visibly differ from a real `0`.
3. A tracked link produces a `landing_viewed` row with first-touch campaign context.
4. Signup links the anonymous journey to the account (email and OAuth).
5. A qualifying dashboard load produces exactly one `dashboard_activated` row.
6. The campaign row shows that journey end to end, grouped first-touch.
7. A zero-league account does **not** activate, and the UI does not imply an import succeeded.
8. No fabricated session, no simulated proof presented as live verification.

**Required evidence.** Screenshots (desktop + mobile), the DB rows, the admin API response,
deployment id + SHA, and an explicit statement of anything that could not be verified.

**Blocking conditions.** No authorized admin session → **BLOCKED**. Any acceptance criterion
failing → **FAIL** with the specific criterion named.

**Rollback / recovery.** No rollback needed — instrumentation is additive, adds zero routes, and
introduced no migration. If A3 FAILs, correct within A2's existing modules; do not start A4+.

**Status:** 🔴 **BLOCKED** — awaiting a genuine authorized admin session.

**Condition to begin A4:** A3 marked **PASS** by the founder with the evidence above attached to PR #339.

---

## 6. Phase detail — remaining Section A

### A4 — Authentication certification
**Purpose.** Certify every visible auth path and ensure the visible provider list matches what is
actually configured and deployment-verified.
**In scope.** Email/password, Google, Discord, Spotify; logout; returning login; OAuth cancellation;
callback failure; duplicate identity / account linking; password reset; verification; onboarding
persistence; mobile auth; redirect back into the intended import flow; UTM/campaign continuity
across all of the above; real recovery contact for Sleeper-created accounts.
**Out of scope.** New providers; auth UI redesign beyond honest option gating.
**Risks.** A failed signup appearing successful; provider options shown but not configured.
**Acceptance.** Every visible option is configured and deployment-verified; a failed signup never
appears successful; attribution survives every path.
**Status:** ⬜ NOT STARTED · **Starts when:** A3 PASS.

### A5 — Remaining funnel emitters
**Purpose.** Close the middle of the funnel so a campaign can be credited stage by stage.
**In scope.** `start_clicked`, `signup_started`, `email_verified`, `onboarding_started`,
`onboarding_completed`, `import_started`, `import_completed`, `returning_authenticated`.
**Out of scope.** `checkout_started` and `paid_conversion_confirmed` (A6 — webhook-confirmed only).
**Risks.** Inflation from retries/rerenders; "returning" firing on every request.
**Acceptance.** Each emitter is server-authoritative or server-validated, idempotent where
required, and the admin panel drops the corresponding `not_implemented` chip.
**Status:** ⬜ NOT STARTED · **Starts when:** A3 PASS.

### A6 — Stripe entitlements & conversion
**In scope.** Checkout, tiers, portal, tokens, webhook signature verification, idempotency, replay,
entitlement precedence, upgrade/downgrade, cancellation, failed payment, refund, token consumption,
no-charge-on-failure, test/live separation, auditability, `paid_conversion_confirmed` from
**webhooks only**.
**Risks.** Redirect mistaken for payment; live checkout still charging old prices (known drift).
**Acceptance.** Webhook-confirmed state is authoritative everywhere; no redirect-inferred success.
**Status:** ⬜ NOT STARTED · **Starts when:** A4 + A5 PASS.

### A7 — Support, observability, release certification
**In scope.** Persistent tickets with category/severity/context/attachments/status/owner; admin
queue; support link on major surfaces; privacy-safe diagnostics; monitoring for signup/OAuth/import/
sync/provider/Decision OS/Player Search/news/notification/Chimmy/Stripe failures and support backlog.
**Acceptance.** Every monitored failure class has a real signal and an honest unavailable state.
**Status:** ⬜ NOT STARTED · **Starts when:** A6 PASS.

---

## 7. Phase detail — Sections B–E (summary)

| Phase | Purpose | Key acceptance | Blocking risk |
|---|---|---|---|
| **B1** Import certification | All six providers honestly certified with a capability matrix (auth, discovery, identities, rosters, scoring, lineup rules, matchups, standings, transactions, trades, draft metadata, history, refresh, limitations) | No provider claims depth it lacks; commissioner-only full-league policy enforced; duplicate-import protection; idempotent, resumable, durable progress | Overstating coverage — the exact failure #336 fixed for Fleaflicker/Yahoo |
| **B2** Five-minute sync | Durable per-league sync targeting 5 min where provider limits permit | One logical job per league; distributed locking; provider-aware scheduling; conditional fetch; backoff; circuit breakers; durable checkpoints; fresh/delayed/stale/partial/failed/rate-limited states; operator alerts on breach | Blind polling every endpoint for every league |
| **B3** Normalized league context | **One** authoritative context consumed by Dashboard, Decision OS, Commissioner/Manager/User/Platform OS, Player Search, Chimmy, notifications, trade evaluator, rankings, AF Legacy | Missing context yields honest unavailable/limited — never generic advice; read-only status carried on the context | Competing context resolvers drifting apart |
| **B4** Dashboard + Decision OS | Global command center; one league selector; every module reacts to selection | All 15 Decision OS scenarios certified incl. missing/stale/external-read-only/commissioner dual-role | Signals rendered without evidence |
| **B5** Player Search | Fast NFL/NCAAF search as its own product | Canonical identity, headshot/logo, injury + freshness, ownership across the user's leagues, league-specific value/recommendation, source + "as of"; indexed server-side search; never mixes ownership between users | Slow per-keystroke provider calls; cross-user leakage |
| **B6** Injury/news + notifications | Fast ingestion → relevance → delivery | Canonical matching, dedup, material-change detection, severity, preferences, quiet hours, delivery status, retry, unsubscribe; every alert explains player/league/roster/source/update time | Alert storms; alerts on stale identity |
| **B7** NFL/NCAAF data + imagery | One governed resolver for player images, one for team images | Defined precedence, licensing awareness, persistent canonical identity, cached verified source, consistent fallback, no broken-image icons, no page-specific precedence | Competing per-page image logic |
| **B8** NFL redraft controlled beta | Beta-ready redraft under feature freeze | Existing frozen features preserved; only defects blocking launch are fixed | Scope creep into frozen draft/creation systems |
| **C1** Event bus + recalculation ledger | Durable record of what changed and what must recompute | Idempotent, replayable, auditable; no double-counting | Recalculation storms |
| **C2** Continuous Intelligence Engine | Real-time evolution as league events occur | Event-driven recalculation with confidence + freshness on every derived value | Silent drift between derived and source truth |
| **C3** Game-day freshness SLOs | NFL/NCAAF game-day targets | Explicit SLO per surface; breach visible to operator and honestly labeled to users | Stale numbers presented confidently on Sunday |
| **D1** Specialty rules model | Represent PPR/half/standard/custom, superflex/2QB, TE premium, IDP, keeper/dynasty, and other format rules | One rule model; no per-feature reinterpretation | Format misread → wrong advice |
| **D2** Rules enforcement | Scoring, lineup, eligibility honor the rule model | Every recommendation respects the league's actual format | Generic advice in a non-standard league |
| **E1** Manager Intelligence foundation | Behavioral event model for manager behavior | Manager-scoped, privacy-respecting, evidence-backed | Conflating manager with franchise (I7) |
| **E2** Behavioral change detection | Detect and explain change with confidence | Confidence, sample size, and freshness always attached | Overclaiming from thin samples |

---

## 8. AF Legacy — future workstream (implementation DEFERRED)

> **AF Legacy is the verified historical intelligence layer of AllFantasy. It preserves
> cross-platform fantasy history, separates managers from franchises, measures performance and
> behavior, powers current Decision OS recommendations, and continuously evolves as new league
> events occur.**

**Implementation is deferred.** No AF Legacy code, scaffolding, schema, or migration is to be
written until its prerequisites and the current launch gates pass. This section exists to preserve
scope and prevent competing implementations — not to authorize work.

### Prerequisites before F1 may begin
A3–A7 PASS · B1–B4 PASS · C1 PASS (event bus) · E1 PASS (behavioral model) · an approved
identity/privacy model · an approved migration gate if new schema is required.

### Capabilities the plan must preserve
- Platform-specific **and** combined wins, losses, playoff appearances, playoff records,
  championships, career results, verified achievements
- Explainable, **evolving** AF Legacy grades
- Manager comparisons, rivalries, bragging-rights sharing
- League, career, player, team, and manager rankings
- Manager Intelligence and behavioral change detection
- Trade Evaluator
- Trade Partner Finder and Trade Proposal Engine
- Waiver recommendations and bid intelligence
- Player Stock, Team Stock, Manager Stock
- Historical timelines and Legacy Stories
- Dashboard and league-workspace signals
- Decision OS and Chimmy context
- Social share cards
- Discord connection workflow
- Privacy controls and identity correction
- Manager-versus-franchise history separation
- Continuous event-driven recalculation
- Clear confidence, freshness, sample-size, and missing-data indicators
- Read-only behavior for Sleeper, ESPN, Yahoo, Fantrax, MFL, Fleaflicker
- Native actions only for AF-created leagues where the user has permission

### Shared-services rule (architectural, binding)
AF Legacy **must consume the same verified intelligence services** as the Dashboard, Trade OS,
Waiver OS, Draft Intelligence, Commissioner OS, rankings, stock movement, Manager Intelligence, and
Chimmy. **No feature may hold its own copy of historical truth.** Any phase that would create a
second historical source FAILs on that basis alone.

### ✅ Approved ordering decision — F1 before F2 (founder-approved 2026-07-24)

**F1 (identity) precedes F2 (historical-data ingestion). This ordering is locked.**

Rationale, as approved: *historical records must attach to a correct identity model from the
beginning.* Ingesting history first would mean every record lands against an identity model that is
still moving, so a later correction — a manager merged with the wrong franchise, a shared household
account split apart, a privacy withdrawal — would require **rewriting history rather than
re-pointing it**. Identity is the cheaper thing to get right first and the far more expensive thing
to retrofit.

This ordering is not to be revisited for schedule reasons. A proposal to ingest history before the
identity model is complete must be treated as a **FAIL condition for F2**, not a trade-off.

### Phase sketches (not authorized to start)
- **F1 identity foundation** — manager vs franchise separation, **ownership history**, identity
  correction, and privacy controls. Must ship a correction path *before* any history depends on it.
  *Risk:* an identity model that cannot be corrected later without rewriting history.
- **F2 historical data foundation** — cross-platform history with provenance and confidence,
  attaching to the F1 identity model. *Risk:* silently merging unverified history across platforms.
- **F3 grading engine** — explainable, evolving grades. *Risk:* an unexplainable grade users cannot
  trust or contest.
- **G1/G2 experience** — timelines, Legacy Stories, dashboard/workspace signals.
- **H1/H2 integration** — Decision OS and Chimmy consume Legacy context through shared services.
- **I1–I5** — Trade, Waiver, Stock, rankings/comparisons, social + Discord.

---

## 9. Everything explicitly deferred

| Deferred | Until |
|---|---|
| **AF Legacy implementation (F1–F3, G1–G2, H1–H2)** | A3–A7, B1–B4, C1, E1 PASS |
| Trade Evaluator / Partner Finder / Proposal Engine (I1) | H1, D2 PASS |
| Waiver Intelligence (I2) | H1, D2 PASS |
| Player / Team / Manager Stock (I3) | F3, C2 PASS |
| Rankings, comparisons, rivalries (I4) | F3 PASS |
| Social share cards + Discord (I5) | I4, F1 PASS |
| Controlled pilot + expansion (J1, J2) | A7, B8 PASS |
| Any schema migration | A separately approved migration gate |
| P1 `/api/ai/providers` fix | Spawned as its own task; not in this branch |
| P2 stale `allfantasy-v2` Vercel project cleanup | Founder/Vercel account action |
| Frozen features — AF league creation, live/mock/auction drafts, draft room + settings, schedule generation, commissioner league-building, sports beyond NFL/NCAAF | Unblocked only by a defect blocking launch |

---

## 11. RESERVED — Admin Reporting Integrity & Data Classification

**Status: awaiting specification.** This section is reserved and intentionally left unwritten.

The founder directed that this workstream be added to the plan, but the body of the specification
did not arrive with the instruction. It is **not** being drafted from inference: this program exists
to stop plausible-looking content from standing in for verified content, and a workstream whose
entire subject is *reporting integrity and data classification* is the last place to guess at a
requirement and let it harden into the authoritative plan.

**What already exists in-plan and will feed this section (not a substitute for the spec):**
- Invariant **I2** — the ten distinguishable states: `confirmed` / `no_activity` / `not_configured` /
  `collection_disabled` / `provider_unavailable` / `delayed` / `stale` / `partial` / `query_failed` /
  `insufficient_evidence`
- Invariant **I4** — first-party DB authoritative; GA4/Pixel labeled separately, never summed
- Invariant **I9** — freshness, source, and "as of" always visible
- Shipped in A2: per-metric `definition`, `source`, `environment`, `window`, `calculatedAt`,
  `freshness`, `sampleSize`, `status`, and the `not_implemented`-with-null-value rule

**To close this section, provide:** the workstream's phases, scope boundaries, classification
taxonomy (and how it relates to or supersedes I2), acceptance criteria, required evidence, and where
it sits in the A–J ordering.

---

## 10. Change log

**2026-07-24 (2) — F1→F2 ordering locked.** Founder approved F1 (manager-vs-franchise identity,
ownership history, identity correction, privacy controls) ahead of F2 historical-data ingestion, on
the basis that historical records must attach to a correct identity model from the beginning.
Recorded in §4 and §8; a proposal to reverse it is a FAIL condition for F2, not a trade-off.
*Pending in this revision: the Admin Reporting Integrity and Data Classification workstream — its
body was referenced but did not arrive; see §11.*

**2026-07-24 — plan established as authoritative.**
Consolidated Phase 0 / 1A / 1B from chat into a gated plan; added the ten-step workflow rule and
PASS-gating; recorded seven verified commits and their verification tiers; separated five
pre-existing issues from current work; added Sections A–J; added AF Legacy as a preserved but
**deferred** workstream with its shared-services rule; identified **A3** as the single active gate
and marked it **BLOCKED** pending a genuine authorized admin session.
