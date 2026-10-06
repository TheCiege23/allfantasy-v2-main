# Paywall launch — October 15, 2026 · the checklist

**Written 2026-09-29 against `origin/main` `d2482b97c`.** Every claim below carries the file it was
read from. Nothing was run against production, Stripe or any database to write it. What could not
be read from code is marked **UNVERIFIED**. Re-check anything marked that way before relying on it.

**Re-verified 2026-09-29 against `b85cdfb15`, 73 commits later.** §1, §3a, §3b, §6 and §8 anchors
still resolve. Two things changed: **§7 is entirely fixed** (commit `d5e261459`, all four defects,
53 tests) and **the §6 date-bomb sweep has been run** — clean, but the method the sweep was
described with is misleading and is corrected there. Everything still open in §5 needs a
production read (a Railway variable or a DB row) and is owner-only.

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

**Why these stayed UNVERIFIED after the 2026-09-29 re-check, rather than being left unexamined.**
Each needs a *production* read, and the two kinds differ:

- `STRIPE_FOUNDING_COUPON_ID` and the 11 `STRIPE_PRICE_AF_*` values are **Railway variables**.
  Reading them means pulling the service's whole variable list, production secrets included, into
  whatever transcript or log is doing the reading. Not worth it for a presence check — especially
  as **unset is fail-safe here**: `foundingMember.ts:15-17,27-30` means no page mentions founding
  pricing and checkout behaves exactly as before, so the failure mode is "no discount", never "a
  page promised a discount the charge did not apply".
- `commissioner_recipes_send_enabled` is **not** an env var. It is a platform toggle row
  (`RECIPES_SEND_TOGGLE`, `lib/core-app/commissioner/recipes.ts:50`), so its production value is a
  database read. Default off; commissioners can save recipes and nothing sends.

- [x] **Founding coupon.** ✅ **Done 2026-10-04.** `FOUNDING_MEMBER_2026` in LIVE Stripe (`acct_1ReIO1Ht5tjM1ovR`,
  the same account production's key uses): **20% off, repeating 12 months**, no redemption cap, no expiry.
  `STRIPE_FOUNDING_COUPON_ID=FOUNDING_MEMBER_2026` and `FOUNDING_OFFER_LABEL="20% off your first year"`
  set on `allfantasy-v2-main`; `/pricing` signed in shows "Founding member: 20% off your first year,
  applied automatically at checkout." Because it is not `forever`, the email drops "doesn't expire".
  - Create it in the LIVE Stripe account.
  - Set `STRIPE_FOUNDING_COUPON_ID` on `allfantasy-v2-main`, plus `FOUNDING_OFFER_LABEL` if you want
    the discount named in copy.
  - While it is unset, no page mentions founding pricing and checkout accepts promo codes as before
    (`foundingMember.ts:15-17,27-30`). This is a Railway variable write, so it redeploys.
  - **Read 2026-10-04 (presence only, no value printed): NOT SET**, and no `FOUNDING_OFFER_LABEL`. Still the
    blocker for the email below.
- [x] **Tell existing users.** Decided 2026-09-24: an offer by **Oct 8**. ✅ **SENT 2026-10-06 04:07 UTC:
  83 founding members** (82 en, 1 es) via `scripts/send-founding-offer.ts` — a test to the owner on
  2026-10-04 first (landed in the Inbox), then 82 with 0 failures; Resend reported delivered, no
  bounces. The claim ledger records all 83, so a re-run sends nothing. Skipped at send time: 45
  unverified, 5 undeliverable domains, 5 opted out.
  - **Sender built 2026-10-04: `scripts/send-founding-offer.ts`.** Dry run by default; `--apply` refuses
    unless the key is LIVE, the coupon is set and valid in live Stripe, the paywall has not started and
    links point at production (`foundingSendBlockers`, unit-tested). Once per address (claim ledger),
    honours unsubscribes AND `productUpdates = false`, verified emails only unless
    `--include-unverified`. Prints "doesn't expire" only for a `forever` coupon; Spanish never quotes
    the English label. **Dry run against production 2026-10-04:** 136 accounts before launch → **81
    recipients** (80 en, 1 es); skipped 45 unverified, 5 undeliverable domains, 5 opted out. The only
    blocker: the coupon. Run it with `railway run` from the linked primary checkout (header has the
    command); send `--only=<your email> --apply` to yourself first.
  - **Copy drafted 2026-09-30: [`FOUNDING_OFFER_EMAIL_DRAFT.md`](./FOUNDING_OFFER_EMAIL_DRAFT.md)** —
    subject options, an English body in two variants (with and without `FOUNDING_OFFER_LABEL`), a
    Spanish note, and every claim traced to the file it came from.
  - 🛑 **It is blocked on the coupon, not on writing.** The draft must not be sent while
    `STRIPE_FOUNDING_COUPON_ID` is unset: an email cannot check the flag at render time the way the
    pages do, so every founding line in it would be false the moment someone clicked through —
    `/pricing` shows no founding pricing at all and checkout applies nothing. That is the invariant
    `launchCopy.ts:10-12` exists to protect. Coupon first, then variables, then read them back, then
    send.
  - ⚠ One sentence in the draft the code **cannot** verify: "your founding pricing doesn't expire"
    is true only if the coupon is `forever` rather than `once`/`repeating`. Duration lives in Stripe
    (`foundingMember.ts:10-13`), so check it against the coupon you create or cut the clause.
- [x] **Live price IDs.** The 11 `STRIPE_PRICE_AF_*` variables (8 subscription, 3 token) must point at
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
  - ✅ **Run 2026-10-04 against the LIVE key via `railway run` (no value printed): 11/11 ok.** The script
    now also checks each price is ACTIVE, in USD and recurring on the catalog's interval (one-time for
    token packs) — it used to compare the amount only, so a yearly SKU on a monthly-billing price read
    "ok". A positive control (yearly pointed at the monthly price, in-process only) reported both the
    amount and "bills every month, catalog says every year", exit 1.
- [x] **Stripe webhook events.** Fixed by the owner 2026-09-24 and verified read-only the same day: 26
  events, including the 7 the handler needs. Only re-check if the endpoint has been edited since.
- [x] **`commissioner_recipes_send_enabled`** (platform toggle, default off). ✅ **Confirmed ON for launch by
  the owner, 2026-10-06** — the `true` read below is intended.
  - Commissioners can save automation recipes; nothing sends until this is on
    (`runCommissionerRecipesJob.ts:332`), and the hub says so (`AutomationRecipes.tsx:78-82`).
  - Decide whether it is on for launch. **Production value read 2026-10-04: `true` — it is ON.**
    Someone enabled it after this list was written; confirm that was intended for launch.

## 6. Engineering checks before launch

- [x] **`npm run prove:purchase` — RUN 2026-09-30 against `431d97425`. 24 of 24 checks passed, exit 0.**
  - Real Stripe **sandbox** objects: price parity, checkout session, webhook grant (player/trade/edge
    depth open, commissioner depth still locked), idempotency, test-clock renewal, cancel, full refund,
    chargeback (`scripts/prove-purchase-path.ts:7-19`).
  - Needs the `.env.test` DB and an `sk_test_` key, and refuses anything else.
  - Covers **AF Pro only**. It does not cover the hosted card page or live webhook delivery.

  What the run actually established, beyond "it passed" — the renewal and refund rules are the ones
  worth naming, because they are the two that silently lock out or fail to lock out a real payer:

  | | |
  |---|---|
  | price parity | `price_…QNLJx` = 999 usd/month vs catalog $9.99 |
  | grant | AF Pro on `af_pro_monthly`; entitlement reads `plans=["pro"] active` |
  | depth after paying | player/trade/edge **open**, commissioner **locked** |
  | idempotency | delivered twice, `duplicate: true`, 1 row |
  | renewal (test clock) | period end moved **2026-10-30 → 2026-11-30 (+31.0 days)**, still active |
  | cancel | locked again; expired one second after Stripe's end |
  | partial refund | plan and billing **unchanged** |
  | full refund | access ends **and** billing cancelled |
  | chargeback | same, on the sandbox disputing card |

  ⚠ **The safety properties held, and they are the reason to read the run's own output rather than
  just its exit code:** the database was `ep-muddy-leaf…` (the `.env.test` host, not production
  `ep-curly-block`); `removed 0 variable(s) a .env load added`, so the `.env` pin worked; and
  `META_CONVERSIONS_API_TOKEN not set, skipping CAPI event` — the irreversible Meta "Purchase"
  conversion never fired. Cleanup removed 4 test clocks with their customers and subscriptions, 13
  webhook events and 4 test users. No key-shaped prefix appears anywhere in the log.

  🛑 **HOW TO RUN IT HERE, because `npm run prove:purchase` fails in the obvious place.** The env
  files live in the primary checkout (`C:\allfantasy-v2-main`), which is pinned at an older commit
  whose `package.json` has no such script — so the npm alias errors with `Missing script`. The
  worktrees have the script but no env files, since those are gitignored. Run the current code and
  point it at the primary's files:

  ```
  node --require ./scripts/_audit-preload.cjs --import tsx scripts/prove-purchase-path.ts \
    --db-env C:/allfantasy-v2-main/.env.test --stripe-env C:/allfantasy-v2-main/.env.local
  ```

  The defaults are the only safe pairing and are not interchangeable: `.env.local` holds the
  `sk_test_` key but points `DATABASE_URL` at **production**, and `.env` holds an **`sk_live_`**
  key. That is exactly why the script takes the database from `.env.test` alone and refuses
  `ep-curly-block` outright (`prove-purchase-path.guards.ts:13,58,63`).
- [x] **Walk the locked state by hand — WALKED 2026-09-30 against `main`. All four depths lock, with
  the right plan named on each.**

  Signed in as a no-plan, non-admin account with one league, launch date forced past. Every line
  below is the lock card's own text, read off the rendered page:

  | depth | surface | what it said |
  |---|---|---|
  | `player_depth` | player card (`/core/players?player=…`) | "Suggested FAAB bids are part of **AF Pro**" and "Recommended moves are part of **AF Pro**" → **See AF Pro** (twice on one card) |
  | `trade_depth` | Trade Center (`/core/trades?league=…`) | "The trade finder is part of **AF Pro**" → **See AF Pro** |
  | `competitive_edge` | Waivers (`/core/waivers?league=…`) | "**Competitive Edge** is part of AF Pro" → **See AF Pro** |
  | `commissioner_depth` | `/commissioner-os/analytics` | "League analytics are part of **AF Commissioner**" → **See AF Commissioner** |

  Every card carried the same honest framing — *"Your leagues, scores and the basics stay free.
  Upgrade to see the rest."* — and no surface rendered a broken or empty lock. The free content
  stayed visible alongside it: injury status, next game, news and market value on the player card;
  the trade timeline and league rules on Trade Center; FAAB rules and roster counts on Waivers; the
  whole `/core/commissioner` hub.

  ✅ **And the distinction worth having checked: the account was that league's COMMISSIONER by role
  and still saw `commissioner_depth` locked.** Role is not plan. An admin would have seen no locks
  at all, which is why the account must be neither.

  🛑 **THE GATES SIT ON THE DETAIL, NOT THE PAGE — so "load four pages" does not walk this.** Every
  one of the four boards renders free and unlocked at its list level; the lock only appears once the
  gated content has something to show. Three things each have to be true or a surface looks open
  when it is merely empty:
  - **a league must be selected.** `/core/trades` and `/core/waivers` show an all-leagues board with
    no lock; the gate is inside the per-league view, reached with `?league=<id>`.
  - **the detail must be opened.** The Player Finder list never locks; the card does.
  - **the gated block needs data.** Draft HQ's edge slot said "ranking the best available needs the
    undrafted player pool scored for this league; no draft recommendation output is stored" — a data
    gap wearing the same clothes as an open gate. Do not read that as unlocked.

  ⚠ **HOW TO REDO IT, because the obvious route is blocked and the setup is the hard part.**
  `preview_*` reaches only the primary checkout, which has no paywall code (see below), so the
  server has to be started from a worktree by hand:
  1. Compose `.env.local` in the worktree from the primary's, then **override every key that can
     reach a database** — `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `DIRECT_URL`, `COMMISH_APP_URL`,
     `COMMISH_PLATFORM_URL`, `TRADE_OS_VALIDATION_DATABASE_URL` — with `.env.test`'s values, and add
     `AF_PAYWALL_STARTS_AT=2020-01-01T00:00:00.000Z` plus a private `AF_NEXT_DIST_DIR`.
     🛑 Overriding only `DATABASE_URL`/`DIRECT_URL` is NOT enough: the production host appears in
     **five** keys, so the first attempt here still pointed at production and was caught only by
     asserting the prod host occurs **zero** times in the composed file. Assert that, every time.
  2. Sign in the way the suite does — seed the row through `PUT /api/e2e/run-relay`
     (`x-allfantasy-e2e: 1`), then sign a token with the server's own secret. See
     `e2e/helpers/session-cookie.ts`; `sub`, `id` and `username` are all load-bearing.
  3. Seed a league with `POST /api/e2e/decision-os-proof-league`, and **keep it until the walk is
     finished** — deleting it first drops the app back to the no-league board and the gates vanish.
  4. Read pages with the browser's page-text tool, not `innerText`: this route returns empty from
     `innerText` while rendering fine.
  5. First compile of `/core/[[...screen]]` takes **~250-280s**. That is not a hang.
  6. Clean up: delete the league, stop the server, remove `.env.local` (it holds real secrets copied
     from the primary), and `git checkout -- tsconfig.json` — `next dev` rewrites it.
  - Run a local server on the `.env.test` database with `AF_PAYWALL_STARTS_AT=2020-01-01T00:00:00Z`,
    and sign in as a **no-plan test account**.
  - 🛑 `.env.local` points at the production database. Never walk locks on it.
  - ⚠ And `.env.test` is **not** what a dev server reads on its own — Next loads `.env.local`, so
    `DATABASE_URL` has to be passed explicitly in the environment. Verify by effect which host the
    server actually connected to; do not infer it from the file you meant it to read.
  - Admin accounts bypass every plan, so an admin sees no locks.

  **This is far narrower than it reads, because the logic is already proven — checked 2026-09-30.**
  What the phrase "walk the locked state" covers, and what is left:

  | | covered by | status |
  |---|---|---|
  | all four depths locked, no-plan, after launch | `prove:purchase`, real code + `.env.test` DB | ✅ `{"player":false,"trade":false,"edge":false,"commissioner":false}` |
  | paid → player/trade/edge open, commissioner stays locked | `prove:purchase` | ✅ |
  | cancelled → locked again | `prove:purchase` | ✅ |
  | §3b per-call gate refusals | `ai-cost-gate`, `ai-cost-gate-wiring`, `core-depth-paywall-routes`, `core-depth-paywall`, `plan-refusal`, `commissioner-os-depth-paywall` | ✅ 150 tests, 7 files, green 2026-09-30 |
  | the lock card's words | `ios-app-paywall-copy` | ✅ |
  | **the card RENDERING on each of the four surfaces, seen in a browser** | the hand walk | ✅ **walked 2026-09-30 — all four lock, see the item above for what each card said** |

  So the human step is: sign in as a no-plan account and confirm the lock card actually appears —
  right card, right plan name, no broken or empty state — on **/core players, Trade Center, Waivers
  or Draft HQ (Competitive Edge), and the /core commissioner hub**. Everything else on the list
  above is already machine-checked. Budget minutes, not an hour.

  🛑 **AND `preview_*` CANNOT DO IT — the reason is a trap, not an excuse.** (The walk itself was
  done, by starting a server from a worktree instead; the recipe is in the item above. What follows
  is why the obvious route is the wrong one.)
  `preview_*` only reaches the PRIMARY checkout (`C:\allfantasy-v2-main`), and measured 2026-09-30
  that checkout's local `main` is **diverged from `origin/main`, not merely behind**
  (`merge-base --is-ancestor` rc=1), sitting on a **2026-09-10** commit with 78 dirty files.
  `lib/monetization/paywallLaunch.ts` and `lib/core-app/corePaywall.ts` **do not exist there at
  all** — `git diff origin/main` on those two paths is 88 deletions and 0 insertions, and a grep for
  `DEFAULT_PAYWALL_STARTS_AT` finds nothing.

  ⚠ **A dev server started there shows NO LOCKS, and looks like a working app.** There is no launch
  date to be past, no `isPaywallLive`, no depth resolver — so every depth renders open. Walk it
  there and the honest-looking conclusion is "nothing is locked", which is true of that server and
  says nothing whatever about `main`. Pull the primary checkout up to `origin/main` first, or do the
  walk from a worktree with its own server.
- [x] **Date-bomb sweep — RUN 2026-09-29 against `b85cdfb15`. Zero date bombs.**

  🛑 **AND THE METHOD ORIGINALLY WRITTEN HERE IS WRONG. Do not use it.** It said to set
  `AF_PAYWALL_STARTS_AT=2020-01-01T00:00:00Z` and compare. That moves the **launch date**, not the
  clock — the opposite of what happens on Oct 15, where the launch date stays put and the clock
  passes it. The two are not interchangeable, because a test that correctly pins
  `now: 2026-10-01` suddenly finds itself *after* an overridden launch and fails while being in no
  danger at all.

  Measured both ways over the 19 launch-date-dependent suites (328 tests):

  | run | condition | result |
  |---|---|---|
  | A | baseline | 19 files, 328 tests pass |
  | B | `AF_PAYWALL_STARTS_AT=2020-01-01` (the old method) | **5 failed**, all in `ai-cost-gate` |
  | C | clock faked to 2026-10-20, env var **unset** (the real thing) | 19 files, 328 tests pass |

  All 5 run-B failures are artifacts of the method. `ai-cost-gate` pins `now` (`BEFORE`/`AFTER`,
  `:27-28`) and passes it explicitly, but `isPaywallLive(now)` compares against
  `getPaywallStartsAt()`, which reads the env var — so overriding the date relabels `BEFORE` as
  after-launch. Two of the five even say "before launch" in their names. On Oct 15, with the var
  unset, `now: BEFORE` is still before the default launch and they pass. Run C proves it.

  **To re-run it, move the clock, not the date:** a temporary vitest config whose `setupFiles`
  APPENDS `vi.useFakeTimers({ now: <after launch>, toFake: ['Date'], shouldAdvanceTime: true })`.
  - ⚠ `--setupFiles` is **not** a vitest CLI option here (it exits 1 having run nothing, which
    reads exactly like a clean pass). Use `-c <config>`.
  - 🛑 The probe config must keep `vitest.setup.db-guard.ts` **first** in `setupFiles`. Replacing
    the list instead of appending to it unpins `DATABASE_URL` and points the suite at production.
  - Confirm the probe worked before trusting a green run: assert the ambient clock is past launch
    AND that `AF_PAYWALL_STARTS_AT` is still unset. Both were asserted here.

  **Scope, stated so the green is not over-read:** 19 suites selected by grep for
  `paywallLaunch|isPaywallLive|AF_PAYWALL_STARTS_AT|foundingMember|launchCopy|LaunchBanner|"free
  until"|"Oct 15"`, plus `core-depth-paywall-routes` (which the grep missed and this list names).
  A date bomb in a suite mentioning none of those terms would not be covered. A full-suite clock
  shift was declined deliberately: it moves every date, so NFL-week and freshness assertions would
  drown the paywall signal, and the box had 5.4 GB free with 3 peer test runs live.

  - Tests that deliberately cover post-launch: `ai-cost-gate`, `core-depth-paywall`,
    `core-depth-paywall-routes`, `commissioner-os-depth-paywall`, `founding-member-checkout`,
    `founding-member-rule`. All six pass under run C.
- [x] **E2E is pinned to 2099** (`playwright.config.ts:208`, guarded by
  `__tests__/playwright-paywall-pin.test.ts` — both re-verified 2026-09-29, guard passes), so
  **no E2E spec covers the post-launch state.** Accepted as-is unless someone adds one. Ticked
  because this is a verified state, not an outstanding task — the gap it names is deliberate.

## 7. Known defects — ALL FOUR FIXED

Read on `origin/main` 2026-09-29 and **all four closed the same day by `d5e261459`**, "fix(tokens):
four pre-launch defects". Re-verified against `b85cdfb15`; 53 tests across the three suites that
commit added pass. The paths below are the real ones — the original entries shortened them and two
did not resolve (`app/api/leagues/[leagueId]/...`, not `app/api/...`).

- [x] **Storylines charge tokens with no confirmation.** Both routes now read the flag from the body
  (`drama/tell-story/route.ts:86`, `story/create/route.ts:73`: `body.confirmTokenSpend === true`)
  instead of hardcoding `true`, and **`eventId` is validated first** — `:73-76` rejects a missing
  id with a 400 and loads the event *before* `requireFeatureEntitlement` at `:81`, so a bad request
  now costs nothing. Covered by `__tests__/tokens/storyline-token-charge.test.ts`.
- [x] **Survivor AI panel can never spend tokens.** `SurvivorAIPanel.tsx:9` now goes through
  `postWithTokenConfirm` from the new `lib/tokens/clientTokenConfirm.ts`, which posts once without
  confirming and only re-posts with `confirmTokenSpend: true` after the person is told the cost.
  Covered by `__tests__/tokens/client-token-confirm.test.ts`.
- [x] **Survivor command-centre token prices are wrong on screen.** Fixed by **deriving** rather
  than correcting: `survivor-ai-token-catalog.ts:76` now reads
  `getTokenSpendRuleMatrixEntry(row.ruleCode)?.tokenCost ?? null`, so the screen cannot disagree
  with `pricing-matrix.ts` again. Re-typing the right numbers would have left the same trap.
  Covered by `__tests__/survivor/survivor-ai-token-catalog-prices.test.ts`.
  - The old "does a DB override change the charge: UNVERIFIED" no longer matters for the *display*,
    because the display now reads the same source the charge does.
- [x] **Chimmy's orchestration fallback prints raw `key: value` payload pairs.**
  `orchestration-service.ts:304-319` now names only the *kinds* of context on hand, in words, and
  never a value. The two strings the outage runbook and `providerOutageAlert` match on are kept
  verbatim, which was the constraint the original entry flagged.

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
