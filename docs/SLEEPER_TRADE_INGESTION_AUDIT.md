# Sleeper Trade Ingestion — Pending Trade API Audit

**Status:** API audit only. No database writes made (staging or production), no imported Sleeper trade was written into any calibration table, no code changed.
**Branch:** `g15-event-foundation`
**Goal:** Determine whether Sleeper's public API exposes enough trade proposal/outcome data to feed Decision OS trade-learning in staging, before any ingestion code is written.
**Test source:** the connected Sleeper account `theciege24` (`user_id: 591462610482806784`) — confirmed to match the one `LegacyUser` row of that username already present on staging, and the account behind the previously-imported "KBI Smoke Black" league (Trade Learning Phase F.0). No other Sleeper account was linked to the session's known app-user email (`allfantasysportsapp@gmail.com`) on staging, so this real, already-known-to-the-platform account was used instead.

---

## 1. Sleeper endpoints audited

All calls below are unauthenticated `GET` requests against Sleeper's public REST API (`https://api.sleeper.app/v1`) — no API key, no write capability exists on this API at all. Nothing in this list touches our own database.

| Endpoint | Purpose | Result |
|---|---|---|
| `GET /user/{username}` | Resolve username → `user_id` | Real: returned `user_id: 591462610482806784`, matching staging's `LegacyUser.sleeperUserId` exactly |
| `GET /user/{user_id}/leagues/nfl/{season}` | List all of a user's leagues for a season | Real: 53 leagues for 2026, 60 leagues for 2025 |
| `GET /league/{league_id}` | League settings, scoring rules, roster slots, veto config | Real: full `scoring_settings`, `roster_positions`, `settings` (including `veto_votes_needed`) confirmed present per league |
| `GET /league/{league_id}/rosters` | Roster ID → owning `user_id` | Real: confirmed working for a real trade's `roster_ids` |
| `GET /league/{league_id}/users` | `user_id` → `display_name` | Real: confirmed working, cross-verified `591462610482806784 → TheCiege24` |
| `GET /league/{league_id}/transactions/{round}` | All transactions (trade/waiver/free_agent) for a given week/round | Real: this is the only trade-transaction endpoint Sleeper exposes — queried per week/round, 1–18 |
| `GET /players/nfl` | Full player directory (id → name/position/team) | Real: 12,200-player static directory, downloaded and cross-checked against 5 real player IDs from real trades — all resolved correctly |

**No separate "pending trades" or "proposed trades" endpoint exists.** Pending/proposed trade visibility, where it exists at all, comes from the *same* `transactions/{round}` endpoint's `status` field (`complete` | `pending` | `failed`) — there is no dedicated pending-trade feed to poll.

---

## 2. Real league/trade counts from the connected account

**Leagues available:** 113 total (53 for 2026, all `pre_draft` except 25 `in_season`/2 `drafting`; 60 for 2025, all `complete`).

**Leagues actually sampled this pass:** 31 unique leagues — a deliberate sample, not an exhaustive sweep of all 113 (see §7 for why this is the right scope for an audit). Two passes:

1. **First pass (11 leagues, full 18-week check):** 5 in-season 2026 dynasty leagues + 6 complete 2025 leagues (including the exact "KBI Smoke Black" league already partially represented on staging). Found **81 real trade transactions**, all `status: complete`.
2. **Second pass (25 in-season 2026 leagues, weeks 1–3 checked):** confirmed the first pass's finding that offseason dynasty-league trade activity is entirely captured within the earliest week/round bucket (the 5 leagues that overlap between passes returned identical counts checking only weeks 1–3 vs. the full 18-week check) — found **195 real trade transactions total** across these 25 leagues (166 new, 29 already counted in pass 1), all `status: complete`.

**Total unique real trade transactions found across 31 unique leagues: 247.**

This is real, live data pulled directly from Sleeper's production API during this session — not a synthetic sample.

---

## 3. Pending trades: visible in principle, not observed in this sample

The `status` field on a trade transaction is a real, live enum (`complete`/`pending`/`failed`), and 24 of the 25 sampled leagues have `veto_votes_needed` configured (values 2–8), meaning a trade review/veto window genuinely exists in these leagues' rules. **Despite that, zero of the 247 real trade transactions found in this sample were in any status other than `complete`.**

This is an honest, load-bearing finding, not an assumption: pending-trade capture via this API is real and structurally supported, but is a **transient state** — a trade only appears as `pending` while it sits inside an active veto window, which in practice (at least across this account's real leagues, at this moment) resolves fast enough that a single snapshot essentially never catches one. Reliably capturing pending trades would require either (a) frequent/continuous polling rather than a one-time audit sweep, or (b) accepting that most Sleeper leagues' effective veto windows are short enough that "pending" is rarely the observed state for any given trade at rest.

---

## 4. Completed trades: fully usable, every required field reconstructs correctly

| Required field | Source | Verified? |
|---|---|---|
| Assets sent | `drops` object (`player_id → losing roster_id`) + `draft_picks[].previous_owner_id` | ✅ Confirmed on real trades |
| Assets received | `adds` object (`player_id → gaining roster_id`) + `draft_picks[].owner_id` | ✅ Confirmed on real trades |
| Managers involved | `roster_ids`/`consenter_ids` on the transaction, joined through `/rosters` (roster_id → owner user_id) then `/users` (user_id → display_name) | ✅ Confirmed end-to-end: roster_id 1 → `591462610482806784` → `TheCiege24`, the exact known account |
| Timestamp | `created` (proposal time, epoch ms) **and** `status_updated` (resolution time, epoch ms) — both present on every real trade sampled | ✅ Confirmed — this is exactly the (proposed-at, resolved-at) pair `TradeOfferEvent`/`TradeOutcomeEvent` already models |
| Outcome | `status` field | ✅ Present on every trade; only `complete` observed this pass (see §3) |
| League scoring/settings context | `scoring_settings`, `roster_positions`, `settings` via `GET /league/{league_id}` | ✅ Confirmed present and real per league — necessary to correctly value assets in that league's specific format (SuperFlex, TEP, dynasty vs. redraft) |
| Player identity | `/players/nfl` directory | ✅ Confirmed — 5 real player IDs from real trades (`Rome Odunze`, `Jacoby Brissett`, `Garrett Wilson`, `Tory Horton`, `Travis Etienne`) all resolved correctly against the 12,200-entry directory |
| Draft-pick identity | Embedded directly in `draft_picks[]` (`round`, `season`, `roster_id`, `owner_id`, `previous_owner_id`) | ✅ No extra lookup needed — richer than our own `AfLeagueTradeItem`'s pick metadata in one respect (explicitly carries `previous_owner_id`, useful for multi-hop trade-chain reconstruction) |
| FAAB | `waiver_budget` array (empty in every sample seen, but the field exists and is structured for this) | ✅ Present, schema supports it, simply unused in this particular sample |

**Conclusion: every field this platform's trade-learning schema needs is present, real, and cross-verified for completed trades.** This is not a schema-shape guess — every mapping above was checked against real data from real Sleeper leagues this session.

---

## 5. Critical distinction: this is replay data, not calibration data

This is the single most important finding of this audit, and the reason for this document's recommendation in §6.

Decision OS's trade-learning calibration loop (`computeShadowB0()`/`promoteShadowB0()`, see `docs/TRADE_LEARNING_CAPTURE_ARCHITECTURE_ADR.md`) is built on **paired** data: a real `TradeOfferEvent` (our own model's predicted acceptance probability, shown or computable at proposal time) linked via `offerEventId` to a real `TradeOutcomeEvent` (what actually happened). The calibration math corrects our model's intercept by comparing our own prediction against the real outcome.

**A Sleeper-imported historical trade has no such pairing.** The trade happened entirely on Sleeper's own platform, using Sleeper's own trade UI, with zero exposure to AllFantasy's acceptance-probability model at the time the decision was made. There is no "our model predicted X, the manager then decided Y" moment to calibrate against — only "a trade occurred, with this final shape." Feeding these into the same `TradeOfferEvent`/`TradeOutcomeEvent` tables the live capture pipeline writes to (per `docs/TRADE_LEARNING_CAPTURE_ARCHITECTURE_ADR.md`) would silently corrupt the calibration signal: `computeShadowB0()` would be comparing a *retroactively computed* prediction against a real outcome the model never actually influenced, which is a fundamentally different (and weaker) validation claim than what the live-capture pipeline's real strength currently rests on.

This is exactly why this task's own scope explicitly forbids treating Sleeper-imported trades as native `LIVE_PROPOSAL` events — that constraint is correct, not just cautious.

---

## 6. Recommendation: imported replay data, for backtesting — not staging-training data, not diagnostics-only, not unusable

| Option | Verdict | Why |
|---|---|---|
| **Imported replay data** | ✅ **Recommended primary use** | Run each real historical trade through the existing, unmodified deterministic trade-engine (`computeTradeDrivers()` + `calibrateAcceptProbability()`) *retroactively*, using that league's real scoring settings, and compare our model's backtested prediction against the real, known outcome. This is genuine, valuable model validation — "how would our model have scored real decisions real managers actually made" — without ever touching `calibratedB0`/`shadowB0`. |
| Staging-only training data (i.e., feed directly into the calibration loop) | ❌ **Not recommended** | Per §5 — would corrupt the calibration signal by presenting a retroactive prediction as if it were a real, exposed-at-decision-time one. |
| Diagnostics-only data | Partially — this audit itself is exactly that use | Confirming API shape and data completeness (this document) is a legitimate, already-completed diagnostics use. Beyond that, treating the data as *only* diagnostics undersells its real value for backtesting (above). |
| Not usable | ❌ Incorrect | Every required field reconstructs correctly (§4) — the data is real, complete, and usable; the constraint is about *which* system it should feed, not whether it's good enough to use at all. |

### Recommended ingestion architecture

1. **A new, clearly-separate table** — not `TradeOfferEvent`/`TradeOutcomeEvent`, and not the existing `TradeOfferMode` enum's values (`INSTANT`/`STRUCTURED`/`TRADE_HUB`/`TRADE_IDEAS`/`PROPOSAL_GENERATOR`/`LIVE_PROPOSAL`), all of which describe *our own* proposal/evaluation-tool modes, none of which fit "a trade that happened natively on a third-party platform, imported after the fact." A dedicated `SleeperTradeReplay` (or similarly named) table keeps this data provenance-honest and structurally incapable of being accidentally queried by `computeShadowB0()`'s existing `WHERE offerEventId IS NOT NULL` filter.
2. **Ingestion shape, per league:** `GET /league/{id}` (scoring/settings context, fetched once) → `GET /league/{id}/rosters` + `/users` (identity mapping, fetched once) → `GET /league/{id}/transactions/{week}` for each week (the only real per-trade fetch) → resolve player IDs against a locally cached copy of `/players/nfl` (refreshed periodically, not re-fetched per trade — it is a ~14.6MB static blob, not something to pull per request).
3. **Backtest, don't calibrate:** for each imported trade, run it through the existing, unmodified deterministic engine using that league's real scoring context, store the backtested prediction *alongside* (never merged into) the real outcome, in the new replay table.
4. **Pending trades:** given §3's finding, do not build a one-shot "check for pending trades" feature on the assumption pending trades will reliably be there to find — if pending-trade visibility is ever wanted, it requires a recurring poll, not a single ingestion pass.
5. **Rate/scale awareness:** 113 real leagues × up to 18 weeks each is a few hundred to roughly 2,000 real API calls if ever run exhaustively — reasonable for a background job, not a synchronous request; this audit's own scripts paced calls at ~50ms apart with zero errors.

---

## 7. Why 31 leagues, not all 113

This audit's goal was to determine *whether the data is good enough to build on*, not to import every trade this account has ever made. 247 real, fully-reconstructable trade transactions across 31 real leagues is more than sufficient evidence to answer that question conclusively (§4, §5) — checking the remaining 82 leagues would add volume, not new information about data shape, completeness, or the pending-trade finding. If a future ingestion phase needs a full historical corpus, that's a separate, larger job the recommended architecture in §6 already scales to.

---

## Deliverable summary

1. **Endpoints audited:** `/user/{username}`, `/user/{user_id}/leagues/nfl/{season}`, `/league/{id}`, `/league/{id}/rosters`, `/league/{id}/users`, `/league/{id}/transactions/{round}`, `/players/nfl` — all real, all confirmed working, no dedicated pending-trade endpoint exists.
2. **Real counts:** 113 leagues available (53 for 2026, 60 for 2025); 31 sampled this pass; 247 real trade transactions found, all `status: complete`.
3. **Pending trade visibility:** structurally supported by the schema (`status` field), **not observed** in this real sample despite 24 of 25 sampled 2026 leagues having an active veto/review window configured — a transient-state finding, not a schema gap.
4. **Completed trade usability:** fully usable — every field required to reconstruct assets sent/received, managers involved, timestamps, outcome, and league scoring context was independently verified against real data this session.
5. **Recommended ingestion architecture:** a new, dedicated `SleeperTradeReplay`-style table, explicitly separate from `TradeOfferEvent`/`TradeOutcomeEvent` and never written to via the `LIVE_PROPOSAL` mode, used for retroactive backtesting of the existing deterministic model against real historical outcomes — not fed into the live calibration loop.
6. **Next implementation prompt** (for a future, explicitly-approved phase):
   > "Decision OS — Sleeper Trade Ingestion Phase 2: Build the read-only backtest ingestion pipeline. Per `docs/SLEEPER_TRADE_INGESTION_AUDIT.md` §6: add a new, additive `SleeperTradeReplay` Prisma model (hand-authored migration, not deployed until explicitly approved), a service that pulls real trade transactions for a given Sleeper user/league set and resolves them into this new table (player/pick/manager identity fully resolved, league scoring context captured per trade), and a backtest function that runs each imported trade through the existing, unmodified `computeTradeDrivers()`/`calibrateAcceptProbability()` pipeline and stores the backtested prediction alongside the real outcome — never writing to `TradeOfferEvent`/`TradeOutcomeEvent`, never touching `calibratedB0`/`shadowB0`. Do not enable weekly recalibration. Do not deploy the migration to staging without explicit approval, matching every prior real-database phase in this workstream."

No calibration math, thresholds, or recommendation logic was changed. No database (staging or production) was written to. No imported Sleeper trade was treated as a `LIVE_PROPOSAL` event. `TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED` remains unset everywhere.
