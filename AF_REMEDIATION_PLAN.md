# AllFantasy — Remediation Plan (errors & gaps across in-flight builds)

## ⚠ GROUND TRUTH (Jul 20, from real `gh` + per-SHA) — READ FIRST
- **⚠ MULTI-SESSION HAZARD: sessions read STALE worktree copies of this file.** Before acting on ORDER, verify against the primary-tree HEAD + per-SHA. **Run the land/ship phase in ONE session, serially** — parallel merge/push/rebase/preserve just duplicates work (preservation has now run TWICE). Verify-per-SHA before every step.
- **✅ PRESERVE IS DONE (Jul 20) — do NOT re-run it.** Fragile items ARE saved to `C:\Users\Guap_\af-preservation-2026-07-20\` (175 uncommitted → 138-file tarball; 31/31 stashes). ~10 branches on origin incl. `claude/admin-audit-and-automation-guards`. Only NOT on remote: `release/nfl-redraft-invited-mvp-rc1` (held, redraft freeze) + `safe-deployment-scoring-upgrade` (UNPUSHABLE — committed 1.5GB Next build caches > GitHub 100MB limit; junk, leave it; in local bundle). Do NOT blanket "push all local branches" — conflicts with do-not-push instructions (`nfl-redraft-beta`, g15, 171-commit foundation).
- **`claude/legacy-auth-sweep` HAS a PR — #288** (open, UNSTABLE, stacked on #287). (Earlier "no PR" note was stale.)
- **✅ SHIPPED — #275 MERGED to `main` (`287e67b85`).** Anonymous PII leak + gpt-4o billing vector + cross-league write-IDOR CLOSED on prod (verified by artifact — rankings routes now carry auth guards). First real prod ship.
- **The 16 "CLEAN" PRs are STACKED** — green vs their own base branch, NOT `main`. Only **37 of 87** open PRs target `main`. "Merge CLEAN" is an illusion; stacked PRs can't merge until their bases do. Per-SHA reconcile still needed to map the 37.
- **Merge order (direct-to-main live-hole closers first):** #275 ✅ → **#287** (player-finder IDOR) → **#283** (replaces fail-OPEN inverted prod-guard with fail-closed; re-verify `ep-curly-block` allowlist vs current prod `ep-river/ep-scene/ep-unit`) → #288 (needs `/af-legacy` client coupling) → **#276 landing** (✅ update-branched, MERGEABLE — one command from merge once P0-A set + `Draft Room Regression` green) → **#290 admin panel** (DRAFT — blocker: add `/api/cron/{draft-tick,live-score-tick}` to `filesToKeep` in `scripts/vercel-next-build.cjs` or they 404; then mark ready. NOTE it also introduces `live-score-tick` */2 — confirm wanted. admin-audit was 3 behind main, NOT 50).
- **DROP "merge CLEAN"** — all 16 CLEAN PRs are stacked on feature branches, merging them puts NOTHING on main. Real remaining ship work = resolve the **16 DIRTY** (genuine conflict resolution).
- **⚠ CRITICAL PATH = YOUR two Vercel dashboard actions (no PR, minutes):** (1) **P0-A** — set 4 `STRIPE_CHECKOUT_LINK_AF_*` vars + verify via `checkout-link-mapping` → unblocks #276 merge. (2) **`LEAGUE_CRON_SECRET`=`CRON_SECRET`** → revives 6 ingestion pipelines AND lets #290's crons authenticate.
- **PR numbers below are UNRELIABLE** — they came from build self-reports. Real `gh`: 86 "open", only **59 real**, **27 phantom** (#192–#220, already ancestors of main). The tracked security numbers (#275/#278/#279/#281/#282/#283/#285) do NOT appear in the real open list — merged, closed, or misreported. **Reconcile per-SHA before trusting any merge-by-number plan.** Real mergeable-now (CLEAN): #19, #33–#49; UNSTABLE: #287 #286 #156; BEHIND: #276 (v3 landing); 16 DIRTY (conflicts).
- **LIVE `origin/main` (`e31c5ab16`) imports `LandingNocturne` — V3 is NOT live.** #276 is BEHIND (needs update-branch under `strict:true`).
- **LOSS RISK — ✅ PRESERVED Jul 20 (corrected counts).** Real numbers: **13** local-only branches (not 16 — many had 0 unique commits = already on main), **31** stashes (not 10), **175** uncommitted paths (138 w/ content, 2.8MB real source); `fix/access-tier-and-landing` is ON origin (NOT at-risk). Snapshot: `C:\Users\Guap_\af-preservation-2026-07-20\` (338MB + RESTORE.md) — survives F: failure. **10 branches pushed to origin** (secret-scanned first; public repo) incl. `claude/admin-audit-and-automation-guards` (admin panel — now PR-able). HELD (correctly): `fix/redraft-season-history-sim` + `release/nfl-redraft-invited-mvp-rc1` (redraft freeze), `safe-deployment-scoring-upgrade` (12k node_modules files — DO NOT push to public repo; local `4c9320aa`). Detached HEAD `1c3d755ef` SAFE.
- **Admin panel not showing** = admin-audit branch never pushed. **`claude/legacy-auth-sweep`** is pushed but has NO PR.
- **ORDER: ✅ preserve DONE → reconcile per-SHA (NEXT — determine what's actually LIVE vs open vs orphaned; prompt ready) → ship (update-branch+merge #276, PR→merge admin-audit, merge CLEAN, resolve DIRTY).** Stabilize before more building.



_Compiled Jul 19, 2026. Covers PR #275 (rankings auth), the admin-audit branch, PR #276 (V3 landing), the import-sleeper rate-limit find, and the live Stripe checkout bug. Priorities: P0 = fix now (live/revenue/security), P1 = before/at merge, P2 = fast-follow, P3 = planned workstream._

Legend for where each fix lives: **[Vercel]** host dashboard env/deploy · **[Stripe]** Stripe dashboard · **[CC]** Claude Code (repo code) · **[GitHub]** merge/branch action · **[Decision]** needs your call first.

---

## Round 2 — decisions locked (Jul 19) + new workstreams

- **✅ Legacy auth sweep — DONE IN CODE (PR #288, stacked on #287).** 23 routes migrated onto shared `requireLegacySleeperIdentity` + CI guard (guard caught 3 bugs in itself via neg-control). `POST /api/legacy/session` can only mint a cookie for the caller's own linked username. Scope was 23 (not 24/19). Allowlisted: `email-preferences`, `guest-import`, `import`. 3 dead limiters removed (incl. `trade/feedback` truthiness — **conflicts with #278**). **⚠ MERGE COUPLING — do not ship #288 to prod alone:** it turns `/af-legacy` from "type any username → see their data" into "must have a session," which BREAKS the anonymous Sleeper funnel unless the client routes anon users through `guest-import`/sign-in first. Ship #288 WITH a small `/af-legacy` client-flow change. Also: `requireAuthOrOrigin` rename (28 files) deferred (guard blocks new routes; residual is hygiene). Order: #287 → #288 (+ /af-legacy client change).
- **(superseded) Legacy auth sweep — IN PROGRESS.** Decorative `af_session`/`requireAuthOrOrigin` → routes reading body `sleeper_username` are IDOR-able. Scope corrected to **18 routes** (not 24 — only request-input routes are vulnerable; 12 of 31 derive server-side already). **✅ PR #287** closed player-finder IDOR + gated `players/sync` + capped `limit`. **Foundation pushed:** `requireLegacySleeperIdentity` helper on branch `claude/legacy-auth-sweep` (session-or-guest; `af_guest_session` is a signed JWT = sound). REMAINING: migrate the 18 routes + CI guard (same PR) + retire `requireAuthOrOrigin`. Prompt provided. Brief: `AF_LEGACY_AUTH_SWEEP_BUILD.md`.
- **Nav "Players" → `/my-players`** (interim; restored the dropped `player-portfolio` routes to unbreak it). When `/players` Intelligence Center commits, point nav there with `/my-players` as a sub-view — don't let the two surfaces compete for one slot.
- **P3 follow-ups from the sweep/nav work:** (a) `__tests__/route-budget.test.ts` `FILES_KEPT` under-reports by 13 (didn't track #284's kept crons) — miscounting budget guard, limit still green; (b) `player-values` grounding — INVESTIGATED: it NEVER worked in prod (docs gitignored in the feature's first commit 948b86a0b, Apr 2026); all 7 callers always got `''`. Staged fix (uncommitted): repoint `VALUES_DIR` → `data/player-values`, remove the dead gitignore + `.vercelignore *.txt` hole, README with `.md`-injection guard. Safe to commit but ENABLES only — folder is empty, so `/api/player-values` still returns `[]` until docs are committed. **PENDING DECISION:** commit operator-authored docs / private→runtime fetch (Blob/Edge Config) / deprecate & ground on real data (FantasyCalc). Low priority — decide after the ingestion diagnosis.
- **Ingestion — DIAGNOSED (Jul 20): it's a 401 CONFIG BUG, not a broken cron or a build.** #284 already fixed the 404s (all 14 crons ship). Live blocker: `app/api/cron/_auth.ts` `??`-chain lets a set `LEAGUE_CRON_SECRET` shadow `CRON_SECRET` → the 13 sports-data crons 401 (proof: `waivers` bypasses the helper → 200). **FIX: [Vercel] set `LEAGUE_CRON_SECRET`=`CRON_SECRET` (immediate, no deploy; do NOT unset) + [CC] `_auth.ts` accept-either-secret (durable, prompt provided).** Revives projections/players/scores/injuries/news/standings (~26–80d stale). NUANCE: only `projections` of the 4 empty tables has a cron; **market-values/trending/game-logs have NO cron (never ingested)** → build or honest-null (market value already live via FantasyCalc). So this is a config fix + a small decision, NOT a big build.
- **⚠ Before merging #283:** prod is Neon project `icy-field-51189449` branch `production` (`br-withered-shadow-adur64u9`); the compute `ep-curly-block-ad0dlt9o` that #283's allowlist keys on appears STALE (Neon recreates computes). #283 fails closed → re-verify its allowlist (key on the branch, not the compute) or it blocks legit prod migrations.
- **✅ P3(a) route-budget under-report — covered by PR #286.**
- **/players — COMMIT as v1 foundation.** Honest-first / NFL-first build (real FantasyCalc NFL value + honesty layer), uncommitted. Commit + PR; fix the broken nav link (`/player-values` docs folder → `/players`).
- **✅ #285 price-drift — DONE** (`priceOf()` extracted to `lib/monetization/`, 6 live sites, catalog-amount guard test). Retired the drift class on the LIVE landing.

---

## Decisions — RESOLVED (Jul 19)

- **`insights_generate`: NO CHANGE — premise was wrong.** The six are one handler copy-pasted 6× (identical md5); the shared 3/min protects Postgres (DB-load, not per-feature), so splitting would 4–6× the cap on an UNCALLED surface. **NEW cleanup item (your call — public endpoint change):** the 5 dead dispatcher routes `leagues/:id/{draft-war-room,market-board,team-scan,trade-command-center}` + `*path` catch-all run generic insights and are called by nothing — drop the entries + delete the dupe files; the 2 real features live at top-level routes and work.
- **Bearer identity: PER-ADMIN TOKENS** → build brief `AF_ADMIN_TOKENS_BUILD.md` (two-phase; ADMIN_PASSWORD stays as a fallback through phase 1).
- **Stripe checkout: REFACTOR to Checkout Sessions** → build brief `AF_CHECKOUT_SESSIONS_BUILD.md` (durable follow-up AFTER the P0-A env swap).

---

## Post-#282 findings (Jul 19) — read before applying ANY migration

- **✅ P1 DONE — prod-migration guard was INVERTED, fixed in PR #283.** Proven by execution: the old guard ALLOWED prod (exit 0) and REFUSED the safe dev fork — `PROD_HOST_MARKER = "ep-spring-tooth"` is the dev fork; prod is `ep-curly-block`. My proposed "refuse on prod db-name" fix would have broken staging/test/redraft (all use `neondb`), and host alone can't identify prod (the dev shadow shares prod's `ep-curly-block` compute). Prod is only the **(endpoint `ep-curly-block-ad0dlt9o` + db `neondb`) pair**. #283 recreates `db-target-identity.cjs` (allowlist, fails closed on unrecognized), rewires both guard scripts, guards the `--prod` mismatch, and adds `npm run db:target`. **Land #283 before applying #282's migration; run `npm run db:target` first.**
- **Admin tokens Phase 1 = PR #282** (token identity + `lastUsedAt`; good calls: no stored authority, fallback flag scoped off crons, `scopes` omitted). But the **audit blind spot is NOT closed** — verified the 23 bearer routes audit nothing (the `shared-secret` sentinel never existed). DECISION: central `logAdminAudit` in `requireAdminOrBearer` (recommended, no gaps) vs per-route (23 edits). Phase 2 (remove `ADMIN_PASSWORD` fallback) blocked on the list of automated callers using it.
- **P2 — `expect()`-in-loop antipattern sweep — [CC].** The abort-on-first-miss bug that made BOTH `admin-api-protection.test.ts` (P0-B) and the landing-audit spec dead guards is a class, not two incidents: any test asserting inside a loop over a discovered set aborts at the first failure → silent partial coverage that reads green-ish. Sweep `__tests__/` + `e2e/` for `expect(` inside loops; convert to collect-all-failures-then-assert-empty + a non-empty floor assertion. Prompt available.
- **P3 — `/pricing` logs `Unauthorized` for anonymous visitors** (pre-existing on `main`, NOT #276). `hooks/useTokenBalance.ts` hits `/api/tokens/balance` with no auth guard on a public page → Sentry noise + a wasted failing fetch per anon view. Fix: skip the fetch when unauthenticated (or return empty for anon).
- **Landing-audit spec + 37 test IDs pushed to #276** (`fb2912c4d`, 3 files, purely additive, 12/12 ×2). Rides #276's rebase + post-P0-A merge. "Runs ≠ gates": lands in the advisory, baseline-red core lane — making it gate = green + require the core lane (tracked follow-up).
- **✅ `/upgrade` normalizer — VERIFIED complete** (concern unfounded). All 4 `PlanFamily` values reachable via 9 aliases; #276 only ADDED `legacy → af_war_room`; pro/commissioner/supreme were already on main; no parallel impl. Note: `normalizePlanFamilyInput` is inline+unexported → a deletion silently reverts; extract to `lib/monetization/` + test.
- **✅ truthiness-bug grep — DONE in #278, negative-controlled** (only `trade/feedback`). The earlier "grep for others" line was stale.
- **✅ price-drift — AUDITED: no active drift, mechanism unfixed on the LIVE page.** All hardcoded prices currently MATCH the catalog. But it's **6 sites, not the 4 on record**: `nocturne/copy.ts` (LIVE landing), `journey/copy.ts`, `AFSupremeBundleSpotlight.tsx`, `LegacyToolsetGrid.tsx`, `world-cup/page.tsx`, `WorldCupBracketShell.tsx`. #276 fixed only the NEW `v3/copy.ts` (not live). **FIX (prompt provided): extract `priceOf()` to `lib/monetization/`, point all 6 live sites at it → retires the drift class. Standalone, no #276 conflict.**

---

## P0-A — Live checkout is charging wrong / dead (REVENUE) — [Vercel] + [Stripe] + [CC]

**Confirmed against live Stripe (acct "Henson Family").** The tiers were repriced Jul 2026; the old prices were archived on the same products, and the **old payment links are now dead** (`link_active=false`). If any `STRIPE_CHECKOUT_LINK_AF_*` Vercel env var still holds an old link URL, that tier's checkout is either failing outright or charging the archived amount. This is losing/misbilling money right now.

**The correct, active payment links already exist — use these:**

| Tier | Price | Correct ACTIVE link | Dead link to retire |
|---|---|---|---|
| Commissioner Monthly | $14.99 | https://buy.stripe.com/bJebJ1asldLxa3i4X57ok0q | $4.99 `plink_1T9pVn…` (inactive) |
| Commissioner Yearly | $149.99 | https://buy.stripe.com/aFaeVdbwpcHtejy9dl7ok0r | $49.99 `plink_1TBz78…` (inactive) |
| Legacy Monthly | $29.99 | https://buy.stripe.com/eVqaEXbwp7n9dfu9dl7ok0s | $9.99 `plink_1TBz4e…` (inactive) |
| Legacy Yearly | $299.99 | https://buy.stripe.com/14A3cvbwpcHt3EU0GP7ok0t | $99.99 `plink_1TBz6S…` (inactive) |

Pro, Supreme, and token links resolve to active prices in Stripe, but **verify all of them** anyway (below) since the env wiring can't be seen from here.

**Scope note:** only the **Commissioner** and **Legacy** (internal `war_room`) products were repriced — those are the tiers whose old links died. Pro, Supreme, and tokens were NOT repriced; leave them, but confirm via the diagnostic.

**Immediate fix (minutes) — [Vercel] set these exact vars to these exact bare URLs (no query params — the app appends `client_reference_id`/email itself), then redeploy:**

```
STRIPE_CHECKOUT_LINK_AF_COMMISSIONER_MONTHLY=https://buy.stripe.com/bJebJ1asldLxa3i4X57ok0q
STRIPE_CHECKOUT_LINK_AF_COMMISSIONER_YEARLY=https://buy.stripe.com/aFaeVdbwpcHtejy9dl7ok0r
STRIPE_CHECKOUT_LINK_AF_WAR_ROOM_MONTHLY=https://buy.stripe.com/eVqaEXbwp7n9dfu9dl7ok0s
STRIPE_CHECKOUT_LINK_AF_WAR_ROOM_YEARLY=https://buy.stripe.com/14A3cvbwpcHt3EU0GP7ok0t
```

**Verify (after redeploy) — [admin]** Hit `GET /api/admin/monetization/checkout-link-mapping` (already built; reports per-SKU `checkoutConfigured` / `issue` / `checkoutDestination`). Confirm `missingProducts: 0`, no `purchase_type_mismatch`, and every `checkoutDestination` is an active `buy.stripe.com` link — this also confirms Pro/Supreme/tokens are still good.

**Stripe — [no action needed].** The 4 old links and their prices are already `active:false` (archived). Once the env vars point at the URLs above, the dead links are unreferenced. Optional housekeeping only: prune other stale legacy products in the dashboard later.

**Durable fix (this week) — [CC], kills the drift class:**
- Stop using hardcoded `STRIPE_CHECKOUT_LINK_AF_*` payment links. Create Checkout Sessions server-side from catalog price IDs (`getMonetizationStripePriceIdForSku` already resolves `STRIPE_PRICE_AF_*`). Delete the payment-link env-var path (dead-code cleanup).
- Even better: assign Stripe **`lookup_key`s** to the canonical prices (`price_1TtYe…`) and resolve by lookup_key at runtime, so a future reprice needs zero code/env changes.
- Wire `checkout-link-mapping` (or a lookup_key health check) into CI or a monitored admin alert so a broken link can never ship silently again.

**Note:** PR #276 already fixed the *display* drift (copy.ts reads `catalog.ts`). This item is the *checkout* half, which #276 correctly flagged as out-of-PR.

---

## P0-B — Admin-boundary guard — DONE (PR #279, mergeable now)

Fixed FOUR defects (2 flagged + 2 found by the build: vacuous empty-glob pass, commented-out-gate pass), each negative-controlled; standalone test-only branch off main. **Landmine recorded:** do NOT standardize gates onto `requireAdmin()` — it's BROADER (`ADMIN_EMAILS` + paywall bypass) than `decision-os`'s `isDevAdminUserId` (2 owner accounts, 404s in prod); #279 taught the matcher instead + added a ≥-strictness guard comment. **Caveat:** this guard only protects on PRs once vitest runs in CI (see P1) — currently local-only.

---

## P0-C — Merge PR #275 (rankings auth) — READY — [GitHub]

Closes the live anonymous PII leak, gpt-4o billing vector, and cross-league write-IDOR. **NO test blocker** — the supposed failing `ai-phase2-routes-authz-contract.test.ts` passes everywhere (4/4 isolated, 24/24 combined, 44/44 full sweep); the plan's "pre-existing failure" premise was wrong. Remaining: close the duplicate `task_1ec8d2e1` branch, then merge → `main` (auto-deploys).

---

## P1 — CI vitest job — DONE (PR #281, Security suites green in real CI)

Shipped: an allowlist of **8 suites verified green on main (31 tests)**, with the 3 in-flight ones as commented `PENDING` lines. Closed a real trap — `vitest run valid missing` exits 0 (vacuous pass at the CI layer), so the job now fails if any listed path is missing or the list is empty. Once #281 merges: mark **Security suites required** in branch protection; uncomment PENDING lines as #275/#278/#279 land. Until then the admin guard (#279) etc. protect only local runs. _Original finding below stands:_ before #281, every unit/security suite ran locally once and guarded nothing going forward. Add a required vitest job (security suites first: rankings-routes-authorization, admin-api-protection, rate-limit, cron-draft-tick, privilege-escalation). Until this lands, greening the admin-boundary guard (P0-B) only protects local runs. **Also: local `tsc` false-cleans** (OOM / another session's broken files → zero lines ≠ clean). #275's "zero diagnostics full-project" was a false-clean vs the real 163 baseline. Trust CI's ts-ratchet (compiles vs clean main; caught #273's TS2367), not local claims — confirm #275/#278 CI green before merge.

## P1 — At/around merge

- **import-sleeper global rate-limit — DONE, shipped in PR #278.** Mechanical audit of all 49 `consumeRateLimit` sites found **14 degenerate** (not 1); all patched to per-key+IP, and the helper is now hardened to auto-add IP on the degenerate shape (only ever tightens, never widens; a deliberate no-`ip` global ceiling stays untouched). Two residuals below.
  - **DECISION — `insights_generate` shared bucket.** Six features (insights, draft-war-room, market-board, team-scan, trade-command-center, `[...path]` catch-all) share one action name at 3/min. Now per-IP (global-platform bug fixed), but they still share ONE budget. Your call: is 3 generations/min a *combined* ceiling across all six premium tools (current), or should each get its own action name / budget? Recommend splitting unless the shared ceiling is deliberate cost control.
  - **GAP — truthiness-bug class — [CC].** `legacy/trade/feedback` did `if (!consumeRateLimit(...))` — always truthy → rate limit never fired. Fixed there, but this shape is invisible to the key-composition audit. Grep every `consumeRateLimit`/`rateLimit`/`checkRateLimit` result used in a boolean without `.success` and fix any other dead 429 branches.
- **Bearer identity in audit logging — [Decision] + [CC].** `requireAdminOrBearer` + shared `ADMIN_PASSWORD` logs `shared-secret`, not who — a hole in the audit trail you just built. Decide: per-admin tokens carrying identity (recommended) vs a required caller-id header stopgap.
- **Rebase the admin-audit branch — [GitHub]/[CC].** 50 commits behind `origin/main`; rebase, re-run tsc + suites (byte-identical-today doesn't survive a rebase automatically), then push → PR → merge once P0-B is green.
- **/upgrade normalizer — [CC] (verify).** #276 fixed the silently-dropped `?plan=legacy`. Confirm the normalizer covers every plan key (pro/commissioner/supreme/legacy/war_room), not just legacy + war_room.

---

## P2 — Fast-follow

- **`AuthSession.createdAt` migration — [CC].** Owed for login metrics; cards read honest "not tracked." Add column + go-forward tracking; frame counts as "since <date>" (no historical backfill possible).
- **draft-tick enable gate — [CC].** Stays OFF until: DB-backed idempotency/duplicate-execution protection (unique constraint / lease row — NOT in-memory, crons double-fire across instances) + the isolated-league runtime test. Only item 1 of the 10-point checklist is covered today.
- **Durable LLM spend cap — [Decision] + [CC].** In-memory 10/min limits are per-warm-instance on serverless = soft. Add a DB-backed per-user daily cap (`consumeDailyLimit`) or Upstash for real gpt-4o billing protection.
- **Stale E2E `landing-page-click-audit.spec.ts` — [CC].** Asserts pre-Nocturne theme/Spanish toggles; test IDs added, toggle assertions need a rewrite.
- **Price-drift audit — [CC].** #247 noted 4 hardcoded price sites; confirm every price display now reads `catalog.ts` (copy.ts done in #276).

---

## P3 — Planned workstreams (need a brief before build)

- **Recap cron — [Decision] → brief.** Phase 1 only first (eligibility, shipped dark, dry-run, zero generation). Two gaps to close first: map the 6 recap types to the REAL tier ladder (Pro/Commissioner/Supreme/Legacy + Tokens), and never surface the word "AI" in customer-facing recap naming.
- **Full `/api` auth audit + CI guard — [Decision] → brief.** Middleware guards none of the 637+ `/api/*` routes (deliberate — do NOT move auth back to middleware). Triage by risk (LLM-calling → billing, league-scoped reads → PII, mutations → authz) and add a CI test that fails any `route.ts` lacking a known auth helper / not on a public allowlist.

---

## Open PR stack + merge order

Four changes are now in flight on overlapping subsystems. Merge in this order to avoid conflicts (all touch different files — verified: #275 fixes call sites + adds metering; #278 hardens the `lib/rate-limit.ts` helper + 12 other sites and deliberately skips `manager-psychology` since #275 owns it — so no collision):

1. **PR #275** (rankings auth) — highest priority, live security holes. Merge after proving the 1 failing test pre-existing + closing dup `task_1ec8d2e1`.
2. **PR #278** (rate-limit degenerate sites + helper hardening) — rebase onto post-#275 main, re-run, merge.
3. **PR #276** (V3 landing) — merge after the P0-A Stripe env fix lands.
4. **admin-audit branch** — push → PR, rebase (50 behind), green the admin guard (P0-B), then merge.

_Merged already:_ **PR #273** (dashboard `/dashboard/v2`) → main `55c78b3b4` — shipped DARK (nothing links to it, prod `/dashboard` untouched). Do NOT promote v2 to users until #275 merges (gates the `/api/rankings/*` + league-v2 endpoints it depends on; IDOR still live on main) and a human reviews it (its unit tests don't run in CI).

## Suggested order of execution

1. **P0-A immediate** (Vercel env repoint) — stops the bleeding today. Stripe already archived; no action there.
2. **P0-C merge #275**, then **#278**, then **P0-B** (green admin guard) → admin branch.
3. **Decisions:** `insights_generate` split · bearer identity · durable Checkout Sessions.
4. **P1 residuals:** truthiness-bug grep · /upgrade verify · admin-branch rebase.
5. **Merge PR #276** once P0-A is fixed.
6. **P2** fast-follows, then **P0-A durable** (Checkout Sessions / lookup_keys), then **P3** briefs on your go.

---
## STRIPE LINK VARS — CONFIRMED LIVE (Jul 20, 2026, acct Henson Family)
Verified active:true + correct price/interval against live Stripe. Paste into Vercel Production, then REDEPLOY.
Root cause of "charge issue": repriced tiers still pointed at superseded links now active:false (dead: old $9.99/$49.99/$99.99/$4.99). Pro was silently broken too.
Durable fix still pending = AF_CHECKOUT_SESSIONS_BUILD (server Checkout Sessions from catalog price IDs); until then reprice+update-var+redeploy is one atomic action.

PRO_MONTHLY   = https://buy.stripe.com/eVq14n43Xazldfu4X57ok0a   ($9.99  plink_1T9pTp)
PRO_YEARLY    = https://buy.stripe.com/9B6aEXgQJcHtejy3T17ok0k   ($99.99 plink_1TBz7a)
COMMISSIONER_MONTHLY = https://buy.stripe.com/bJebJ1asldLxa3i4X57ok0q ($14.99 plink_1TuJJ6 price_1TtYe0)
COMMISSIONER_YEARLY  = https://buy.stripe.com/aFaeVdbwpcHtejy9dl7ok0r ($149.99 plink_1TuJJD price_1TtYe2)
WAR_ROOM_MONTHLY (Legacy) = https://buy.stripe.com/eVqaEXbwp7n9dfu9dl7ok0s ($29.99 plink_1TuJJF price_1TtYe3)
WAR_ROOM_YEARLY  (Legacy) = https://buy.stripe.com/14A3cvbwpcHt3EU0GP7ok0t ($299.99 plink_1TuJJH price_1TtYe4)
SUPREME_MONTHLY = https://buy.stripe.com/cNi7sLdExdLxb7m9dl7ok0g ($19.99 plink_1TBz4B)
SUPREME_YEARLY  = https://buy.stripe.com/dRmcN58kd22P3EU75d7ok0f ($199.99 plink_1TByzm)
TOKENS_5  = https://buy.stripe.com/dRm14n43X9vhdfu9dl7ok09 ($4.99 one_time "5 AI Tokens" plink_1T9pTO)
TOKENS_10 = https://buy.stripe.com/dRm14nbwp5f13EU1KT7ok0c ($8.99 one_time "10 AI Tokens" plink_1T9pUt)
TOKENS_25 = https://buy.stripe.com/dRmcN5581cHtb7m75d7ok0d ($19.99 one_time tokens_25 plink_1T9pVM)

BRAND WATCH: token price nicknames contain "AI Tokens" — check product-name side for customer-facing "AI" leak.

---
## 🔴 SECURITY INCIDENT — Neon credential leaked to PUBLIC repo (Jul 20, 2026)
CAUSE: pushed `wip/phase38-rescue` (unscanned) → it force-committed `.claude/settings.local.json`, which carries inline `DATABASE_URL=...` commands in the Claude Code permissions allowlist. Role `neondb_owner` password leaked.
VERIFIED (Cowork, this session):
- Branch `wip/phase38-rescue` is GONE from BOTH public remotes: origin=TheCiege23/allfantasy-v2-main AND vercelrepo=TheCiege23/allfantasy-v2. Both repos PUBLIC (234 / 14 heads). Commit still SHA-retrievable → deletion ≠ remediation.
- Blast radius = ONE secret: `neondb_owner` password, SAME password across 8+ compute endpoints (leaked commit: ep-polished-hat/winter-salad/noisy-flower/raspy-glitter/spring-tooth; current allowlist: ep-proud-morning/soft-grass/wispy-night). Shared password → assume it also authenticates PROD (ep-curly-block, branch br-withered-shadow-adur64u9). Prod string itself not literally in file, but the role password very likely equals prod's.
- NO other real secrets: Resend/Supabase/Anthropic grep hits were FALSE POSITIVES (filename fragments "ensure_survivor/zombie", supabase_ensure_*.sql paths). u:/x: postgres URIs = placeholder/example strings.
- Neon reset is PER-BRANCH-ROLE (API resetprojectbranchrolepassword). Resetting one branch does NOT rotate others. MUST reset `neondb_owner` on the PROD branch + dev fork + every branch sharing it.
FIX (user only): rotate `neondb_owner` on prod branch → update Vercel DATABASE_URL/DIRECT_URL → redeploy → then rotate on other branches + update .env/.env.local. Then scrub the live password out of `.claude/settings.local.json` and STOP inlining creds in shell commands. Add pre-push gitleaks/trufflehog scan.
OPTIONAL: GitHub Support to purge unreferenced object (don't rely on it); check Neon monitoring for connections in the exposure window.
STILL OPEN: `fix/redraft-season-history-sim` pushed to origin this session but held by the other session under redraft freeze — decide remove vs keep.
