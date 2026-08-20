# Phase 1 — NFL Closed-Beta Current-State Audit & Engineering Tracker

**Date:** 2026-07-24 · **Branch:** `feat/launch-phase0-truth-attribution` @ `d00642247`
**Base:** `origin/main` @ `e61a63886` (= current production SHA)
**Method:** static repository inspection via the git index (`git ls-files` / `git grep`), schema
read, and route enumeration. **No implementation was performed.** Where runtime behavior could not
be verified from code alone, the status is `IMPLEMENTED BUT UNCERTIFIED`, not a guess.

> **Search caveat (recorded for reproducibility):** ripgrep / Glob time out in this working tree
> because ~40 `.next-*` build-cache dirs are untracked and unignored on the older commits.
> All enumeration below therefore used `git ls-files` / `git grep`, which read the committed index
> and are immune to that. A finding of "absent" means **absent from the git index**, which is the
> correct basis for "does the shipping product have this".

---

## 1. Executive assessment

AllFantasy is a **large, mature codebase** (16,490-line Prisma schema, 124 migrations, 43 crons,
1,503 unit-test files, 167 e2e specs), not a greenfield build. The Phase-1 foundations mostly
**exist in code** — six provider adapters, a provider-agnostic import pipeline, a DB-first dashboard
loader, canonical player/team + image registries, an entitlement layer, a custom i18n framework, and
Light/Dark/AF theming.

The gap between here and the closed-beta exit gate is therefore **not "build the features" — it is
"certify that the ones present actually behave correctly for an invited beta user on a phone,"** plus
a small number of genuine holes. The single most consequential hole: **there is no invited/closed-beta
signup gate** — account registration is currently open, so exit-gate requirement #1 ("use the invited-beta
flow") is not enforced by code.

The second theme is **provider-budget discipline**: dedup helpers exist, but there is no general
circuit breaker, per-provider budget, or game-day-reserved capacity for the fantasy providers (only
`world-cup` has a budget). That is a reliability/cost risk the moment real beta traffic arrives.

Nothing in the seven attribution commits on this branch touches Phase-1 redraft surfaces; they are
additive and independently green (121 unit + 11 browser).

---

## 2. Phase-1 exit-gate scorecard

| # | Exit-gate requirement | Status | Primary evidence |
|---|---|---|---|
| 1 | Create account + **invited-beta flow** | 🟠 **PARTIAL** — signup works, invite gate absent | `app/api/auth/register/route.ts` (no invite/allowlist check); `inviteOnly` is creator-league only |
| 2 | Connect a supported platform | 🟡 IMPLEMENTED BUT UNCERTIFIED | 6 adapters `lib/league-import/adapters/*`; discover route `app/api/leagues/import/discover/route.ts` |
| 3 | Import permitted league data | 🟡 IMPLEMENTED BUT UNCERTIFIED | pipeline `app/api/leagues/import/{preview,commit,route}.ts`; commissioner gate `lib/league-import/commissionerGate.ts` |
| 4 | Return without repeating a full import | 🟡 IMPLEMENTED BUT UNCERTIFIED | `getDashboardLeagueListForUser` = pure Prisma reads; resync is separate (`.../import/resync/route.ts`) |
| 5 | See stored leagues quickly on mobile | 🟡 UNCERTIFIED (perf unmeasured) | DB-first loader confirmed; no captured latency numbers in repo |
| 6 | Move between Global / Commissioner / Team | 🟡 IMPLEMENTED BUT UNCERTIFIED | `app/dashboard/**`, `app/league/[leagueId]/**` tabs; commissioner-hub health loader |
| 7 | Understand what needs attention today | 🟡 IMPLEMENTED BUT UNCERTIFIED | Decision OS Truth Phase 1 merged (`e61a63886`); `deriveSignal` per B2C plan |
| 8 | Trustworthy injury / lineup-risk info | 🟡 PARTIAL | `lib/notification-engine.ts`, `NotificationDispatcher.ts`; injury crons present; delivery uncertified |
| 9 | Manager + commissioner without role confusion | 🟡 IMPLEMENTED BUT UNCERTIFIED | entitlement layer `lib/subscription/**`; dual-role not certified end-to-end |
| 10 | Honest freshness / confidence / failure / limits | 🟢 STRONG FOUNDATION | attribution honesty states (this branch); capability badges `providerCapabilities.ts`; Decision OS truth pass |
| 11 | Core NFL redraft journey w/o broken responsive/lang/mode | 🟡 UNCERTIFIED | redraft tests exist; mobile + EN/ES + theme not certified together |

**No requirement is VERIFIED COMPLETE for closed beta**, because none has authenticated,
mobile, production-path certification recorded in the repo. Several are code-complete.

**Where the added workstreams touch the gate** (no existing row status changes):
- Exit-gate **#10** (honest states) now also depends on the MULTI-MODEL-OS no-fabrication carve-out
  (§18): a beta surface must not present an unverified AI fact. Sub-status `PARTIAL` — governance
  covers ~17% of AI routes.
- Exit-gate **#11** (core NFL redraft journey) includes the **trades** surface; per TRADE-OS (§17)
  the beta requirement is only that imported-league trades render **read-only-honest**, not the full
  counter/partner/multi-team engine (P1). Sub-status `UNCERTIFIED`.
- Full TRADE-OS and MULTI-MODEL-OS completeness are **post-beta P1**, not gate rows.

---

## 3. Highest-risk P0 blockers (detail in §12 tracker)

1. **P0-BETA-GATE** — no invited-beta enforcement on signup. Exit-gate #1 cannot pass.
2. **P0-PROVIDER-BUDGET** — no circuit breaker / per-provider budget / game-day reserve for fantasy
   providers. Real beta traffic can exhaust quotas or hammer a failing provider.
3. **P0-STORED-FIRST-TRACE** — the primary dashboard loader is DB-first, but the *other* prefetch
   loaders (rank SSR, commissioner health) and shared league layouts are not proven provider-free on
   the request path. Permanent Rule 2 ("page views must not trigger full external imports") is
   asserted for the list loader only.
4. **P0-MOBILE-CERT** — multiple competing bottom-nav components; safe-area/44px coverage is partial.
   Mobile cannot be certified from code alone; exact routes needing device QA are listed in §6.
5. **P0-IMPORT-CERT** — the six adapters have uneven depth and no single certified capability matrix
   with per-domain coverage; commissioner-only full-import policy must be proven un-bypassable.

---

## 4. What is already safely reusable (do not rebuild)

| Asset | Evidence | Why it's trustworthy |
|---|---|---|
| Provider capability classification | `lib/league-import/commissionerGate.ts` (`OPEN_READ_PROVIDERS`, `MEMBERSHIP_VERIFIED_UNDETERMINED_COMMISSIONER`), `lib/shared-services/league-hub/providerCapabilities.ts` | Explicitly refuses to claim sync/verification a provider can't prove; honest `manual_refresh` labeling |
| Provider-agnostic import pipeline | `app/api/leagues/import/{discover,preview,commit,progress,resync,sync}/route.ts` | Real job/progress model, not per-provider one-offs |
| DB-first dashboard loader | `lib/dashboard/get-dashboard-league-list.ts:251` | Pure Prisma; merges native `League` + imported `LegacyLeague`; no provider call |
| Canonical identity + image registries | schema `Player` (2733), `Team` (15770), `SportsTeam` (73), `PlayerImage` (15914), `TeamImage` (15837) | Canonical Player/Team foundation already merged |
| Snapshot/checkpoint models | `RosterSnapshot` (12469), `FantasyRosterSnapshot` (16190), `IntelligenceLeagueSnapshot` (13510), `ProviderSyncState` (2324) | Persisted storage exists to back stored-first |
| Entitlement layer | `lib/subscription/{EntitlementResolver,FeatureGateService,requireEntitlement,entitlement-middleware,webhookHandlers}.ts`, `lib/tokens/TokenSpendService.ts` | Server-side gating + webhook-confirmed state |
| Attribution + funnel truth (this branch) | Phase 0/1A/1B, 121 unit + 11 browser green | Honest unavailable states, server-authoritative identity |
| i18n framework | `components/i18n/LanguageProviderClient.tsx`, `app/api/i18n/{preference,translations}/route.ts`, `lib/i18n/constants.ts` | Stored preference + translation delivery already wired |
| Theme system | `components/theme/ThemeProvider.tsx`, `lib/theme/constants.ts`, `__tests__/commissioner-os-design-tokens.test.ts` | Light/Dark/AF with a token test guard |

---

## 5. Provider / page-load exposure summary

**Confirmed DB-first:** `getDashboardLeagueListForUser` (the league list) issues **zero** provider
calls — Prisma only. Import is a **separate**, user-triggered pipeline (`app/api/leagues/import/*`),
not something a page render invokes.

**Not yet proven provider-free on the request path** (must be traced — P0-STORED-FIRST-TRACE):
- `fetchUserRankJsonForDashboardSSR` (called in `app/dashboard/page.tsx`)
- `getCommissionerHubHealthForUser` (called in `app/dashboard/page.tsx`)
- Shared league layout loaders under `app/league/[leagueId]/**`

**Budget/reliability primitives that EXIST:** `lib/api-performance/dedupe.ts`,
`lib/league-engine-performance/leagueRequestDedupe.ts`, `lib/sports-data-gateway/gateway.ts`.
**ABSENT for fantasy providers:** circuit breaker, per-provider budget, exponential backoff policy,
game-day reserved capacity, priority queue (only `lib/world-cup/worldCupProviderBudget.ts` has a
budget, and it is World-Cup-specific).

The full per-endpoint Provider Call Inventory is §8; anything on the critical page-load path is
flagged there.

---

## 6. Mobile readiness summary

**Primitives present but fragmented.** Five distinct mobile-navigation components exist —
`components/dashboard/adaptive/shell/MobileNav.tsx`, `components/league/BottomNav.tsx`,
`components/mobile/BottomTabBar.tsx`, `components/shell/MobileNavDrawer.tsx`,
`components/shell/MobileNavigationDrawer.tsx` — which is a consistency risk, not a certification.

`safe-area-inset` is used in the main shells (`app/dashboard/DashboardShell.tsx`,
`app/league/[leagueId]/LeagueShell.tsx`) but not proven across all beta-critical routes. 44×44 touch
targets appear in some components (`components/SleeperImportForm.tsx`, several `ai-*`), not
systematically.

**Routes that require manual device certification (iPhone Safari + Samsung Chrome, 320/375–479px):**
`/` (landing), `/signup` + invite, `/login`, `/dashboard`, league selector, Global command center,
`/league/[id]` Team + Commissioner tabs, roster, players/waivers, matchup, trades, notifications,
Chimmy entry, settings/logout. None of these has a committed mobile-viewport e2e proof for the full
journey.

---

## 7. Role & entitlement findings

The layer is **rich and server-enforced in principle** (`requireEntitlement.ts`,
`entitlement-middleware.ts`, `FeatureGateService.ts`). Certification must confirm, per Permanent
Rules 4–6:
- **Commissioner dual-role** — commissioner mode must not hide the commissioner's own manager tools
  (Rule 5). Not certified end-to-end.
- **Imported-league read-only** — no imported-league action may render as directly executable
  upstream (Rule 4). The Shadow-League Write Authority work (`lib/league/write-authority.ts`, PR #337,
  not on this branch) is the intended enforcement; on `main` this is **not yet centralized**.
- **Critical-truth-not-paywalled** — injury/inactive/lineup-risk must stay free (Rule 6). The gating
  matrix (`lib/subscription/feature-gate-matrix.ts`) must be audited to prove availability info is
  never behind a paid gate.
- **No token deduction on failure** — `TokenSpendService.ts` must be audited for charge-before-completion
  (a known deferred issue in prior audits).

Known standing hazards from repo history to re-verify, not assume fixed: unauthenticated league
analytics routes; decorative `lib/api-auth.ts` helpers; two admin authorization tiers.

---

## 8. Provider Call Inventory (critical-path items highlighted)

> Quota/pricing values are **"requires external confirmation"** unless present in the repo. None were
> found hard-coded for the fantasy providers.

| Provider | Operation | Caller (file) | Trigger | Page-load? | Cache/dedup | Budget/breaker | Notes |
|---|---|---|---|---|---|---|---|
| Sleeper | league/roster/matchup fetch | `lib/league-import/adapters/sleeper/*`, `lib/league/sleeper-import-process.ts` | user import + resync | **No** (import only) | `leagueRequestDedupe` | none | deepest adapter; public API, no auth |
| ESPN | league fetch | `lib/league-import/adapters/espn/EspnAdapter.ts`, `lib/league-import/espn/EspnLeagueFetchService.ts` | user import | **No** | unverified | none | cookie auth for private (memory #258) |
| Yahoo | league fetch | `lib/league-import/adapters/yahoo/YahooAdapter.ts` | user import | **No** | unverified | none | OAuth; depth uncertified |
| MFL | league fetch | `lib/league-import/adapters/mfl/MflAdapter.ts` | user import | **No** | unverified | none | credential write via `app/api/league/auth/route.ts` |
| Fantrax | league fetch | `lib/league-import/adapters/fantrax/*` | user import | **No** | unverified | none | `csv_snapshot` type — not live sync |
| Fleaflicker | league fetch | `lib/league-import/adapters/fleaflicker/FleaflickerAdapter.ts` | user import | **No** | unverified | none | open read, no membership proof |
| Sports data (RollingInsights/API-Sports/CFBD/TheSportsDB) | scores/players/injuries/schedules/news/stats | `app/api/cron/import-*` (13+ crons) | **cron only** | **No** | per-cron | none general | provider outage risk (memory: RI REST gone) |
| Sports-data-gateway | certified reads | `lib/sports-data-gateway/gateway.ts` + runtime | varies | **needs trace** | gateway-level | none | Fantasy-OS Phase-5; wired-vs-dormant uncertified |

**Critical-path exposure:** none of the six league providers is called on a page render (import is a
separate action). The open question is the gateway/runtime reads and the two dashboard prefetch
loaders (§5) — flagged P0-STORED-FIRST-TRACE.

---

## 9. Phase-1 Test Matrix (what exists vs. what's needed)

`__tests__` holds **1,503** test files; `e2e/` holds **167** specs. Beta-critical coverage that
**exists** (representative):

| Area | Existing evidence | Gap for closed-beta certification |
|---|---|---|
| Import / reimport | `__tests__/canonical-import-normalizer*.test.ts`, `c2c-multisource-import-regression.test.ts`, `commissioner-roster-settings-import-route.test.ts` | per-provider capability certification; repeat-login-no-reimport proof |
| Repeat-login / stored-first | `__tests__/dashboard/league-card-fetch-policy.test.ts`, `dashboard/my-leagues-membership.test.ts` | end-to-end "return visit issues no provider call" assertion |
| Snapshot / cache | `__tests__/decision-os/capture-league-snapshot-job.test.ts`, `activity-response-cache.test.ts` | freshness/last-success surfaced to UI |
| Permissions / entitlements | `__tests__/auth-entitlements.test.ts`, `chimmy-action-permission-framework.test.ts` | commissioner dual-role; imported-league read-only; critical-truth-free |
| Notifications | `__tests__/commissioner-os-notifications*.test.ts` | injury delivery + dedup + honest failure |
| Provider adapters | `__tests__/cfbd-provider-support.test.ts`, `ai/providerRouter.test.ts` | ESPN/Yahoo/MFL/Fleaflicker live-behavior certification |
| i18n | `__tests__/brackets-i18n.test.ts`, `test:i18n` script (`i18n-placeholder-parity`) | EN/ES coverage on beta-critical pages |
| Theme | `__tests__/commissioner-os-design-tokens.test.ts`, `chimmy-theme-readability.test.tsx` | Light/Dark/AF on every beta route; hydration-mode match |
| Mobile viewport | — (none found for the full journey) | **whole journey at 320/375–479px** — biggest test gap |
| Attribution/funnel (this branch) | 121 unit + 11 browser, green | — (done) |
| TRADE-OS (post-beta P1) | `__tests__/*trade*`, `lib/decision-os/trade/*`; sim tests | **AI-cannot-bypass-deterministic-verify** negative test; per-tier counter fairness bounds; multi-team roster-legality |
| MULTI-MODEL-OS (post-beta P1) | `__tests__/ai/{providerErrors,providerRouter,aiCache}.test.ts` | the five bad-response classes (malformed/stale/fabricated/conflicting/unavailable); provenance stamping; no-AI-on-render-path guard |
| B2B-OS (future P2/P3) | — (net-new) | partner isolation; capability default-deny; delegated-write audit trail; de-identified-learning boundary |

**Production-certification steps still owed:** authenticated `/admin` + `/dashboard` desktop **and**
mobile walk; deployed-SHA confirmation; deployment error-field inspection; no `too_many_routes`
(currently 2009/2048 headroom 39). These are the A3 gate items from `AF_LAUNCH_PROGRAM_PLAN.md`.

---

## 10. Phase-1 dependency map

```
Auth/invites (P0-BETA-GATE)
   └─> Platform identity + connection (adapters, commissionerGate)
          └─> Import authorization (commissioner-only, un-bypassable)
                 └─> Stored persistence (League / LegacyLeague / snapshots)
                        ├─> Snapshots + canonical identity + assets (present)
                        │      └─> Dashboard stored-first loading (DB-first; trace remaining loaders)
                        │             └─> Delta synchronization (resync exists; delta selectivity uncertified)
                        └─> Provider budget control (P0-PROVIDER-BUDGET) ── wraps every provider call above
   Cross-cutting, gate all of the above at the UI:
       Notifications (honest states) · Mobile certification · Language/mode stability · Role/entitlement enforcement
   Terminal:
       Production certification (A3) ── requires an authorized admin session
```

**Ordering rule:** budget control (P0-PROVIDER-BUDGET) and the stored-first trace
(P0-STORED-FIRST-TRACE) should land **before** inviting real users, because both are about not
melting under real traffic. The beta gate (P0-BETA-GATE) must land before *any* invite is sent.

**Post-beta P1 additions attach as follows** (not on the Phase-1 critical path):
```
P0-2 Provider budget/breaker ──(extend the same gateway to AI providers)──> P1-8 MULTI-MODEL governed path
P0-4 Import cert (asset truth) ──> P1-7 TRADE-OS deterministic-verify + counter packages
P1-8 MULTI-MODEL governed path ──> P1-7 (trade AI candidates flow through the governed path)
F1 identity (deferred) ──> P2-B2B partner identity mapping ──> P3-B2B partner write/delivery
```
The circuit breaker is built **once** in P0-2 and reused by P1-8 — do not build a second AI-only breaker.

---

## 11. Status-label legend

`VERIFIED COMPLETE` · `IMPLEMENTED BUT UNCERTIFIED` · `PARTIAL` · `PLACEHOLDER OR MOCK` ·
`DOCUMENTED ONLY` · `MISSING` · `BLOCKED BY CONFIGURATION` · `BLOCKED BY EXTERNAL ACCESS` ·
`OUT OF PHASE 1 SCOPE`. Used verbatim in §2 and §12.

---

## 12. P0/P1/P2/P3 engineering tracker

> Complexity: S/M/L/XL. Order = recommended execution order within priority.

### P0 — blocks closed-beta reliability, security, correctness, stored-first, mobile, or trust

**P0-1 · BETA-GATE · Invited-beta signup enforcement** — Status: `IMPLEMENTED (code-complete, test-verified; not yet browser/prod-certified)` — implemented 2026-07-24

> **Completion update (2026-07-24, second pass):** token-only admission **CLOSED** — every
> ordinary invite is now strictly email-bound (`evaluateInvite` rejects a null caller email, a
> blank invited email, and any mismatch with one code; `issueInvite` refuses a missing email). The
> **Sleeper-username new-account path is BLOCKED** under `INVITE_ONLY` (synthetic email can't match a
> bound invite) rather than admitted by token. **Admin issuance UI shipped** at `/admin`
> ("Closed-Beta Invitations" — `components/admin/BetaInvitePanel.tsx`): issue (email required, optional
> expiry/note), copy-once claim URL with an unrecoverable-after-dismiss warning, active/expired/
> redeemed/revoked filter, revoke; Light-default, mobile-usable, no raw URL in localStorage/analytics.
> No-gambling sentence added to signup. **SEO:** signup `noindex`, `/admin` page-level `noindex`,
> robots `Disallow: /api/auth/beta`. **Rate-limited** claim + admin-issue (repo `rateLimit` idiom,
> IP/admin-keyed). Migration **applied to the safe test DB** (`ep-muddy-leaf`) and schema verified
> (12 cols, `invitedEmail NOT NULL`, 5 indexes). **Live credentials journey certified end-to-end on the
> test DB:** block(403) → claim(HttpOnly cookie) → admit(200) → reuse(403 redeemed) → wrong-email(403
> mismatch); DB truth = exactly 1 account, invite redeemed+bound, `signup_completed` once, wrong-email
> invite left pending. Signup browser render: noindex, Light bg, no-gambling text, httpOnly cookie not
> JS-readable, no mobile overflow. **77 auth+beta+attribution tests pass** (58 beta-specific; the 2
> previously-red social-linking tests are now genuinely repaired). **Still blocked (needs credentials I
> lack):** authenticated admin-UI browser walk + OAuth-provider browser walk + production merge/deploy/
> migration/smoke — see §12 P0-1 remaining + the handoff.
>
> **Original implementation summary.** One centralized server-only admission service
> (`lib/beta-invite/betaAdmissionService.ts`) gates **all four** real account-creation paths:
> credentials register (`app/api/auth/register/route.ts`, consume in the create `$transaction`),
> OAuth new-account (`lib/auth/SocialAccountLinkingService.ts`, consume in a `$transaction`,
> email-matched), and the Sleeper-username new account (`lib/auth.ts`, token-only). Dedicated
> additive `BetaInvite` model (raw token never stored — sha256 digest only). Admin issue/list/revoke
> at `app/api/admin/beta-invites` (`requireAdmin`); claim link at `app/api/auth/beta/claim` sets a
> short-lived httpOnly `SameSite=Lax` admission cookie that survives the OAuth redirect. Flag
> `INVITE_ONLY` (server-only) — default off; malformed-in-production fails **closed**. Single-use is
> an atomic status-guarded `updateMany`; a failed create rolls the consume back (invite not burned).
> **Migration authored but NOT applied** (`prisma/migrations/20260724000000_beta_invite_account_admission`)
> — goes through the separate migration gate. **58 tests** (38 new: service behavior + no-bypass source
> assertions). Remaining: authenticated browser certification of the live journey + admin UI (there is
> currently no admin *page* for issuance — the API exists; a minimal UI or manual API use is the gap).
> **Rollback:** unset `INVITE_ONLY` (no schema rollback needed to reopen signup).

Original finding (for the record):
- **Problem:** account registration is open; exit-gate #1 ("invited-beta flow") is not enforced.
- **Evidence:** `app/api/auth/register/route.ts:162` POST has no invite/allowlist/403 check; `git grep inviteOnly` → creator-league only; `EarlyAccessSignup` model (schema:11) captures interest but does not gate.
- **Scope:** invite issuance + validation (single-use, expiry, reuse rules) enforced server-side in the register path and any OAuth-create path; admin issuance UI reuses `ADMIN_EMAILS` allowlist. **Out of scope:** redesigning signup UI.
- **Dependencies:** none (foundational).
- **Security/data:** invite tokens must be unguessable, single-use, server-validated; a failed invite must not create a partial account.
- **Acceptance:** unauthenticated signup without a valid invite is refused; a valid invite creates exactly one account and cannot be reused; OAuth-create honors the same gate.
- **Tests:** invite valid/expired/reused/absent; OAuth-create gated; no partial account on failure.
- **Observability:** count invite issued/accepted/rejected (reuse the funnel emitters).
- **Rollback:** feature-flag `INVITE_ONLY`; off = current open behavior.
- **Complexity:** M · **Order:** 1

**P0-2 · PROVIDER-BUDGET · Provider ingestion gateway with budget + breaker** — Status: `PARTIAL`
- **Problem:** no circuit breaker, per-provider budget, backoff, or game-day reserve for fantasy providers; a failing provider can be hammered and quotas exhausted under beta load.
- **Evidence:** only `lib/api-performance/dedupe.ts` + `leagueRequestDedupe.ts` exist; `git grep circuitBreaker|provider.*budget` → only `lib/world-cup/worldCupProviderBudget.ts`.
- **Scope:** a shared gateway wrapping provider calls with dedup (reuse existing), exponential backoff, retry limit, circuit breaker, per-provider budget, and reserved game-day capacity. **Out of scope:** rewriting the adapters' fetch logic.
- **Dependencies:** none; wraps existing adapters.
- **Concerns:** quota/pricing values require external confirmation — do not hard-code.
- **Acceptance:** a provider returning errors trips the breaker; budget exhaustion degrades to stored data with an honest stale state, never a blank page (Rule 2/7).
- **Tests:** breaker open/half-open/closed; backoff schedule; budget exhaustion → stored fallback.
- **Observability:** per-provider call count, failure rate, breaker state, budget remaining.
- **Rollback:** gateway pass-through mode.
- **Complexity:** L · **Order:** 2

**P0-3 · STORED-FIRST-TRACE · Prove no provider call on page render** — Status: `PARTIAL`
- **Problem:** the league-list loader is DB-first, but the rank SSR loader, commissioner-health loader, and shared league layouts are not proven provider-free on the request path (Rule 2).
- **Evidence:** `app/dashboard/page.tsx` calls `fetchUserRankJsonForDashboardSSR` + `getCommissionerHubHealthForUser`; not yet traced.
- **Scope:** trace each dashboard/league request-path loader; move any provider call to the background sync path; add a guard test asserting the render path issues zero provider calls. **Out of scope:** the import pipeline (already separate).
- **Acceptance:** a repeat-login dashboard render issues zero external provider requests; external provider failure never blanks an already-stored dashboard.
- **Tests:** mock provider layer throws → dashboard still renders stored data; assert provider client not invoked during SSR.
- **Complexity:** M · **Order:** 3

**P0-4 · IMPORT-CERT · Six-provider capability certification + un-bypassable commissioner gate** — Status: `IMPLEMENTED BUT UNCERTIFIED`
- **Problem:** adapters vary in depth; no single certified per-domain capability matrix; commissioner-only full-import must be proven un-bypassable.
- **Evidence:** `commissionerGate.ts` classifies providers honestly; per-domain coverage (rosters/scoring/matchups/standings/drafts/transactions/history) not certified per provider; `docs/import/` is empty on this branch (the Phase-A doc lives only in the preserve commit `1864204ec`).
- **Scope:** certify each provider's real coverage against a live/sandbox account; publish the capability matrix; add a test proving no import path bypasses the commissioner gate. **Out of scope:** adding new providers.
- **Dependencies:** P0-2 (calls go through the gateway).
- **Acceptance:** every claimed capability is backed by a passing provider test or is labeled unavailable; no non-commissioner can trigger a full-league import where policy requires it.
- **Tests:** per-provider domain coverage; gate-bypass negative test; duplicate-import idempotency.
- **Complexity:** XL · **Order:** 4 (can parallelize per provider)

**P0-5 · MOBILE-CERT · Beta-journey mobile certification + nav consolidation** — Status: `PARTIAL`
- **Problem:** five competing mobile-nav components; safe-area/44px coverage partial; no full-journey mobile proof.
- **Evidence:** §6 component list; `git grep safe-area-inset` → main shells only.
- **Scope:** choose one canonical mobile shell for beta routes; ensure safe-area, 44px targets, no horizontal overflow, keyboard-safe forms, ~30% lower dashboard density; add mobile-viewport e2e for the journey in §6. **Out of scope:** non-beta surfaces (brackets, zombie, survivor).
- **Acceptance:** the §6 journey renders correctly at 320/375–479px on iPhone Safari + Samsung Chrome with no overflow or hover-only actions.
- **Tests:** Playwright at mobile viewports for each §6 route; touch-target lint.
- **Complexity:** L · **Order:** 5

**P0-6 · NOTIF-TRUST · Injury/lineup-risk delivery + honest failure** — Status: `PARTIAL`
- **Problem:** engine + dispatcher exist; delivery, dedup, materiality, and honest failure states are uncertified; critical-truth-not-paywalled (Rule 6) unproven.
- **Evidence:** `lib/notification-engine.ts`, `lib/notifications/NotificationDispatcher.ts`; `notification_outbox` is a known dead path.
- **Scope:** certify injury/out/DNP/inactive/suspension → relevance → delivery with source + AF timestamps, dedup, and honest provider/delivery-failure states; prove availability info is free. **Out of scope:** full Personnel/Scheme Decision Packets (later phase; foundation only).
- **Acceptance:** a material injury to a rostered starter produces exactly one alert naming player/league/roster/source/time; a stale source is labeled, not hidden; availability info is never paywalled.
- **Tests:** dedup; materiality; stale/failure states; free-tier availability access.
- **Complexity:** L · **Order:** 6

**P0-7 · ROLE-CERT · Commissioner dual-role + imported read-only enforcement** — Status: `IMPLEMENTED BUT UNCERTIFIED`
- **Problem:** dual-role and imported-league read-only not certified end-to-end (Rules 4–5).
- **Evidence:** entitlement layer present; centralized write-authority (`lib/league/write-authority.ts`) is on PR #337, **not on main**.
- **Scope:** certify commissioner keeps manager tools in commissioner mode; every imported-league mutation routes through a read-only-aware authority and never claims an unsupported upstream write. **Out of scope:** native AF-league write features.
- **Acceptance:** commissioner sees their manager team in commissioner mode; no imported-league action implies an upstream change it cannot make; UI checks are backed by server enforcement.
- **Tests:** dual-role visibility; imported-league write-attempt negative tests; server-enforcement (not UI-only).
- **Complexity:** L · **Order:** 7

### P1 — strong beta retention, paid value, EN/ES completeness, NCAAF readiness

- **P1-1 · A3 production certification** (`BLOCKED BY EXTERNAL ACCESS` — needs an authorized admin session; the single active gate in `AF_LAUNCH_PROGRAM_PLAN.md`). Complexity M.
- **P1-2 · Delta-sync selectivity** — resync exists; prove only changed dependencies recalculated (Rule 3). Complexity L.
- **P1-3 · EN/ES coverage on beta-critical pages** — framework present; certify no hard-coded strings, dates/numbers, long-ES layout. Complexity M.
- **P1-4 · Light/Dark/AF certification on every beta route** — no hydration mismatch, no invisible text, no washed-out logos. Complexity M.
- **P1-5 · Remaining funnel emitters** (`start_clicked` … `import_completed`) — from `AF_LAUNCH_PROGRAM_PLAN.md` A5. Complexity M.
- **P1-6 · Stripe webhook-confirmed conversion + no-charge-on-failure** — A6. Complexity L.
- **P1-7 · TRADE-OS deterministic-verify guarantee + counter packages** (`PARTIAL`) — prove no
  AI-proposed trade bypasses `rules.ts`/`allowed-assets.ts`/`rosterIdentity.ts`; add the missing
  conservative/balanced/aggressive counter tiers and the recipient-small-advantage rule; certify
  multi-team (3/4) structures. Evidence §17. Depends on P0-4 (asset truth) + MULTI-MODEL governance.
  Tests: AI-bypass negative test; per-tier fairness bounds; multi-team roster-legality. Complexity L.
- **P1-8 · MULTI-MODEL-OS mandatory governed path** (`PARTIAL`) — route the ~58 ungoverned AI routes
  through the orchestrator; add the AI-provider circuit breaker (shares the P0-2 gateway); certify
  malformed/stale/fabricated/conflicting/unavailable handling. Evidence §18. Tests: the five bad-response
  classes; provenance stamping; verify-after-generate. Complexity XL (parallelizable per route family).

**Phase-1 carve-outs from P1-7 / P1-8 that ARE beta blockers** (folded into existing P0s, not new
tickets): imported-league trades render read-only-honest → **P0-7 ROLE-CERT**; no AI call on a
critical render path + no fabricated AI fact on a beta surface → **P0-3 STORED-FIRST-TRACE** extended
to AI callers, and invariant I3.

### P2 — post-beta expansion

- Hosted-league native actions; bracket platform; deeper community/Discord; AF Legacy identity
  foundation (F1, deferred, ordering locked).
- **P2-B2B · B2B-OS read/advisory foundation** — multi-tenant isolation, partner identity mapping
  (reuses F1), capability registry (default-deny), read/advisory integration, League Health Score,
  at-risk detection, intervention recommendations + outcome measurement, retention reporting, partner
  admin console with auditable commands. Evidence §19 (net-new; nothing in the index today).
  **Not a Phase-1 dependency.** Complexity XL.

### P3 — staged additional sports & B2B write/delivery

- MLB/NBA/WNBA/NHL/soccer/CBB/golf/wrestling/brackets — architecture must not be blocked now (Rule 8),
  but **no build during this assignment**.
- **P3-B2B · B2B-OS partner write + delivery** — controlled partner write adapters (delegated auth,
  explicit capability, human confirm, idempotency, verification, audit), white-label/embedded/API-SDK
  delivery, per-partner feature/model controls, kill switches, metering, quotas, SLA reporting.
  Gated on a signed pilot + sandbox access (§19). Complexity XL.

---

## 12b. Recommended execution sequence

**P0-1 BETA-GATE remains first — repository evidence added in this revision does not contradict it**
(TRADE-OS and MULTI-MODEL-OS are `PARTIAL`/post-beta; B2B-OS is future). Sequence:

1. **P0-1 BETA-GATE** (must precede any invite)
2. **P0-2 PROVIDER-BUDGET** + circuit breaker (reused later by P1-8; precedes real traffic)
3. **P0-3 STORED-FIRST-TRACE** — extend to AI callers so no AI/provider call blocks a render
4. **P0-4 IMPORT-CERT** (parallelizable per provider) · **P0-5 MOBILE-CERT** (parallel track)
5. **P0-6 NOTIF-TRUST** · **P0-7 ROLE-CERT** (includes imported-trade read-only honesty from §17)
6. **P1-1 A3 production certification** (blocked on admin session — can be scheduled the moment it exists)
7. **P1-2…P1-6** (delta-sync, EN/ES, Light/Dark/AF, funnel emitters, Stripe)
8. **P1-7 TRADE-OS** (after P0-4 asset truth + P1-8 governed AI path) · **P1-8 MULTI-MODEL governed path**
9. **P2** (AF Legacy F1, B2B-OS read/advisory) → **P3** (additional sports, B2B write/delivery)

Steps 1–5 are the closed-beta critical path; 8–9 are explicitly post-beta.

---

## 13. Recommended first implementation packet

**Packet: P0-1 BETA-GATE — invited-beta signup enforcement.**

**Why first:** it is the top of the dependency map (§10), the only P0 that is fully `MISSING` (the
others are `PARTIAL`/`UNCERTIFIED` and safe to certify in place), it is small and isolated, and **no
invite may be sent to a real beta user until it exists** — so it blocks the entire closed beta the
moment users are invited. It also has a clean feature-flag rollback.

**Likely files:** `app/api/auth/register/route.ts` (add gate); a new `lib/beta-invite/*` service
(issue/validate/consume); the OAuth-create path in `lib/auth/SocialAccountLinkingService.ts` (same
gate); an admin issuance route under the existing `app/api/admin/**` keep-list; the signup UI to
surface an invite field and an honest "invite required" state.

**Database changes:** likely one additive `BetaInvite` model (token, issuedTo, issuedBy, expiresAt,
consumedAt, consumedByUserId). **Migration safety:** additive, nullable, no backfill; **must go
through the separate migration gate** — this audit does not apply it. If an existing model
(`EarlyAccessSignup`, `LeagueInvite`) can carry it without overload, prefer that and avoid a
migration; that determination is the first task of the packet, not an assumption here.

**Test plan:** valid/expired/reused/absent invite; OAuth-create gated identically; no partial account
on failure; flag-off preserves current behavior.

**Acceptance:** §12 P0-1 acceptance criteria.

**Rollback/disable:** `INVITE_ONLY` flag; unset = today's open signup.

**Explicitly untouched by this packet:** the attribution/funnel work (Phase 0/1A/1B), the import
pipeline, the dashboard loaders, provider adapters, entitlements, and every frozen feature (drafts,
league creation, schedule generation). This packet adds a gate in front of signup and nothing else.

> **Not implemented in this audit.** Per instruction, the packet is described, not built. No isolated
> audit-blocking defect was found, so no code was changed.

---

## 17. Added workstream — TRADE-OS (audit)

**Overall: `IMPLEMENTED BUT UNCERTIFIED`, with two genuine gaps.** A deterministic trade engine and a
dedicated trade-finder module both exist; the AI-generates / deterministic-verifies split the mandate
requires is already the design intent in code. What is missing is the three-tier counter *packages*
and certified multi-team structures.

**Deterministic verification layer (the part that must own truth) — present:**
`lib/decision-os/trade/` — `parity.ts` (fairness), `rules.ts` (roster-legality), `rosterIdentity.ts`
(team/asset identity), `decision.ts`, `loader.ts`, `outcome.ts`, `canonicalMemo.ts`, `shadow.ts`,
`dco.ts`. `lib/trade-finder/` — `asset-index.ts` (169), `allowed-assets.ts` (246, tradability/
eligibility), `candidate-generator.ts` (966), `partner-matchmaking.ts` (564, alternative partners),
`score-candidate.ts`, `apply-counter.ts` (64), `negotiation-helpers.ts`.

**Routes present:** `app/api/engine/trade/analyze/route.ts`, `.../simulate-counter/route.ts`,
`app/api/leagues/[leagueId]/draft/trade-builder/{analyze,inventory,suggestions}/route.ts`,
`.../trade-proposals/[proposalId]/{respond,review}/route.ts`, `app/api/ai/trade-*` (several).

**AI candidate/explanation layer — present:** `lib/ai/trade/aiTradeMarket.ts`,
`lib/ai/opponents/trades/*`, `lib/ai-commissioner/TradeFairnessAnalyzer.ts`, `lib/chimmy-trade/*`
(grounding, intent, tools), prompt `lib/agents/prompts/trade_analyzer_agent_prompt.md`.

| TRADE-OS requirement | Status | Evidence / gap | Phase |
|---|---|---|---|
| Counteroffer generation | `IMPLEMENTED BUT UNCERTIFIED` | `apply-counter.ts`, `simulate-counter/route.ts` | P1 |
| Conservative/balanced/aggressive counter **packages** | `PARTIAL` | "balanced" is one decision string (`decision.ts:193`); three deterministic tiers not found — concept lives in the AI prompt only | P1 |
| Acceptable fairness *range* (not exact 50/50) | `IMPLEMENTED BUT UNCERTIFIED` | `parity.ts` present; range semantics not certified | P1 |
| Small value advantage to recipient | `MISSING` (unverified in code) | no `recipientEdge`/`slightlyFavor` logic found | P1 |
| Alternative trade-partner discovery | `IMPLEMENTED BUT UNCERTIFIED` | `partner-matchmaking.ts` (564) | P1 |
| Three-/four-team structures | `PARTIAL` | `RuleValidationEngine.ts` references multiTeam; no certified 3/4-team engine | P1 |
| League-specific asset inventory | `IMPLEMENTED BUT UNCERTIFIED` | `asset-index.ts`, `trade-builder/inventory/route.ts` | P1 |
| Picks / FAAB / prospects / keepers | `IMPLEMENTED BUT UNCERTIFIED` | `allowed-assets.ts` classifies asset types | P1 |
| Tradability / eligibility / roster-legality / rule validation | `IMPLEMENTED BUT UNCERTIFIED` | `allowed-assets.ts`, `rules.ts`, `RuleValidationEngine.ts` | P1 |
| Manager-psychology / trade-history inputs | `IMPLEMENTED BUT UNCERTIFIED` | `recordTradeParticipants.ts`, `comprehensive-trade-learning.ts` | P1 |
| Short/long-term roster effects | `IMPLEMENTED BUT UNCERTIFIED` | `outcome.ts`, sim `lib/ai/sim/tradeSimulator.ts` | P1 |
| Confidence / freshness / provenance / imported-read-only msg | `PARTIAL` | Decision OS truth pass covers confidence; imported read-only wording not certified here | **Phase 1** (read-only honesty is a beta invariant) |
| Server enforcement + tests | `IMPLEMENTED BUT UNCERTIFIED` | routes are server-side; `__tests__/*trade*`; deterministic-verify-every-asset not proven un-bypassable | P1 |

**Mandate check — "AI may generate, AF deterministic code must verify every asset/team/permission/
resulting roster":** the split exists structurally, but there is **no test proving an AI-proposed
trade cannot bypass `rules.ts`/`allowed-assets.ts`/`rosterIdentity.ts`**. That proof is the P1 ticket.

**Phase-1 slice only:** imported-league trades must render **read-only-honest** (no "execute"
implication) — that is invariant I1 and part of the mobile journey (§6). The rest of TRADE-OS
(counter packages, partner discovery, multi-team) is **post-beta P1**, matching `I1` in
`AF_LAUNCH_PROGRAM_PLAN.md`.

---

## 18. Added workstream — MULTI-MODEL-OS (audit)

**Overall: real integration exists — this is NOT env-var-only — but governance coverage is the
headline gap.** All three named providers are implemented, an orchestration layer exists, and a
Decision Packet format exists. However **only ~17% of AI routes are governed**, and there is **no
circuit breaker** in the AI path.

**Real provider integrations (not just env references):**
- OpenAI — `lib/ai-orchestration/providers/openai-provider.ts`, `lib/openai-client.ts`, `lib/ai/openai-route-client.ts`
- xAI Grok — `lib/ai-orchestration/providers/grok-provider.ts`, `lib/autocoach/status-sources/XGrokAdapter.ts`
- DeepSeek — `lib/ai-orchestration/providers/deepseek-provider.ts`, `lib/deepseek-client.ts`

**Orchestration layer:** `lib/ai-orchestration/{orchestration-service,provider-registry,
provider-interface,quality-gate,request-validator,response-normalizer,fallback-policy,tracing,
tool-registry}.ts`; `lib/ai-orchestration-engine/{deterministic-rules,fallback-policy,
provider-health-check}.ts`.

**Decision Packet format:** `lib/ai-context-envelope/{contracts,schema,index}.ts` +
`lib/unified-ai/AIContextEnvelopeBuilder.ts` ("AI Context Envelope" is the Decision Packet).

| MULTI-MODEL-OS requirement | Status | Evidence / gap | Phase |
|---|---|---|---|
| OpenAI deep reasoning/synthesis | `IMPLEMENTED BUT UNCERTIFIED` | `openai-provider.ts` | P1 |
| xAI Grok current-info/search/social | `IMPLEMENTED BUT UNCERTIFIED` | `grok-provider.ts`, `XGrokAdapter.ts` — web/X search depth uncertified | P1 |
| DeepSeek fast/batch analysis | `IMPLEMENTED BUT UNCERTIFIED` | `deepseek-provider.ts` | P1 |
| Provider-independent gateway | `IMPLEMENTED BUT UNCERTIFIED` | `orchestration-service.ts`, `provider-interface.ts`, `provider-registry.ts` | P1 |
| Task router (task → model) | `PARTIAL` | `tool-registry.ts`/`tool-key-normalizer.ts` route by tool; explicit per-task model selection uncertified | P1 |
| Shared Decision Packet format | `IMPLEMENTED BUT UNCERTIFIED` | `ai-context-envelope/schema.ts` | P1 |
| Structured response schemas | `IMPLEMENTED BUT UNCERTIFIED` | `request-validator.ts`, `response-normalizer.ts` | P1 |
| Canonical-data verification | `PARTIAL` | `sports-context-enricher.ts`; verify-after-generate not proven for all callers | **Phase 1** (no-fabrication invariant I3) |
| Conflict-resolution policy | `IMPLEMENTED BUT UNCERTIFIED` | `quality-gate.ts` | P1 |
| Confidence calculation | `IMPLEMENTED BUT UNCERTIFIED` | Decision OS confidence + `quality-gate.ts` | P1 |
| Timeout / retry / fallback | `PARTIAL` | `fallback-policy.ts`, `error-handler.ts`; timeouts uncertified | P1 |
| **Circuit breaker** | `MISSING` | none in `lib/ai-orchestration*`; only `provider-health-check.ts` | P1 (shares P0-2 gateway) |
| Cost / token budgets | `PARTIAL` | `TokenSpendService.ts`; charge-before-completion is a known deferred hazard | P1 |
| Data minimization / redaction | `PARTIAL` | `AIContextEnvelopeBuilder.ts`; redaction coverage uncertified | P1 |
| Model/version/provenance tracking | `IMPLEMENTED BUT UNCERTIFIED` | `tracing.ts` | P1 |
| Stored results + invalidation | `IMPLEMENTED BUT UNCERTIFIED` | `EngineSnapshot`, AI snapshot models | P1 |
| Tests: malformed/stale/fabricated/conflicting/unavailable | `PARTIAL` | `__tests__/ai/{providerErrors,providerRouter,aiCache}.test.ts` exist; not exhaustive | P1 |
| **No AI call blocks a critical page render** | `UNCERTIFIED — must trace` | `app/{ai,trade-evaluator,waiver-ai}/page.tsx` reference AI symbols; blocking-vs-client not proven | **Phase 1** (Rule 2) |

**Governance coverage (measured):** `app/api/ai*` route files = **70**; route files importing the
orchestrator = **12** (~17%). ~58 AI routes call models **outside** the governed gateway — the
`chimmy-reasoning-divergence` finding, confirmed on this branch. **Phase-1 concern** is narrower than
"govern everything": beta surfaces must not (a) call AI on a critical render path, or (b) present a
fabricated/unverified AI fact. Full orchestration governance of all 70 routes is **P1 post-beta**.

**Target architecture status:** every named stage exists in code
(`stored data → Decision Packet (ai-context-envelope) → Orchestrator (orchestration-service) → model
→ schema validation (request/response validators) → canonical verify (sports-context-enricher) →
confidence/conflict (quality-gate) → stored result → consumers`), but the pipeline is **not the
mandatory path** for most callers. Making it mandatory is the P1 work.

---

## 19. Added workstream — B2B-OS (future roadmap, P2/P3)

**Status: `OUT OF PHASE 1 SCOPE` — future option, not a beta dependency.** No B2B multi-tenant,
partner-isolation, or partner-write code was found in the index (searched `partner`, `tenant`,
`white-label` — only creator-league and world-cup partner strings exist, unrelated). This is a
**net-new program**, recorded here so it is planned, not started.

**Program: license Commissioner OS to fantasy-platform partners.** Sequenced read/advisory-first,
partner-write later.

| B2B-OS capability | Priority | Note |
|---|---|---|
| Multi-tenant partner isolation | P2 | Foundational; hard isolation before any partner data |
| Partner identity mapping | P2 | Map partner leagues/managers to canonical identity (reuses F1 identity model) |
| Capability registry | P2 | Per-partner explicit capabilities; default deny |
| Read/advisory integration | P2 | **First** integration mode — no writes |
| League Health Score | P2 | Reuse Commissioner OS health engine |
| At-risk league/manager detection | P2 | Reuse Decision OS signals |
| Commissioner intervention recommendations | P2 | Advisory output |
| Intervention→outcome measurement | P2 | Requires outcome capture |
| Retention reporting | P2 | Partner-facing analytics |
| Partner admin console | P2 | Auditable commands |
| Controlled partner **write** adapters | **P3** | Official integration + delegated auth + explicit capability + human confirm + idempotency + verification + audit |
| White-label / embedded / API-SDK delivery | P3 | Delivery options |
| Partner feature/model controls | P3 | Per-partner model + feature flags |
| Kill switches / metering / quotas / SLA reporting | P3 | Operational controls |

**Hard rules to preserve (recorded now so a later build cannot forget them):**
- The **partner remains the system of record**. Ordinary imported leagues stay read-only (invariant I1).
- Any write requires: official partner integration, delegated authorization, explicit capabilities,
  human confirmation where appropriate, idempotency, verification, and an audit record.
- AllFantasy may use partner outcomes to improve general intelligence **only when contractually
  authorized and aggregated/de-identified.** Record raw-data ownership, derived-data rights,
  model-provider retention restrictions, deletion requirements, and partner-specific-vs-cross-partner
  learning boundaries.
- **Not a Phase-1 dependency.** Preserve as a later option unless a signed pilot + sandbox access
  justify parallel development.

---

## 14. Verification performed & limitations

**Run (safe, non-destructive):**
- `git ls-files` / `git grep` enumeration of routes, models, adapters, tests (index-based; immune to
  the `.next-*` ripgrep timeout).
- Schema read (`prisma/schema.prisma`, 16,490 lines) for model presence.
- Route-budget parse: **2009 / 2048, headroom 39** (authoritative method; the legacy counter's 1733
  is ~276 low and not used).
- `prisma validate` → **"The schema at prisma\schema.prisma is valid 🚀"** (schema syntax only, no DB
  connection made).

**Not run (documented limitation):** the full 1,503-file unit suite and 167 e2e specs were **not**
executed in this audit — cost and the known vitest worker-spawn flakiness in this tree make a full
run unreliable as evidence. This branch's own attribution suites (121 unit + 11 browser) are green
from earlier in the program. **Local green ≠ production certification** — that is P1-1 (A3), blocked
on an admin session.

**Distinctions held throughout:** documented-vs-implemented (e.g. `docs/import/` empty on this
branch); mock/demo-vs-production (adapters are real code, live coverage uncertified); local-vs-prod.

---

## 15. Blocked items & exactly what unblocks them

| Blocked | Blocker | Evidence needed to unblock |
|---|---|---|
| P1-1 production certification (A3) | No authorized admin session | A genuine admin session (founder-provided/operated); then desktop+mobile `/admin` + `/dashboard` walk, DB rows, deployed SHA |
| P0-4 provider live coverage | External provider access | Live/sandbox accounts per provider (ESPN/Yahoo/MFL/Fleaflicker), or founder confirmation of which are in-beta |
| Provider quota/cost assumptions | Not in repo | Founder/provider confirmation of quotas + pricing (marked "requires external confirmation" everywhere) |
| Provider outage status (RollingInsights/ClearSports) | Vendor-side | Founder vendor contact (per prior audit) |

---

## 16. Change log
- **2026-07-24 (2)** — added three workstreams from static inspection on `d00642247`, no code changed:
  **TRADE-OS** (§17 — deterministic engine `lib/decision-os/trade/*` + `lib/trade-finder/*` present;
  three-tier counter packages, recipient-edge, and multi-team certified as `PARTIAL`/`MISSING`),
  **MULTI-MODEL-OS** (§18 — OpenAI/Grok/DeepSeek all really integrated; **70 AI routes, 12 governed
  (~17%)**; **no circuit breaker**), **B2B-OS** (§19 — net-new P2/P3 future, no code exists, not a beta
  dependency). Updated scorecard (§2), tracker (P1-7, P1-8, P2-B2B, P3-B2B), dependency map (§10),
  test matrix (§9), and added an explicit execution sequence (§12b). **P0-1 BETA-GATE unchanged as
  first** — new evidence does not contradict it.
- **2026-07-24** — initial Phase-1 closed-beta audit + P0–P3 tracker created from static repository
  inspection on `d00642247`. No implementation performed. Companion to
  `docs/AF_LAUNCH_PROGRAM_PLAN.md` (this audit populates its Section B detail).
