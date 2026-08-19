# AllFantasy — Phase 0 Release Baseline (Security Closure, Scope Freeze, Branch Reconciliation)

**Date:** 2026-08-02 · **Method:** read-only static inspection (git index, `gh`, Neon control-plane, 6 parallel code audits). No production writes, no PR changes, no migrations, no credential rotation performed in this phase.
**Repository:** `TheCiege23/allfantasy-v2-main` (PUBLIC) · **Default branch:** `main`

> **Evidence basis.** Everything below is cited to files/routes/PRs/commits or explicitly marked as *not accessible*. Where a subsystem differs between the checked-out branch-of-record and `origin/main`, both are stated — this matters because **neither is a superset of the other**.

---

## 1. Executive verdict

AllFantasy is a **large, mostly-built platform whose launch gap is certification and reconciliation, not construction.** The core funnel (signup → Sleeper import → DB-first dashboard → Chimmy → Stripe) exists and largely works in code. The blockers are: (a) a **live pricing display-vs-charge drift** that can charge old prices, (b) a **stubbed data-deletion endpoint behind a live button** (GDPR/CCPA exposure), (c) the **exposed historical Neon credential is contained but GitHub still serves the leaking commit** and **secret scanning/push-protection are disabled**, (d) **production `main` and the branch-of-record have diverged** so launch work must start from a reconciled branch, and (e) several journey surfaces are **functional-but-uncertified** (ESPN/Yahoo import, OAuth providers, notifications) or **dormant** (Decision OS on the dashboard; durable sync shipped OFF).

**August 21, 2026: `ACHIEVABLE WITH SCOPE REDUCTION`** — a Sleeper-only, NFL-first, closed-beta launch with verified pricing and real data-deletion is realistic; the full 3-provider / 2-sport / 3-context revenue launch is `HIGH RISK` on that date.

---

## 2. Authoritative repository & production baseline (Task 1)

| Fact | Value | Evidence |
|---|---|---|
| Default branch | `main` | `gh repo view` |
| Visibility | **PUBLIC** | `gh repo view` |
| `main` HEAD | **`8c6947a97`** (merge of PR #349, Decision OS three-brain Phase 0) | `git rev-parse origin/main` |
| Checked-out branch | `feat/launch-phase0-truth-attribution` @ `245bb53c9` | `git rev-parse HEAD` |
| Branch vs `origin/main` | **17 ahead / 8 behind** | `git rev-list --left-right --count` |
| Uncommitted local changes | 4: `M tsconfig.json`, `?? AGENTS.md`, `?? docs/AF_LAUNCH_PROGRAM_PLAN.md`, `?? docs/PHASE1_CLOSED_BETA_AUDIT.md` | `git status --porcelain` |
| Branch protection (`main`) | Required check **"Draft Room Regression"**, strict; (per memory) 1 approving review required and sole collaborator is the PR author | `gh api .../branches/main/protection` |
| Production deployment SHA | **NOT DIRECTLY VERIFIABLE** — Vercel access unavailable this phase. `main` auto-deploys to Vercel, so prod is *presumed* `8c6947a97`. The founder docs' "prod = `e61a63886`" is **stale** (pre-#345/#349). | Vercel not accessible |
| Does `main` == production? | Presumed yes (Vercel auto-deploy of `main`); unconfirmed | inference |
| Auto-migration on deploy? | **NO on the Vercel path** — `vercel-build` = `node scripts/vercel-next-build.cjs` (no migrate). A separate `build:vercel` script *does* run `db:migrate:deploy && vercel-build`; **confirm Vercel is configured to use `vercel-build`, not `build:vercel`.** | `package.json` scripts |
| Route budget | Managed near the **2048** Vercel ceiling (last measured 2009/2048, headroom ~39); build script actively excludes dev/lab routes to stay under | `scripts/vercel-next-build.cjs`; `PHASE1_CLOSED_BETA_AUDIT §14` |

**Branch divergence that drives the whole strategy:**
- `origin/main` **HAS**: pricing catalog + payment-link registry, durable Sleeper sync engine (PR #345, OFF by flag), Decision OS Phase-0 audit (#349).
- `origin/main` **LACKS**: closed-beta invite gate (`lib/beta-invite/betaAdmissionService.ts` **absent**), governed attribution/funnel (PR #339), centralized shadow-league Write Authority (#337 **absent**), import certification (#336), async resync + drain cron (#347).
- Branch-of-record `feat/launch-phase0-truth-attribution` **HAS** the beta gate + attribution but is **8 behind main** (missing #345 sync + #349).

---

## 3. Open PR classification (Task 2) — 86 open PRs

Full metadata captured via `gh pr list`. Classified below; large stacked chains are grouped.

| PR(s) | Purpose | Base | State | Classification |
|---|---|---|---|---|
| **#339** | Launch Phase 0: truthful deployment identity + governed attribution + **closed-beta gate** | main | Draft, MERGEABLE | **REQUIRES REVIEW** (branch-of-record; needs rebase onto `main` @ 8c6947a9) |
| **#351** | Decision OS canonical contract + shadow persistence | main | Draft | **SECURITY FOLLOW-UP / BLOCKED** (paused; canonical dormant; migration not applied — keep unmerged) |
| **#337** | Shadow-league centralized Write Authority (imported read-only enforcement) | main | Draft, MERGEABLE | **MERGE CANDIDATE** (launch-relevant; absent on main) |
| **#336** | Import certification — provider truth + safety | main | MERGEABLE | **MERGE CANDIDATE** (import truth) |
| **#347** | DB-first background Sleeper current-state refresh (async job + drain cron) | main | MERGEABLE | **REQUIRES REVIEW** (files absent on main; import freshness) |
| **#348** | Safe source-platform deep links for imported leagues | #347 | Draft | **DEFER / REQUIRES REBASE** (stacked on #347) |
| **#338 / #285** | Pricing single-source (catalog.ts) / price-drift fix | main | MERGEABLE | **REVIEW / likely OBSOLETE** (catalog + registry already present on `main`; verify then likely close) |
| **#308** | Commissioner HQ on League Command Center | main | MERGEABLE | **REQUIRES REVIEW** |
| **#306** | Anonymous ESPN guest import end-to-end | main | MERGEABLE | **REQUIRES REVIEW** |
| **#282** | Per-admin API tokens (bearer identity) | main | MERGEABLE | **SECURITY FOLLOW-UP** (review then merge) |
| **#281 / #279** | CI security unit tests / admin-boundary guard | main | MERGEABLE | **SECURITY FOLLOW-UP** |
| **#278** | Rate-limit degenerate-bucket fix (14 limits → 1 global) | main | CONFLICTING | **SECURITY FOLLOW-UP / REQUIRES REBASE** |
| **#243** | DB-guards: correct inverted production-host marker | main | CONFLICTING | **SECURITY FOLLOW-UP / REQUIRES REBASE** |
| **#315** | Admin production truth / operator console | main | CONFLICTING | **BLOCKED** (memory: pushed tree does not build — do not merge as-is) |
| **#276** | V3 "Fantasy Operating System" landing | main | MERGEABLE | **DEFER UNTIL AFTER LAUNCH** (production landing is Nocturne 1a; V3 unused) |
| **#271** | CI run checks on stacked PRs | main | Draft | **BLOCKED** (title: "[DO NOT MERGE — needs Guap's yes]") |
| **#192–#220** (≈29 PRs) | Fantasy OS Phase 5x suite (sports-data plane, canonical convergence, live lineup/trade/waiver wiring) | stacked on each other | Draft | **DEFER UNTIL AFTER LAUNCH** (Fantasy OS suite; out of launch scope; stacked, not `main`-targeted) |
| **#33–#50** (≈17 PRs) | Draft-room QA / ADP / player-pool chain | stacked | Ready | **DEFER / OBSOLETE** (frozen draft features; stacked; 87d old) |
| **#19, #69, #71, #73** | FIFA World Cup bracket + emergency WC landing | main / bracket | mixed | **OBSOLETE / DEFER** (not NFL/NCAAF launch scope) |
| **#117** | Commissioner OS commercial readiness | main | MERGEABLE | **REQUIRES REVIEW** |
| **#131, #137, #154, #156, #166, #171, #178, #182, #183** | NFL redraft / Decision-OS-signal / playoff / draft-room fixes | main | mixed (several CONFL, #166/#183 Draft) | **DEFER UNTIL AFTER LAUNCH** (redraft is under feature freeze; not the imported-league launch path) |
| **#168, #172, #175, #189** | World-cup cron / e2e-auth / onboarding harness / Node24 bump | main | MERGEABLE | **REQUIRES REVIEW** (#189 Node bump + #175 onboarding are launch-adjacent; #168 WC deferrable) |
| **#291** | af-legacy team-scan sign-in prompt | main | CONFLICTING | **REQUIRES REBASE** |
| **#21, #29, #32, #48, #50, #64, #118** | Older roster-sync / e2e / ADP / RI-passthrough / vitest / railway / landing-overhaul | main | CONFLICTING | **REQUIRES REBASE / OBSOLETE** (mostly superseded) |

**Summary counts (approx):** MERGE CANDIDATE 3 · REQUIRES REVIEW ~9 · REQUIRES REBASE ~10 · SECURITY FOLLOW-UP ~5 · BLOCKED 3 · DEFER-UNTIL-AFTER-LAUNCH ~50 (Fantasy OS + draft-room + redraft + world-cup chains) · OBSOLETE/DUPLICATE ~6.

---

## 4. Security closure (Task 3)

| Security item | Status | Evidence | Required action |
|---|---|---|---|
| Exposed Neon DB credential `395e19543c18` invalidated | **CLOSED** | Prior phases 3A.3S1–S4: swept all 97 endpoints in project `icy-field-51189449`; 97 AUTH_REJECTED, 0 SUCCESS, 0 indeterminate; 81 non-prod branches rotated; interim leaked fps `18cc…`/`163f…` superseded | none (contained) |
| Tracked `.env` (non-example) files | **CLOSED** | `git ls-files` → only `.env.example`, `.env.local.example` tracked | none |
| `.claude/settings.local.json` tracked | **CLOSED** | not in `git ls-files` | keep in `.gitignore` |
| Credential literals in scratchpad/scripts | **CLOSED (session)** | scratchpad scanned — no `npg_` literals; `scripts/secret-scan.mjs` exists | run `secret-scan.mjs` in CI |
| GitHub **secret scanning** | **OPEN** | `security_and_analysis.secret_scanning = disabled` | enable on repo |
| GitHub **push protection** | **OPEN** | `secret_scanning_push_protection = disabled` | enable on repo |
| Commit `a11139ef4` publicly retrievable (the leaking blob) | **OPEN** | `gh api .../commits/a11139ef4` still returns the SHA | GitHub Support object/cache purge |
| Vercel **Preview** deployments may hold stale rotated Neon creds | **UNRESOLVED** | S4 rotated 79 `preview/pr-*` Neon branches; Vercel preview env `DATABASE_URL`s not re-synced; Vercel not inspectable this phase | re-sync via Neon-Vercel integration on next preview deploy; owner to confirm |
| Production Vercel variables unchanged | **NOT ACCESSIBLE** | Vercel CLI/API access unavailable this phase | owner-verify (no changes were made by any phase) |
| Production Neon active & rejects exposed cred | **CLOSED** | control-plane: `ep-curly-block-ad0dlt9o` state `active`; `395e` AUTH_REJECTED on prod | none |
| Auto-deploy applies migrations unexpectedly | **CLOSED (Vercel path)** / **verify config** | `vercel-build` runs no migration; separate `build:vercel` would | confirm Vercel build command = `vercel-build` |

---

## 5. Customer journey readiness (Task 4) — 29 surfaces

Audited against the branch-of-record + `origin/main` where they differ.

| # | Surface | Status | Evidence |
|---|---|---|---|
| 1 | Landing page | **PRODUCTION READY** | `app/page.tsx:18` → Nocturne 1a (`components/landing/nocturne/LandingNocturne`); SEO JSON-LD; signed-in → `/dashboard`. (V3/#276 is NOT the prod route) |
| 2 | Registration (email) | **PRODUCTION READY** | `app/api/auth/register/route.ts` (user at `:537`, geo-block, rate-limit, verification email). On branch it also consumes the beta-admission gate; **on `main` the gate is absent (open signup)** |
| 3 | Login | **PRODUCTION READY** | `lib/auth.ts:171` CredentialsProvider; `resolveUnifiedAuthIdentity`; distinct error codes |
| 4 | Google OAuth | **FUNCTIONAL BUT UNCERTIFIED** | `lib/auth.ts:356` (env-gated on `GOOGLE_CLIENT_ID/SECRET`); prod creds unverifiable from code |
| 5 | Spotify OAuth | **FUNCTIONAL BUT UNCERTIFIED** | `lib/auth.ts:379` env-gated |
| 6 | Discord OAuth | **FUNCTIONAL BUT UNCERTIFIED** | `lib/auth.ts:479` env-gated; separate creds from Discord bot |
| 7 | Password reset | **PRODUCTION READY** | `app/api/auth/password/reset/{request,verify-code,confirm}`; non-enumerating; email+SMS; rate-limited |
| 8 | Import intent preservation | **PRODUCTION READY** | `/import` auth-gated → `/login?callbackUrl=…`; `lib/auth/PostAuthIntentRouter.ts`; guest-trial claim on sign-in |
| 9 | Sleeper import | **PARTIAL** | Canonical `discover→preview→commit` (`/api/leagues/import/*`) exists but `/import` Sleeper tab uses the **legacy career importer** (`/api/legacy/import` → `LegacyLeague`), not the playable-league pipeline |
| 10 | ESPN import | **FUNCTIONAL BUT UNCERTIFIED** | cookie save UI `components/settings/EspnCookieConnection.tsx`; canonical commit; no discovery (paste id); extension dead until `NEXT_PUBLIC_ESPN_EXTENSION_ID` set |
| 11 | Yahoo import | **FUNCTIONAL BUT UNCERTIFIED** | OAuth read-only scope `fspt-r` (`yahoo-auth`/`callback`); tokens encrypted; historical backfill wired; uncertified |
| 12 | Import persistence | **PRODUCTION READY** | `importPersistenceService.ts` → `League/Roster/LeagueSeason/…`; idempotent `ImportRun` key `userId:provider:league:season` |
| 13 | Background refresh / durable sync | **FUNCTIONAL BUT UNCERTIFIED — shipped OFF** | On `main`: `LeagueSyncState` + `fantasy-os-exec-sync` cron (*/30), read-only, resumable, but gated by `FANTASY_OS_EXEC_SYNC_LIVE` (default off). Manual resync runs the collector live but **synchronously**. Async job + `sleeper-refresh-drain` unmerged (#347). **Absent entirely on the branch-of-record.** |
| 14 | Post-import redirect | **PARTIAL** | Success screen "Open league →" works; "Go to dashboard" drops `leagueId` |
| 15 | Imported-league auto-selection | **PARTIAL** | Dashboard selects `primaryId`/`leagues[0]`; fresh import (`syncStatus:pending`, no `lastSyncedAt`) not auto-highlighted |
| 16 | Dashboard loading | **PRODUCTION READY** | `getDashboardLeagueListForUser` (`lib/dashboard/get-dashboard-league-list.ts:251`) — pure Prisma, DB-first, no provider call on render |
| 17 | Team Focus | **PARTIAL** | Dashboard "Team" tab live; dedicated `manager-hub` route flag-off (`NEXT_PUBLIC_MANAGER_INTELLIGENCE_HUB_ENABLED`) |
| 18 | Commissioner Focus | **PARTIAL; dual-role PRESERVED** | `/commissioner-hub` live; `/commissioner-os` demo (transport unconfigured); commissioner keeps personal Team view |
| 19 | Decision OS surfacing | **PARTIAL (dormant on `/dashboard`)** | Live + honest on league-home (`LeagueTab.tsx:731`) + commissioner-hub; the dashboard intelligence rail ships flag-off and unmounted; imports **do not feed** `decision_os_imported_activity` in prod (sole caller is a non-prod script) |
| 20 | Chimmy league context | **PRODUCTION READY** | `/api/chimmy` requires `leagueId` for trade/waiver/team (`412` if missing); no wrong-league bleed |
| 21 | Stripe checkout (monthly+annual) | **FUNCTIONAL BUT UNCERTIFIED — ⚠ PRICING DRIFT ACTIVE** | Display reads catalog (new prices); charge redirects to `STRIPE_CHECKOUT_LINK_AF_*` payment links; no code reconciles them; `AF_STRIPE_CUTOVER_CHECKLIST.md` says Commissioner/Legacy links still point at OLD prices |
| 22 | Subscription entitlements | **PRODUCTION READY** | `EntitlementResolver.ts:113` DB-derived, webhook-maintained, server-only |
| 23 | Token purchases | **PRODUCTION READY** | webhook `checkout.session.completed` → idempotent grant (`stripe_checkout:{session}:{sku}`) |
| 24 | Cancellation / renewal | **PRODUCTION READY** | Billing Portal + lifecycle webhooks (`subscription.deleted`/`payment_failed` grace/`payment_succeeded` refresh), signature-verified + deduped |
| 25 | No-charge-on-failure | **FUNCTIONAL (per-route, not systemic)** | Tokens charged upfront (`TokenSpendService.ts:643`); major AI routes refund on failure (`feature_execution_failed`); unaudited callers can still charge on failure |
| 26 | Notifications | **FUNCTIONAL BUT UNCERTIFIED** | Multi-channel dispatcher (in-app/email/SMS/push); ⚠ `lib/notifications/placeholder.ts` injects 5 fake notifications on empty — must be off in prod |
| 27 | Mobile support | **PRODUCTION READY (uncertified journey)** | viewport `viewportFit:cover`; responsive nav; 891 files use breakpoints; PWA behind experimental flag; full-journey mobile e2e absent |
| 28 | Data deletion | **PARTIAL — deletion NOT BUILT** | `app/api/user/delete/route.ts:11` returns `{ok:true,stub:true}` (no cascade) behind a live settings button; disconnect (Spotify/Discord) is real |
| 29 | Support + legal + monitoring | **PRODUCTION READY** | `app/{privacy,terms,support}`; support widget → `SUPPORT_NOTIFICATION_EMAILS`; `/api/analytics/track` derives `userId` server-side (client-picks-userId hole FIXED); Sentry wired (no-ops without `SENTRY_DSN`) |

---

## 6. Truthful launch-scope contract (Task 5)

**Launch product (frozen):** Create account → connect Sleeper/ESPN/Yahoo league (read-only) → persistent DB-first dashboard → prioritized manager/commissioner decisions → Chimmy explanation → paid upgrade. **Sports:** NFL, NCAAF. **Contexts:** Global Command Center, Team Focus, Commissioner Focus. **Imported leagues:** read-only, DB-first, persistent, resumable, source-linked, per-user isolated, never written upstream. **Revenue:** Stripe subs (monthly+annual), token purchases, entitlement activation, cancellation/renewal, no token charge on failed work.
**Deferred (must not expand this launch):** AF-native league hosting, autonomous agents, 7-sport parity, social network, agent marketplace, devy system, reputation/reviews, native draft rooms for every format, B2B data products, AF Legacy (F1–H2), Fantasy OS Phase 5x suite.

**Claims to remove or qualify before launch:**
| Claim | Location | Issue | Action |
|---|---|---|---|
| Supreme "1,500 monthly / 18,000 yearly tokens" | `lib/monetization/planIncludes.ts:38` | Catalog + spotlight corrected to **1,000 / 15,000**; this over-promises | **Fix** to 1,000/15,000 |
| Displayed subscription prices | pricing pages via `catalog.ts` | Not reconciled with the amount the payment link actually charges | **Qualify/verify** — confirm every `STRIPE_CHECKOUT_LINK_AF_*` charges the catalog price |
| "…edges **across every supported sport**" | `lib/monetization/planIncludes.ts:10` | Could imply >NFL/NCAAF | **Qualify** to launch sports |
| Fantrax/MFL/Fleaflicker as usable | import UI | Correctly marked "coming soon" (`available:false`) — **OK, keep gated** | none |
| Autonomous-agent / live-scoring / "unlimited" | — | **Not claimed** in copy (catalog forbids surfacing "AI"/"war_room") — **OK** | none |
| External write-back / commissioner upstream actions | — | **Not claimed**; FanCred boundary disclosed | none |

---

## 7. Ranked blocker register (Task 6)

| ID | Sev | Blocker | Journey | Evidence | Root cause | Fix | Test to close | Size |
|---|---|---|---|---|---|---|---|---|
| B1 | **S1** | Data-deletion endpoint is a stub behind a live "delete account" button | Data deletion / legal | `app/api/user/delete/route.ts:11` `{stub:true}` | never implemented cascade | Real cascade delete or remove the button + honest "email us" | e2e: delete → rows gone; token invalidated | M |
| B2 | **S1** | GitHub still serves leaking commit `a11139ef4`; secret scanning + push protection OFF | Security | `gh` security_and_analysis all disabled; commit retrievable | repo config + no GH Support purge | Enable secret scanning + push protection; request GH object purge | scanning alert on test secret; purge confirmed 404 | S |
| B3 | **S2** | Pricing display-vs-charge drift — checkout may charge OLD prices | Payments / revenue | `checkout/subscription/route.ts:99` → `STRIPE_CHECKOUT_LINK_AF_*`; `AF_STRIPE_CUTOVER_CHECKLIST.md` (Commissioner/Legacy links = old) | two unreconciled price sources | Regenerate payment links to catalog prices **or** move to server Checkout Sessions from catalog price IDs | webhook confirms charged amount == catalog `amountUsd` | S (config) / M (sessions) |
| B4 | **S2** | Production `main` lacks the closed-beta invite gate (open signup) | Acquisition / beta control | `lib/beta-invite/betaAdmissionService.ts` absent on `main`; present on branch | #339 unmerged | Reconcile #339 into release branch; set `INVITE_ONLY` | invite valid/expired/reused/absent; OAuth-create gated | M (reconcile) |
| B5 | **S2** | `/import` Sleeper tab ships the legacy career importer, not the playable-league pipeline | Import | `LeagueImportFlow.tsx:199` → `/api/legacy/import` | two Sleeper paths | Route `/import` Sleeper to canonical `discover→preview→commit`, or clearly separate "career profile" vs "import league" | e2e: `/import` Sleeper → native `League` row | M |
| B6 | **S2** | Imported activity never reaches Decision OS in prod (decision surfaces starved) | Decisions | sole caller of `ingestSleeperImportedActivity` is a non-prod script | commit path wired to legacy engine only | Invoke the ingestion chain from the import-commit path (behind a flag) | import → `decision_os_imported_activity` rows | M |
| B7 | **S3** | Imported league not auto-selected on dashboard; "Go to dashboard" drops `leagueId` | Post-import | `LegacyImportResults.tsx:121`; `dashboard-league-selection.ts` | missing URL param | Append `?leagueId=` and honor it in selection | e2e: import → dashboard highlights new league | S |
| B8 | **S3** | Notification placeholder injects fake alerts on empty | Notifications / trust | `lib/notifications/placeholder.ts:8` | dev placeholder | Disable in prod (env guard) | empty state renders no fake alerts | XS |
| B9 | **S3** | Supreme token claim mismatch (1,500/18,000 vs 1,000/15,000) | Claims | `planIncludes.ts:38` vs `catalog.ts` | stale copy | Correct the bullet | unit: planIncludes == catalog tokens | XS |
| B10 | **S3** | Centralized imported-league Write Authority absent on `main` | Imported read-only | `lib/league/write-authority.ts` absent; #337 unmerged | not reconciled | Reconcile #337; assert read-only at the gate | negative test: imported mutation refused server-side | M |
| B11 | **S4** | Durable Sleeper sync shipped OFF; async drain unmerged | Data freshness | `FANTASY_OS_EXEC_SYNC_LIVE` off; #347 open | flag + unmerged | Enable flag after load test; reconcile #347 | cron runs; freshness advances; no provider hammering | M |
| B12 | **S4** | OAuth providers unverifiable (env-gated); provider budget/circuit-breaker absent for fantasy providers | Auth / reliability | `SocialProviderResolver.ts`; `PHASE1_CLOSED_BETA_AUDIT §5,P0-2` | prod env + missing gateway | Confirm creds in Vercel; add provider budget/breaker before real traffic | OAuth walk per provider; breaker open/half/closed | M–L |

---

## 8. Recommended release-branch strategy (Task 7)

**Chosen strategy: reconcile selected PRs into a fresh release branch cut from current production.** Rationale: neither `main` nor the branch-of-record is a superset, so neither can be shipped as-is; the frozen scope needs a clean, reviewable base.

- **Source SHA (rollback point):** `origin/main` @ **`8c6947a97`** (has pricing catalog + durable sync + #349; is the presumed live SHA).
- **Proposed branch:** `release/closed-beta-v1` (cut from `8c6947a97`).
- **Merge order (launch-critical only):**
  1. **#339** governed attribution + **closed-beta gate** (rebased onto `8c6947a9`) — foundational; enables invite control.
  2. **#337** shadow-league Write Authority — imported read-only enforcement (B10).
  3. **#336** import certification — provider truth/safety (B5 support).
  4. **#347** async resync + drain cron — freshness (B11).
  5. Security: **#282** (admin token identity), **#279/#281** (guard + CI security tests), then rebase **#278** (rate-limit), **#243** (db-guard inversion).
  6. Verify pricing catalog already present (from `main`); **do not** re-merge #285/#338 unless a diff proves missing content.
- **PRs excluded from the release branch:** Fantasy OS #192–220, draft-room #33–50, redraft #131/#137/#154/#156/#166/#171/#178/#182/#183, world-cup #19/#69/#71/#73, V3 landing #276, Decision OS canonical #351, #271 (DO NOT MERGE), #315 (does not build).
- **Migration order:** only additive migrations, each through the separate migration gate — beta-invite (`20260724…`), `league_sync_state` (already on `main`), import-cert additions. **No `prisma migrate deploy` on prod without the gate; confirm Vercel build = `vercel-build` (non-migrating).**
- **Env prerequisites:** `INVITE_ONLY`; OAuth `*_CLIENT_ID/SECRET`; `RESEND_API_KEY`/`RESEND_FROM`; regenerated `STRIPE_CHECKOUT_LINK_AF_*`; `FANTASY_OS_EXEC_SYNC_LIVE` (only after load test); `SENTRY_DSN`; Twilio/VAPID as needed; notification placeholder disabled.
- **Release freeze rules:** only launch-scope surfaces + the S1–S3 blocker fixes; no new features; no schema change without the migration gate; route budget must stay < 2048.

---

## 9. Launch test matrix (Task 8)

Legend for **Current status**: ✅ ready · 🟡 functional-uncertified · 🟠 partial · 🔴 broken/not-built.

| # | Journey | Prereqs | Test account | Expected | DB evidence | Analytics event | Cleanup | Current |
|---|---|---|---|---|---|---|---|---|
| 1 | Email signup → Sleeper import → dashboard | invite (if on), `.env.test` | new email | league persists, dashboard shows it | `AppUser`, `League`, `ImportRun` | `signup_completed`, `import_completed` | delete test user | 🟠 (import via wizard, not `/import`) |
| 2 | Google signup → Sleeper import → dashboard | Google creds set | Google test | as #1 via OAuth | `AppUser`+`authAccount` | `signup_completed` | delete | 🟡 |
| 3 | Existing login → saved dashboard | seeded user | returning | dashboard from DB, no provider call | read-only | `returning_authenticated` | none | ✅ |
| 4 | ESPN import | SWID+espn_s2 | ESPN cookie | league persists | `League`, `LeagueAuth` | `import_completed` | delete | 🟡 |
| 5 | Yahoo import | Yahoo OAuth | Yahoo | league persists | `League`, `LeagueAuth` | `import_completed` | delete | 🟡 |
| 6 | Commissioner import | commissioner league | commish | full-league import allowed | `League`+commish role | — | delete | 🟡 |
| 7 | Non-commissioner blocked from full import | member-only league | member | refused server-side | no full `League` | — | none | 🟡 (gate exists; not certified) |
| 8 | Returning user sees saved data immediately | seeded | returning | DB-first render, no provider fetch | read-only | — | none | ✅ |
| 9 | Background refresh doesn't erase prior state | sync flag on | seeded | freshness advances, no data loss | `LeagueSyncState` checkpoints | — | reset flag | 🟡 (off by default) |
| 10 | Imported league auto-selected | fresh import | new | new league is active context | selection state | — | delete | 🟠 |
| 11 | Stripe monthly purchase | Stripe test | payer | entitlement active; charged catalog price | `userSubscription` | `paid_conversion_confirmed` | cancel | 🟡 (⚠ verify price) |
| 12 | Stripe annual purchase | Stripe test | payer | as #11 annual | `userSubscription` | `paid_conversion_confirmed` | cancel | 🟡 (⚠ verify price) |
| 13 | Token purchase | Stripe test | payer | tokens credited once | `TokenLedger` | — | none | ✅ |
| 14 | Failed premium action doesn't charge tokens | premium route | subscriber | balance unchanged on failure | ledger refund row | — | none | 🟡 (per-route) |
| 15 | Cancellation changes entitlement | active sub | subscriber | entitlement → expired at period end | `userSubscription` | — | none | ✅ |
| 16 | Chimmy uses selected-league context | imported league | user | answer grounded in that league; `412` if missing | — | — | none | ✅ |
| 17 | Decision queue links to correct source platform | imported league | user | deep link to Sleeper/ESPN/Yahoo | — | — | none | 🟠 (#348 unmerged) |
| 18 | Mobile registration + import | mobile viewport | new | no overflow; import completes | as #1 | — | delete | 🟡 |
| 19 | Account disconnect | linked provider | user | tokens nulled, account unlinked | `authAccount` deleted | — | none | ✅ |
| 20 | Data deletion | account | user | data erased, session invalidated | rows gone | — | n/a | 🔴 (stub) |

---

## 10. August 21, 2026 feasibility (Task 9)

**Verdict: `ACHIEVABLE WITH SCOPE REDUCTION`.**

The core revenue funnel exists and mostly works; the gap is certification + a handful of fixes, not construction. But full 3-provider / 2-sport / 3-context parity plus Decision-OS-on-dashboard plus durable sync plus provider budget hardening in ~19 days is `HIGH RISK`.

**Minimum viable launch by Aug 21 (recommended):**
- **Providers:** **Sleeper only** (canonical import path fixed — B5). ESPN/Yahoo listed "connect soon" (they're wired but uncertified).
- **Sports:** **NFL** (NCAAF read-only where data exists).
- **Contexts:** **Team Focus + Commissioner Focus** (both live); Global Command Center as the DB-first landing.
- **Revenue:** subscriptions + tokens with **B3 pricing verified** and **B14 no-charge-on-failure spot-audited**.
- **Must-fix before any invite:** B1 (data deletion), B2 (secret scanning/push-protection + purge request), B3 (pricing), B4 (beta gate reconciled), B8 (notification placeholder off), B9 (token claim).
- **Acceptable to defer:** ESPN/Yahoo certification, durable-sync ON (manual resync suffices for a small beta), Decision-OS-on-dashboard (B6 — league-home already surfaces it), #348 deep links, provider budget/breaker (needed before *scale*, not a tiny closed beta), full mobile-journey e2e.

---

## 11. Exact next phase

**Phase 1 — Release Branch Reconciliation & S1/S2 Blocker Closure.** Objective: cut `release/closed-beta-v1` from `8c6947a97`, reconcile the launch-critical PRs (#339, #337, #336, #347) in order, close blockers B1–B4 (data deletion, GitHub secret hardening + purge, pricing reconciliation, beta gate), and produce webhook-confirmed evidence that displayed price == charged price. Read/verify-heavy; the only production-affecting steps (enabling secret scanning, regenerating Stripe links, applying the beta-invite migration through the gate) each require an explicit founder go-ahead.

---

## 12. Exact next Claude prompt

```
Proceed with RELEASE READINESS PHASE 1 — Release Branch Reconciliation & S1/S2 Blocker Closure. AllFantasy only (TheCiege23/allfantasy-v2-main); Vercel host; Neon project icy-field-51189449.

Read docs/release-readiness/PHASE_0_RELEASE_BASELINE.md as the handoff, but independently verify every SHA, PR state, and file claim before acting.

Authorized this phase (documentation + a NEW release branch only; no production writes, no migrations applied, no PR merges to main, no credential rotation, no Vercel/Neon changes):
1. Create branch release/closed-beta-v1 from origin/main @ 8c6947a97 (verify this is still main HEAD first; if not, STOP and report).
2. Produce an exact, conflict-checked merge plan for #339 → #337 → #336 → #347 (dry-run with git merge-tree; report conflicts per file; DO NOT push merges).
3. Blocker B1: implement a real cascade account-deletion behind app/api/user/delete (or, if scope-risky, replace the live delete button with an honest manual-request flow) — code + unit/e2e tests, on the release branch only.
4. Blocker B3: produce a definitive pricing reconciliation — for every STRIPE_CHECKOUT_LINK_AF_* SKU, state whether the payment link charges the catalog amountUsd; where it can't be proven from code, give exact owner steps to verify in Stripe (no live-mode charges).
5. Blocker B9: fix planIncludes.ts Supreme tokens to 1,000/15,000 with a guard test.
6. Blocker B8: env-guard the notification placeholder off in production.

Do NOT: merge or push to main, apply any migration, rotate credentials, change Vercel/Neon config, enable secret scanning yourself (produce the owner runbook instead), or begin Phase 2. Stop after a report + the release branch + the merge plan.
```

---

## Validation performed (this phase)

**Executed (safe, read-only):** `git status/rev-parse/rev-list/ls-tree/cat-file/show`; `gh repo view`, `gh pr list` (86 PRs), `gh api` branch protection + `security_and_analysis` + commit `a11139ef4`; Neon control-plane endpoint state; 6 parallel read-only code-audit agents; local `.env*` and scratchpad secret scans (no `npg_` literals); package.json build-script inspection.
**Not executed / unavailable:** full unit suite (1,503 files) + 167 e2e (cost + known vitest worker flakiness — pre-existing); TypeScript ratchet (repo-wide `tsc` OOMs per memory — not run); live route-budget recount (cited last measurement 2009/2048); **Vercel dashboard/env/deployment SHA (access unavailable)**; Stripe live-mode (prohibited).
**Pre-existing failures (not new):** main Playwright suite red tree-wide; `/api/ai/providers` route-budget test; world-cup `tsc` items (all documented in `AF_LAUNCH_PROGRAM_PLAN §3`). **No new failures introduced — this phase changed only this document.**

## Files changed
- **Added:** `docs/release-readiness/PHASE_0_RELEASE_BASELINE.md` (this file). No code, config, schema, PR, or production state changed.
