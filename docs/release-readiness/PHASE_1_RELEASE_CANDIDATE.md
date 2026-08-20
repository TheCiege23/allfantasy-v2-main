# AllFantasy — Phase 1 Release Candidate (Reconciliation + S1/S2 Blocker Closure)

**Branch:** `release/closed-beta-v1` (cut from `origin/main` @ `8c6947a97`). **Scope:** lean launch-readiness (founder-approved) — reconciliation + S1/S2 blocker closure. Steps 5–9 (agent platform, Decision Queue, League-Health engine, Chimmy/Dashboard rework) **deferred to their own designed phases** as net-new subsystems outside the frozen launch scope. No merges to `main`, no migrations applied, no credential rotation, no deploy, no push (branch is local pending go-ahead + secret scan).

---

## 1. Release merge order (verified; NOT merged)

`origin/main` reconfirmed at `8c6947a97`. All four launch-critical PRs merge **cleanly against current `main`**; the only inter-PR collision is #339↔#347 on three route-budget files.

| Order | PR | Purpose | Migration | Conflict handling |
|---|---|---|---|---|
| 1 | **#339** | governed attribution + **closed-beta invite gate** | `beta_invite_account_admission` (additive; through the migration gate) | clean vs main; rebase onto `8c6947a9` |
| 2 | **#337** | shadow-league Write Authority (imported read-only) | none | disjoint |
| 3 | **#336** | import certification (provider truth) | none | disjoint |
| 4 | **#347** | DB-first Sleeper refresh | none | **union-resolve** `scripts/vercel-next-build.cjs`, `scripts/route-budget-count.mjs`, `__tests__/route-budget.test.ts` against #339's additions |

**Rollback point:** `8c6947a97`. **Excluded** (deferred/obsolete): Fantasy OS #192–220, draft-room #33–50, redraft chain, world-cup #19/#69/#71/#73, V3 landing #276, Decision OS #351, #271 (DO NOT MERGE), #315 (does not build).

---

## 2. What Phase 1 changed on this branch (code, tested)

### Step 4 / B3 — Pricing truth: checkout now uses server-side Stripe Checkout Sessions
- **New:** `lib/monetization/StripeCheckoutSession.ts` → `buildStripeCheckoutSessionForSku()`. The Session's `line_items` price is the catalog-resolved Stripe **price id** (`getMonetizationStripePriceIdForSku` → `STRIPE_PRICE_AF_*`), so **the charge is structurally equal to the displayed catalog `amountUsd`** — the display-vs-charge drift class is eliminated (the amount no longer lives in an out-of-repo Payment Link).
- Sets both `client_reference_id` (`af1_…` payload) **and** `metadata.{userId,sku,purchaseType,couponCode}` — the webhook (`resolveCheckoutContext`/`resolveCheckoutPurchaseType`) already reads either, so fulfillment is unchanged. `mode` = `subscription`/`payment` from the catalog interval; `subscription_data.metadata` carried for invoice webhooks; `allow_promotion_codes: true`.
- **Wired:** `app/api/monetization/checkout/subscription/route.ts` and `.../tokens/route.ts` now call the Session builder (coupon validation, pending-redemption, and Meta events preserved). Fails soft → 503 if a price-id env var is unset (same graceful degradation as before).
- **Test:** `__tests__/monetization-checkout-session-builder.test.ts` (3 passing) — asserts the line item is the catalog price id, ids/metadata are webhook-compatible, and it fails soft with no Stripe call when the price env is missing.
- **Behavior delta to note:** sponsor-coupon **auto-prefill** (old `prefilled_promo_code`) becomes customer-entered (`allow_promotion_codes`); discount + redemption tracking preserved. **Env dependency:** `STRIPE_PRICE_AF_*` (price ids) must be set in Vercel; `STRIPE_CHECKOUT_LINK_AF_*` payment links are no longer used by these routes.

### Step 3 — Canonical launch truth
- **New:** `lib/launch/launchTruth.ts` — one import surface aggregating the existing single sources (no duplication): platforms **derived** from `provider-ui-config.ts`, pricing **re-exported** from `catalog.ts`, plus canonical `LAUNCH_SPORTS` (NFL/NCAAF), `LAUNCH_CONTEXTS`, `LAUNCH_THEMES`, `LAUNCH_LANGUAGES`, `IMPORTED_LEAGUE_POLICY` (read-only/no-writeback), `LAUNCH_FEATURES`.
- **Test:** `__tests__/launch/launch-truth.test.ts` (5 passing) — fails if platforms drift from provider config or pricing drifts from the catalog.

### B9 — Truthful token claim
- `lib/monetization/planIncludes.ts` Supreme bullet corrected **1,500/18,000 → 1,000/15,000** to match the catalog + what the webhook actually grants.

### B1 — Real account erasure (was a stub behind a live button)
- `app/api/user/delete/route.ts` rewritten: requires `{ confirm: true }`; in a transaction revokes auth (delete `AuthAccount`, email-verify + password-reset tokens, null `passwordHash`) and scrubs PII (`email`/`username` → anonymized unrecoverable, `displayName`/`avatarUrl`/`emailVerified` → null). **Migration-free**, idempotent, preserves referential integrity.
- `app/settings/SettingsFullPage.tsx` sends `{confirm:true}` and signs the user out on success.
- **Test:** `__tests__/user-delete-route.test.ts` (3 passing) — 401 unauth / 400 unconfirmed / erasure verified.
- **Known limits (documented, follow-up):** JWT sessions can't be server-revoked without a denylist (login is blocked immediately regardless); full hard-delete/cascade needs a schema+FK audit; a persisted deletion-audit row needs a model (migration).

**Total new/changed tests: 11 passing.**

---

## 3. B2 — GitHub secret-hardening runbook (owner action; NOT executed)

The exposed DB credential is contained (Phase 3A.3S1–S4), but the repo is still exposed:
1. **Enable secret scanning + push protection** (repo currently `disabled`): GitHub → repo **Settings → Code security** → enable *Secret scanning*, *Push protection*, and *Dependabot alerts*. (Requires repo admin; cannot be enabled via the API without admin scope.)
2. **Purge the leaking objects:** open a GitHub Support request to purge commit `a11139ef4` and its cached blobs (`.claude/settings.local.json` + the `.tmp` sibling). Deleting the branch did not remove the objects; they remain retrievable by SHA until GitHub purges them.
3. **Prevent recurrence:** wire `scripts/secret-scan.mjs` into a pre-push hook + CI check; confirm `.claude/settings.local.json` and `.env*` (non-example) stay gitignored.
4. **Vercel Preview re-sync:** the 79 rotated `preview/pr-*` Neon branches have stale Vercel preview `DATABASE_URL`s — re-sync on next preview deploy via the Neon-Vercel integration (non-production).

---

## 4. Step 10 — Mobile audit + targeted fix list (implementation slice, not yet applied)

Primitives are present (`viewportFit:cover`, responsive nav, 891 files use breakpoints, PWA behind a flag) but the journey isn't certified and there are **five competing mobile-nav components** (`MobileNav`, `BottomNav`, `BottomTabBar`, `MobileNavDrawer`, `MobileNavigationDrawer`). Concrete launch fixes, in order:
1. Choose **one** canonical mobile shell for beta routes; retire the others from beta paths.
2. `safe-area-inset` + 44×44px touch targets on: `/`, `/signup`, `/login`, `/dashboard`, league selector, `/league/[id]` Team + Commissioner tabs, roster, `/import`, Chimmy entry, settings.
3. No horizontal overflow; keyboard-safe forms; ~30% lower dashboard density on mobile.
4. Add Playwright mobile-viewport (320/375–479px) specs for the journey — see §5.

(These are UI changes across many components; deferred to a focused mobile slice rather than partially applied here.)

---

## 5. Step 11 — Release-candidate certification test matrix

Legend: ✅ covered · 🟡 partial/needs cert · 🔴 gap. "New" = added this phase.

| Surface | Certification test | Status |
|---|---|---|
| Landing | render + signed-in redirect (`app/page.tsx`) | 🟡 |
| Signup | register creates one account; invite gate (after #339) | 🟡 |
| OAuth | per-provider sign-in walk (env-gated) | 🟡 (env) |
| Import (Sleeper) | `/import` → native `League` (after B5 canonical path) | 🔴 |
| Import (ESPN/Yahoo) | cookie/OAuth → commit | 🟡 |
| Persistence | idempotent `ImportRun`; repeat-login no reimport | ✅ (unit) |
| Dashboard | DB-first, zero provider call on render | ✅ (unit) |
| Decision Queue | (deferred subsystem) | n/a this phase |
| Commissioner OS | health engine + dual-role | 🟡 |
| League Health | (deferred expansion) | n/a this phase |
| **Stripe pricing** | **charge == catalog price** | ✅ **New** (`monetization-checkout-session-builder`) |
| Tokens | idempotent credit on webhook | ✅ (existing) |
| **Launch truth** | platforms/pricing single-source | ✅ **New** (`launch-truth`) |
| **Data deletion** | confirmed erasure + auth revoke | ✅ **New** (`user-delete-route`) |
| Notifications | placeholder off in prod; real delivery | 🔴 (B8) |
| Mobile | journey at 320–479px | 🔴 (§4) |

**RC exit gate:** the ✅ rows plus B5 (canonical Sleeper import), B8 (placeholder off), and the founder's A3 admin-session walk. Full journey e2e + mobile specs are the next implementation slice.

---

## 6. Remaining blockers (updated)

| ID | Sev | Status |
|---|---|---|
| B1 data deletion | S1 | **CLOSED (code + tests)** — needs deploy + live verification |
| B2 secret hardening | S1 | **OPEN — owner action** (runbook §3) |
| B3 pricing charge | S2 | **CLOSED at code level** — now catalog-derived; requires `STRIPE_PRICE_AF_*` set in Vercel + one test-mode charge to confirm |
| B4 beta gate on main | S2 | **PENDING MERGE** (#339 in the release order) |
| B5 `/import` Sleeper canonical | S2 | **OPEN** — next code slice |
| B6 imports→Decision OS | S2 | OPEN (deferred wiring) |
| B7 auto-select league | S3 | OPEN |
| B8 notification placeholder | S3 | OPEN (XS) |
| B9 token claim | S3 | **CLOSED** |
| B10 Write Authority on main | S3 | **PENDING MERGE** (#337) |

---

## 7. Updated completion % (evidence-based estimates, not coverage)

| Area | Phase 0 | Phase 1 | Note |
|---|---|---|---|
| Overall | ~60% | **~66%** | pricing/deletion/launch-truth closed at code level |
| Customer journey | ~80% | ~80% | unchanged (B5 import path still open) |
| Decision OS | ~40% | ~40% | deferred |
| Commissioner OS | ~55% | ~55% | unchanged |
| **Agent platform** | n/a | **0% (intentionally deferred)** | not built per lean scope |
| Payments | ~75% | **~88%** | charge now catalog-derived + tested; token claim fixed |
| Operations | ~55% | ~58% | deletion built; placeholder + monitoring pending |
| Security | ~55% | ~62% | credential contained; scanning/purge still owner-action |

---

## 8. Updated launch estimate

**August 21, 2026: `ACHIEVABLE WITH SCOPE REDUCTION`** (unchanged, now better-supported). Pricing and deletion — the two hardest revenue/legal blockers — are closed at code level this phase. Remaining critical path for a Sleeper-only NFL closed beta: merge #339/#337/#336/#347, set `STRIPE_PRICE_AF_*` + confirm one test-mode charge, B5 canonical Sleeper import, B8 placeholder off, enable secret scanning + request purge, and the A3 admin-session walk.

---

## 9. Next phase & prompt

**Phase 2 — RC Merge & Import-Path Closure.** Merge the release order into `release/closed-beta-v1` (with the founder present for each production-affecting step), close B5 (canonical `/import` Sleeper), B8 (placeholder), and produce webhook-confirmed pricing evidence.

```
Proceed with RELEASE READINESS PHASE 2 — RC Merge & Import-Path Closure on release/closed-beta-v1.
Read docs/release-readiness/PHASE_1_RELEASE_CANDIDATE.md; independently verify origin/main is still 8c6947a97 (else STOP).
Authorized: work only on release/closed-beta-v1 (no main merges, no prod deploy, no migrations applied, no rotation).
1. Execute the §1 merge order with real merges INTO release/closed-beta-v1 (not main): #339→#337→#336→#347, union-resolving the route-budget files; report every conflict resolution. Do NOT push.
2. B5: route the /import Sleeper tab to the canonical discover→preview→commit pipeline (native League), with an e2e test; keep the AF-Legacy career path separate and clearly labeled.
3. B8: env-guard lib/notifications/placeholder.ts off in production.
4. Pricing: produce the exact owner steps to set STRIPE_PRICE_AF_* in Vercel and to run ONE Stripe test-mode charge proving charged == catalog amount (no live charges).
Stop after a report + the merged release branch (local) + updated docs. Do not enable anything, deploy, or begin Phase 3.
```
