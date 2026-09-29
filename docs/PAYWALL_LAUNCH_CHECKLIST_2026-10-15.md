# Paywall launch — October 15, 2026 · the checklist

**Written 2026-09-29 against `origin/main` `d2482b97c`.** Every claim below carries the file it was
read from. Nothing was run against production, Stripe or any database to write it. What could not
be read from code is marked **UNVERIFIED**. Re-check anything marked that way before relying on it.

This is the ONLY launch checklist for the paywall. `AF_STRIPE_CUTOVER_CHECKLIST.md` and
`AF_TIER_BILLING_BUILD.md` (repo root, July 2026) are superseded: their prices contradict the
catalog. See §8.

---

## 1. How the launch happens: nobody deploys

- **The switch time is one constant.** `DEFAULT_PAYWALL_STARTS_AT = 2026-10-15T04:00:00Z`, which is
  midnight US Eastern (`lib/monetization/paywallLaunch.ts:14`).
- **Every launch-keyed gate reads `isPaywallLive()`** and flips at the same instant.
- **To postpone,** set `AF_PAYWALL_STARTS_AT` to a later ISO timestamp. An unparseable value is
  ignored, never treated as "now" (`paywallLaunch.ts:16-23`).
  - ⚠ **Writing a Railway variable redeploys the service** (about 9 minutes). To postpone, set it well
    before 04:00Z, on `allfantasy-v2-main` (the web service, which serves every gate). Read it back
    afterwards.
- **To bring launch forward,** use the same variable with an earlier time.

## 2. Owner decisions on record

| Date | Decision |
|---|---|
| 2026-09-24 | `/pricing` shows **Pro / Commissioner / Supreme**. AF Legacy is hidden from the page (`PricingV4.tsx:95-101`) but still sells from `/upgrade?plan=war_room`. Supreme = Pro + Commissioner (`lib/subscription/feature-access.ts:65-68`); it does **not** include Legacy. |
| 2026-09-24 | Existing users get a **founding-member offer**, not free months. |
| 2026-09-24 | **Time zones stay free.** |
| 2026-09-24 | **Trade Center:** free users keep the deterministic verdict; the written "why" is AF Pro (`trade_center_ai`, a soft gate). |
| 2026-09-29 | **Routes that are plan-gated TODAY stay paid.** They were never promised free. The launch copy says "Pro analysis is free until Oct 15" and names exactly what that means (`components/launch/launchCopy.ts:23-31`). |

## 3. What flips automatically at 04:00Z

### 3a. /core depths (`lib/core-app/coreDepthAccess.ts:41-72`)

- **Before launch:** every depth is open to everyone, marked "Free until Oct 15 — then {plan}"
  (`components/core-app/CoreDepthLock.tsx:69-77`).
- **After launch:** a viewer without the plan sees the lock card with "See {plan}" (`:62-64`).
- **If the plan lookup fails after launch, the depth stays LOCKED** (`lib/core-app/corePaywall.ts:30`).

| Depth | Plan | Where |
|---|---|---|
| `player_depth` | AF Pro | /core players; `api/core/player-card`; `players/[slug]` |
| `trade_depth` | AF Pro | Trade Center; `trade-value/analyze`; `league/trade-finder`; `leagues/[id]/trades/rosters` |
| `competitive_edge` | AF Pro **or** AF Legacy | Trade Center, Waivers, Draft HQ |
| `commissioner_depth` | AF Commissioner | /core commissioner hub; 8 `app/commissioner-os/*` pages; `api/commissioner-os/reports/*` |

### 3b. Per-call AI gates (`lib/ai-protection/costGate.ts`, `paidFromLaunch: true`)

- **Before launch:** a free user is held only to the daily cap.
- **After launch,** a signed-in user without the plan gets `403 feature_not_entitled`. The anonymous
  allowance ends, so signed-out users get `401` (`costGate.ts:160-213`).

| Key | Plan feature | Routes |
|---|---|---|
| `start_sit_ai` | `pro_start_sit` | `ai-tools/start-sit/analyze`, `leagues/[id]/ai/start-sit`, `start-sit/chimmy` |
| `trade_ai` | `trade_analyzer` | `ai/trade-analysis`, `dynasty-trade-analyzer`, `trade-value/chimmy`, `trades/analyze` |
| `trade_finder` | `trade_analyzer` | `trade-finder` (3/day anonymous until launch) |
| `draft_ai` | `pro_draft_ai` | `ai/draft-help`, `draft-ai` |
| `chimmy_voice` | `ai_chat` | `chimmy/voice` |
| `trade_center_ai` | `trade_analyzer` | `trade-value/analyze`. **SOFT:** falls back to the free verdict, never refuses |
| `weekly_recap_ai` | `commissioner_ai_recap` | `ai/weekly-recap` |
| `league_format_ai` | `commissioner_ai_tools` | `leagues/[id]/devy/ai`, `leagues/[id]/idp/ai` |

`legacy_chat` (`costGate.ts:61`) has no caller. It is dead config and harmless.

### 3c. Copy

- **Landing banner:** hidden after launch (`app/page.tsx:180`; `LaunchBanner.tsx:34` also hides itself).
- **Launch strip** on /pricing, /upgrade, /signup and the /core home:
  - The countdown half ends at launch (`LaunchOfferStrip.tsx:35-37`).
  - The founding line **stays for members** (`launchCopy.ts:129-135`).
  - "Sign up before…" for signed-out visitors ends (`lib/monetization/foundingMember.ts:80`).
- **Founding-member status** = the account was created before launch (`foundingMember.ts:43-52`).

## 4. Already paid today: NOT launch-keyed, and staying that way (§2, 2026-09-29)

These gate through `requireEntitlement` / `FeatureGateService` / `requireFeatureEntitlement` /
`requireAfSub` / the Survivor and Big Brother route guards, with no launch date.

- **AF Pro:**
  - Chimmy past the free daily top-up (`ai_chat` with token fallback; 2 free questions/day,
    `lib/tokens/freeChimmyQuestions.ts:9`)
  - `league_ai_coaching`
  - `player_comparison_explanations`
  - `matchup_explanations`
  - `trade_analyzer` on `/trade-evaluator` and `trade-analyzer/ai`
  - `ai_waivers`
  - `pro_autocoach`
  - guillotine / salary-cap / zombie AI
  - player-side Survivor and Big Brother AI
- **AF Commissioner:**
  - `commissioner_ai_tools` (~40 AI routes via `requireAfSub`)
  - `commissioner_automation`
  - `storyline_creation`
  - `league_rankings`
  - `ai_team_managers`
  - `advanced_scoring` (custom scoring tables on the 7 `*-scoring` routes)
  - `advanced_playoff_setup`
  - `commissioner_dispersal_draft`
  - `commissioner_integrity_monitoring`
  - host-side Survivor and Big Brother AI
- **AF Legacy (War Room):**
  - `draft_prep` (`draft/recommend`)
  - `war_room_draft_strategy` (the 5 `*-war-room/[action]` routes)
  - `/api/draft-war-room` accepts Pro's `pro_draft_ai` too
- **Supreme:** no Supreme-only gate found (UNVERIFIED as exhaustive).

## 5. Owner-only tasks

- [ ] **Founding coupon.**
  - Create it in the LIVE Stripe account.
  - Set `STRIPE_FOUNDING_COUPON_ID` on `allfantasy-v2-main`, plus `FOUNDING_OFFER_LABEL` if you want
    the discount named in copy.
  - While it is unset, no page mentions founding pricing and checkout accepts promo codes as before
    (`foundingMember.ts:15-17,27-30`). This is a Railway variable write, so it redeploys.
  - Current value: **UNVERIFIED.**
- [ ] **Tell existing users.** Decided 2026-09-24: an offer by **Oct 8**. Nothing in code sends it.
- [ ] **Live price IDs.** The 11 `STRIPE_PRICE_AF_*` variables (8 subscription, 3 token) must point at
  live prices matching the catalog:

  | Plan | Monthly | Yearly |
  |---|---|---|
  | Pro | $9.99 | $79.99 |
  | Commissioner | $14.99 | $129.99 |
  | Legacy | $9.99 | $79.99 |
  | Supreme | $19.99 | $159.99 |

  Tokens: $4.99 / $8.99 / $19.99 (`lib/monetization/catalog.ts`).
  `scripts/verify-stripe-price-parity.ts` checks every price. It is hand-run only (not in
  `package.json`). Run it with a read-only view of the live key.
- [x] **Stripe webhook events.** Fixed by the owner 2026-09-24 and verified read-only the same day: 26
  events, including the 7 the handler needs. Only re-check if the endpoint has been edited since.
- [ ] **`commissioner_recipes_send_enabled`** (platform toggle, default off).
  - Commissioners can save automation recipes; nothing sends until this is on
    (`runCommissionerRecipesJob.ts:332`), and the hub says so (`AutomationRecipes.tsx:78-82`).
  - Decide whether it is on for launch. Production value: **UNVERIFIED.**

## 6. Engineering checks before launch

- [ ] **`npm run prove:purchase`.**
  - Real Stripe **sandbox** objects: price parity, checkout session, webhook grant (player/trade/edge
    depth open, commissioner depth still locked), idempotency, test-clock renewal, cancel, full refund,
    chargeback (`scripts/prove-purchase-path.ts:7-19`).
  - Needs the `.env.test` DB and an `sk_test_` key, and refuses anything else.
  - Covers **AF Pro only**. It does not cover the hosted card page or live webhook delivery.
- [ ] **Walk the locked state by hand.**
  - Run a local server on the `.env.test` database with `AF_PAYWALL_STARTS_AT=2020-01-01T00:00:00Z`,
    and sign in as a **no-plan test account**.
  - 🛑 `.env.local` points at the production database. Never walk locks on it.
  - Admin accounts bypass every plan, so an admin sees no locks.
- [ ] **Date-bomb sweep.** Run the unit suite once with `AF_PAYWALL_STARTS_AT=2020-01-01T00:00:00Z`
  and compare failures against the same run without it. A test that only fails once the date is past
  is a test that turns red by itself on Oct 15.
  - Tests that deliberately cover post-launch: `ai-cost-gate`, `core-depth-paywall`,
    `core-depth-paywall-routes`, `commissioner-os-depth-paywall`, `founding-member-checkout`,
    `founding-member-rule`.
- [ ] **E2E is pinned to 2099** (`playwright.config.ts:201-208`, guarded by
  `__tests__/playwright-paywall-pin.test.ts`), so **no E2E spec covers the post-launch state.**
  Accepted as-is unless someone adds one.

## 7. Known defects to fix before launch

Each was read on `origin/main` 2026-09-29.

- [ ] **Storylines charge tokens with no confirmation.**
  - `drama/tell-story/route.ts:36-41` and `story/create/route.ts:51-56` hardcode
    `confirmTokenSpend: true`.
  - The callers post `{ eventId }` on a click with no confirm step: `MatchupDramaWidget`,
    `drama/page`, `drama/[eventId]/page`, `LeagueDramaWidget`, `LeagueStoryModal`.
  - On tell-story **the charge happens before `eventId` is validated**, so a bad request costs tokens.
  - An error shows as "No story available."
- [ ] **Survivor AI panel can never spend tokens.**
  - `SurvivorAIPanel` posts `{ type, week }` without `confirmTokenSpend`. The route defaults it to
    false, and the guard answers `409 token_confirmation_required`
    (`survivor-ai-route-guard.ts:215-227`).
  - `useAfSubGate` handles only 402/403, so the user sees an error.
  - The confirming hook (`useSurvivorAiRequest`) is used only by a smoke button.
- [ ] **Survivor command-centre token prices are wrong on screen.**
  - It shows 15/50/100 (`survivor-ai-token-catalog.ts:42-56`); the charged rules are 10/30/75
    (`lib/tokens/pricing-matrix.ts`).
  - Whether a DB override changes the charge: UNVERIFIED.
- [ ] **Chimmy's orchestration fallback prints raw `key: value` payload pairs to the user**
  (`lib/ai-orchestration/orchestration-service.ts:304-319`).
  - `ChimmyChatShell.tsx:553,566` tells users to "check ElevenLabs API key in settings".
  - ⚠ The chat route and charge-on-delivery match the outage text so they don't bill for it. Reword
    only together with that match.

## 8. Superseded documents

- **`AF_TIER_BILLING_BUILD.md`** (last touched 2026-07-15):
  - `:22` lists Pro $9.99/$99.99, Commissioner $14.99/$149.99, Supreme $19.99/$199.99 and Legacy
    $29.99/$299.99. The catalog says otherwise (§5).
  - `:92,115` say Commissioner includes Pro tools. It does not (`catalog.ts:94-98`).
- **`AF_STRIPE_CUTOVER_CHECKLIST.md`** (same date), `:15-16,32,35`: Legacy at $29.99/$299.99 and
  Commissioner yearly at $149.99. Every box unchecked.
- **`AF_LAUNCH_CERTIFICATION_CHECKLIST.md`** is about OAuth and league import, not the paywall.
- **`docs/PROMPT289_LAUNCH_READINESS_CHECKLIST.md`** (2026-03) is generic.

## 9. Launch morning

Nothing to deploy. Watch:
- 403 `feature_not_entitled` volume on the §3b routes (a spike from one route means a surface is
  calling a gated route for free users it should not);
- checkout sessions and `stripe_webhook_events` rows;
- that a no-plan test account now sees lock cards on the four §3a depths.

If anything is wrong, the lever is `AF_PAYWALL_STARTS_AT` (§1). Remember that setting it redeploys.
