# AllFantasy — Trade Unification Build Brief (P0 + Convergence Slice 1)

Date: 2026-08-08 (updated 2026-08-09)
Status: Phases 0, 0.5, 1 and 2 (instrumentation) EXECUTED — commit pending — Phase 3 flips await shadow telemetry

**Phase 0.5 outcome (2026-08-09):** simulate-counter gated (session 401 / league-scoped membership 403 / rate limit 429 — no UI regression: the caller integration was already inert, request+response shapes both mismatched); route-inventory test now asserts auth wiring on allowlisted routes; weekly-awards + morning-briefing crons added to all THREE keep-lists (they were scheduled in vercel.json but excluded from the build — 404ing on every scheduled run; fourth instance of the #284 class); stale-module notes added to both waiver shadow-compare docs.

**Slice 2 outcome (2026-08-09): Keeper honesty + Draft VORP.**
- Keeper: `/api/keeper/ai/trade-analysis` now returns an honest 501 `coming_soon` (pointing to the real Keeper War Room analyzer) instead of hardcoded B/B/counter; the placeholder `lib/keeper/ai/keeperTradeAnalyzer.ts` is deleted. Telemetry keeps measuring demand (`surfaceAnalysisMode: 'coming_soon'`).
- Draft VORP: `computeDraftPlayerRankings` now computes real replacement value (Value Over Next Available — best same-position projection likely available at the manager's next turn, window = totalTeams picks) from pool projections, with an ADP-gap tier-cliff fallback for positions lacking ≥3 real projections. Rollout via `DRAFT_VORP_MODE`: `observe` (DEFAULT — fields exposed on every ranking row, totalScore bit-identical to pre-VORP), `active` (vorpScore clamp(vorp×0.3, −8, 30) + tierDropoffScore clamp((gap−4)×0.6, 0, 12) join totalScore), `off`. Projections threaded from the draft-room pool (`nflDraftProjectionSplits.projectedPoints`) through client → `/api/draft/recommend` + live-brain payload. Evidence lines surface replacement value / tier cliffs in recommendations immediately (all modes except off). Flip to `active` after observing sane vorp distributions in ranking rows.

**Slice 3 outcome (2026-08-09): Player Command Center backend.**
- `lib/shared-services/league-hub/playerUrgency.ts` — pure, deterministic per-league urgency (critical/high/medium/low/none) from injury severity × lineup exposure × real kickoff time pressure (imminent <2h / today <36h) × existing recommendation priority. Honest nulls when schedule unknown; past kickoffs apply no pressure.
- `app/api/player-command-center/route.ts` — the portfolio's FIRST live consumer. Session-derived (401), rate-limited, filters (q/sport/provider/playerId/urgentOnly), urgency-sorted. One search answers: every league where the player matters, what changed, time left, best action per league.
- Chimmy: no-league conversations now ground in the cross-league summary (`getChimmyCrossLeaguePlayerSummary` → `crossLeague` section in the compressed system prompt: injured/bye/overexposed/action-needed). Timeout-guarded (1.2s), additive — failure degrades to prior behavior.
**Slice 4 outcome (2026-08-09): Command Center complete (v1).**
- `waiverWorldState.ts` — per-league waiver world from REAL models only (LeagueWaiverSettings / LeagueWaiverState / Roster / WaiverClaim): claim mode (faab/priority/first_come), FAAB budget+remaining, priority, last/next run, processing lock, user's pending claims, ranWithinLastDay. Result-level `waiverWorldByLeague` on the portfolio.
- Projections: portfolio items now carry the latest real weekly `FantasyProjection` row (highest week, then freshest fetch; same table the war rooms read; multi-provider-id lookup like injury). Honest null when absent.
- UI: `/player-command-center` — two-layer design. Layer 1: player, injury badge, exposure, projection, time-to-lock, urgency badge, "N need action". Layer 2 (expand): per-league cards with roster slot, urgency reasons, record, waiver line (FAAB/priority/next run/pending claims), stale-data warnings. Needs-action filter, empty states, no fabricated data anywhere.
**Slice 5 outcome (2026-08-09): discoverability + replacement options.**
- Nav: "My Players" added to desktop GLOBAL_TABS (mobile bottom bar is full at 5 — untouched).
- `replacementOptions.ts` — for one affected player in one league: best bench alternative (user's own roster, same position) + best unrostered players (top projected non-rostered ids, identity via SportsPlayer sleeperId/externalId), each with real projection delta vs the affected player. Latest FantasyProjection week; honest `limitation` reasons (`no_projection_data`, `no_user_roster`) when structure prevents an answer.
- `/api/player-command-center/replacements` — session + assertLeagueMember + rate limit; portfolio appearances now expose the raw provider `playerId` the endpoint keys on.
- UI: action-required league cards get a lazy "Show replacement options" panel (bench chips + best-available chips with +/− deltas, week label).
**Slice 6 outcome (2026-08-09): daily-sport schedule adapters.**
- `lib/decision-os/world/nextGameSchedule.ts` — next-game projection for daily-cadence sports: next tip/first-pitch/puck-drop per team (kickoff ≥ now), home/away, opponent, 7-day schedule density, provenance/freshness. Reads the SAME persisted caches (`loadScheduleGameRows` → FantasyScheduleGame/GameSchedule); pure projection with injected `now`; rows without kickoff timestamps are warned about, never guessed.
- Portfolio: NBA/MLB/NHL join the schedule-capable set via the next-game model (byeWeek honestly null — not a daily-sport concept); NFL keeps the week/bye path untouched. `unsupportedSports` now = neither set. Schedule shape gains `gamesNext7Days`.
- Urgency works for daily sports automatically (time pressure keys off nextGameAt). UI shows "N games next 7d" density chip.
**Slice 7 outcome (2026-08-09): claim deep-links — "Best available" chips are actionable.**
- `resolveClaimTarget` (replacementOptions.ts): platform → claim surface. Native/manual leagues → `/waiver-wire?leagueId=` (AllFantasy's own claim flow); Sleeper → provider players page (see-and-advise: we link, never execute on imported leagues); other platforms → honest `none`.
- Waiver wire page/client accept `playerId` preselect: the deep link lands with the claim panel already open for that player (only when they're really in the pool).
- Command Center: "Best available" chips are links — native shows "(tap to claim)", provider shows "(opens sleeper)", plain chips otherwise. Bench chips stay informational (a bench swap is a lineup action, not a claim).
**Slice 8 outcome (2026-08-09): Chimmy consumes replacement options.**
- League-scoped Chimmy conversations that mention a player the user rosters now attach the SAME replacement engine output the Command Center serves (exact full-name match against the user's roster only — never fuzzy; timeout-guarded; any miss degrades to prior context unchanged).
- New REPLACEMENT OPTIONS prompt section renders real deltas + hard instruction ("cite these numbers, do not invent alternatives"), the claim-surface note (native waiver wire vs advise-only provider league), and an honesty instruction when no projection data exists.
- This completes the convergence pattern for this feature family: Command Center UI, API, and Chimmy prose all answer "who should I start/pick up instead?" from ONE deterministic engine.
**Slice 9 outcome (2026-08-09): bench-swap links + NCAAF unblocked + SportsGame wiring gap closed.**
- Bench chips now link: native → the league's own Team tab (`/leagues/[id]?tab=Team`, hint "open your lineup"); Sleeper → provider team page. `resolveLineupTarget` mirrors the claim-target contract.
- **Real wiring gap found & closed:** `syncAPISportsGamesToDb` (the NFL/NCAAF api_sports schedule sync) writes `SportsGame` — a table NO schedule consumer ever read. SportsGame joined the schedule read port; weekless rows keyed by kickoff time instead of being dropped (weekly dedupe semantics unchanged; weekless rows without timestamps stay excluded — nothing could consume them without guessing).
- **NCAAF live:** new weekly cron `/api/cron/import-schedules?sport=NCAAF` (route already kept; test strips query strings) + NCAAF added to the week/bye schedule set. College football players in the Command Center now get real schedule/bye context once the first sync runs.
- SOCCER + NCAAB added to the next-game capability set — the CODE path is ready; both degrade honestly (`schedule_unavailable`) until an ingestion source writes their rows. Soccer ingestion remains the true blocker (WIP branch exists: claude/soccer-ingestion-normalization).
- Passing brand fix: lineup-optimizer metadata no longer uses the word "AI".
- Backlog is now EMPTY for this feature family. Next frontier: Phase 3 trade flips (needs shadow telemetry) and Draft VORP activation (env flip after observe window).

**Slice 10 outcome (2026-08-09): the flip-readiness path is built end to end.**
- **Console: skips → REAL parity.** `consoleShadowCompare.ts` re-grades the console's own enriched assets through the canonical value engine (`buildTradeValueSnapshot`→`gradeTrade`) and compares verdicts (agreement uses the grader's own ≥88 even-trade boundary). Emitted as `ran: true, reason: value_engine_compare` — the sample stream the 95%/50 gate counts. Works for global (league-less) analyses too, since the value engine grades assets, not rosters.
- **Draft: first production caller for `shared-services/draft`.** `/api/draft/recommend` runs `evaluateDraftShadow` fire-and-forget behind `DECISION_OS_DRAFT_SHADOW` (default OFF), emitting `manager.draft.pick` parity (shared-service top pick vs live engine top pick + confidences). The dead scaffolding now has a live consumer.
- **Visibility: `/api/admin/decision-os/parity-readiness`** — per decision-type/surface: comparisons, agreement rate, skip-reason breakdown, and the gate verdict (ready / accumulating / no_signal; params minComparisons/minAgreementRate). Same double admin gate as the raw telemetry route; dev/staging surface by design (prod windows come from log drains).
- Flip flow is now: enable `DECISION_OS_TRADE_SHADOW_CONSOLE` (+`DECISION_OS_DRAFT_SHADOW`) → traffic accumulates comparisons → parity-readiness says "ready" → flip the surface live.

---

## Honesty pass (Slice 11, 2026-08-09) — stop stating things that aren't true

A four-agent correctness audit found the system emitting confident, real-looking numbers derived from missing data. Tier-0 fixes landed:

1. **Grader refuses to grade at zero data.** `gradeTrade` previously computed `|0−0| / max(0,0,1)` → `fairnessScore 100` → **"A+ / within normal market range"**, with `reviewRecommended: false`. Now returns `insufficientData: true`, `grade: null`, `fairnessScore: null`, and **`reviewRecommended: true`** (ungradeable ≠ approved). `TradeGrade.grade`/`fairnessScore` and `CommissionerReview.fairnessScore`/`similarValueRange` are now nullable. `snapshotToEvaluation` returns `leanedTo: null` + `unsupportedReason: 'insufficient_value_data'` instead of asserting 'even'. `consoleShadowCompare` returns a null advantage/agreement so ungradeable trades can't manufacture parity agreement.
   - DB note: `RedraftTradeValueSnapshot.grade/fairnessScore` are non-nullable columns, so an ungradeable capture writes sentinel `'NOT_GRADED'` / `0` (fails toward *review*, not approval) and logs a warning; `payload` carries the truthful nulls. **Follow-up: additive migration to make those two columns nullable and drop the sentinel.**
2. **No more fabricated $1,200 player value.** `sportsRecordToPricedAsset` returned a hardcoded `1200` (then derived "impact" and "vorp" from it) for any player without dynasty value or projection — which is most non-NFL players, making every player identical and every trade "even". Now returns `null`; the caller records a real `dataGaps` entry naming the player.
3. **No more invented FAAB budget.** Waiver wire seeded `$100` and used `||`, which also swallowed a genuine `$0`. Balance is now `number | null` (nullish-coalesced), renders "unavailable", skips client-side validation when unknown (server remains authority), and hides the max-bid shortcut.
4. **Synthetic ADP can no longer speak as market data.** `getAdp` falls back to `overall + 20`; that prior still orders the board, but rows now carry `adpIsReal`, and reach/value warnings, "good value vs ADP" reasons, the "Market edge" evidence line, and Live Draft Brain's reach/value notes are suppressed when it's synthetic ("Market edge: unavailable — no ADP data for X"). Real ADP behavior is unchanged.

Verification: 54/54 across the honesty, VORP, console-compare, urgency, replacement, schedule and prompt suites + scoped tsc clean.

## Honesty pass part 2 (Slice 12) — verdicts come from engines, not prose

1. **`/api/ai/matchup-preview` no longer invents win probability.** It asked the model for `winProbability` from a snapshot of player NAMES and partial points. Win probability is a simulation output: it's now read from `MatchupSimulationResult` (real `winProbabilityA/B` + expected scores), the model is explicitly barred from emitting any odds, and any model-produced value is **deleted** rather than used as fallback. Response carries `winProbability: number | null` + `winProbabilitySource: 'simulation' | 'unavailable'`. When no simulation exists the route says so instead of guessing.
2. **`/api/ai/trade-analysis` is deterministic-first.** It returned Win/Loss/Fair from a raw LLM call with no valuation at all. Now `runTradeAnalysis` (the same engine behind `/api/trades/analyze`) produces verdict + fairness; the model only writes `shortTerm`/`longTerm`/`recommendation` prose ABOUT that verdict, its `verdict`/`fairness` keys are stripped, and fields are tagged (`verdictSource: 'deterministic_engine'`, `narrativeSource: 'ai'`). Engine failure → honest 422, never a guessed verdict. Prose failure → the real verdict still returns, narrative `unavailable`.
3. **`/api/ai/waiver-recs` states its basis.** Inputs here are genuinely real (the manager's roster + Sleeper's real trending adds) but contain **no projections**, so it now declares `basis: 'roster_composition_and_league_trending_adds'`, `usesProjections: false`, and explicit `limitations`; the model is barred from stating projected points, ranks, target shares or snap counts. FOLLOW-UP: route through the Decision OS waiver engine once Sleeper↔FantasyProjection id namespaces are reconciled (attempting that join today silently matches nothing — a known wrong-row-join defect).
4. **Chimmy grounding gate closed**, and extracted to `lib/agents/leagueGroundingGate.ts` so the rules are unit-tested rather than only inspectable: `draft_help` is no longer exempt; the keyword pattern now catches add/drop/claim/pick up/keep/flex/cut/stash/sell/buy low/"should I"/"who should"; `draft`/`roster` join the source markers; and **a players-only context no longer counts as league grounding** (it was truthy, so `!structuredFantasyContext` let ungrounded team advice through whenever the league row failed to load). General strategy questions still pass through ungated.

Verification: 62/62 across all closure suites + scoped tsc clean.

## Slice 13 — the flip gate can finally see the whole product

The Phase 3 gate shipped measuring FOUR surfaces while the highest-traffic trade experience was invisible to it: the Nocturne dashboard's "Trade Analyzer" and "Waiver Assistant" tiles route into `/af-legacy`, not the console. A gate that reports "ready" on a sample excluding the surface most users touch is worse than no gate.

- **Taxonomy extended 4 → 10 surfaces:** `legacy` + `warroom_{redraft,dynasty,keeper,bestball,guillotine}`. Flags: `DECISION_OS_TRADE_SHADOW_LEGACY`, and one shared `DECISION_OS_TRADE_SHADOW_WARROOM` (they share a verdict rule, but stay distinct surfaces because they use different value bases, so each converges on its own). All default OFF. `ALL_TRADE_SURFACES` is exported for coverage enforcement.
- **Legacy instrumented with REAL parity, for free.** Legacy already computes `runTradeAnalysis` (`engineAnalysis`) and then *ignores* it — the grade users see is the LLM's, constrained by FantasyCalc. Both verdicts exist at the same point in the handler, so we now compare them: legacy's Team-A-perspective verdict vs the deterministic engine's. Nothing about the response changes.
- **All five war rooms instrumented through ONE helper** (`warRoomShadow.ts`) rather than five copy-pasted call sites — these engines already demonstrated drift risk with five byte-identical `adpToValue` copies. War rooms don't run the canonical engine, so these record as structured observations (verdict + value delta), which is what makes their divergence measurable at all; wiring a canonical counter-evaluation into them is the convergence step that follows.
- **`needs_more_data` abstentions never count as agreement.** `buildSurfaceParity` returns `agreement: null` whenever either side abstained — otherwise honest abstentions would inflate the flip gate toward a false "ready".
- **Coverage is now test-enforced** (`trade-surface-coverage.test.ts`): every surface in the taxonomy must have a flag AND real instrumentation at its route, and the call-site map must match the taxonomy exactly. Verified against the live tree: 10/10 instrumented.

Verification: 13/13 new + existing decision-os suites, scoped tsc clean, and a direct 10/10 coverage check against the real routes.

## Slice 14 — legacy converges onto the canonical grade

**Blocker found first:** `AssetValueSnapshot.sources.fantasyCalcValue` has always been on the contract but was hardcoded `null` at *every* write site ("deferred"), and `normalizedPlayerValue` never read it. The canonical engine could only price assets carrying a **projection** — and af-legacy runs entirely on **FantasyCalc**. Converging legacy naively would have priced every player at 0 → (post slice-11) `insufficientData` → "not graded" on the product's busiest surface. A catastrophic regression dressed as convergence.

- **Market-value basis completed** (`valueEngine.ts`): `marketValue` is used as the value basis *only* when no usable projection exists. Positional scarcity is deliberately **not** re-applied (FantasyCalc already embeds positional market demand — applying scarcity again double-counts it), and the scale matches by construction since this module's 0–10000 range follows the FantasyCalc convention. Strictly additive: with a projection present the output is byte-identical (test-pinned).
- **`legacyCanonicalGrade.ts`** builds canonical `EnrichedTradeAsset`s from legacy's own FantasyCalc map + the canonical pick curve, runs `buildTradeValueSnapshot` → `gradeTrade`, and renders the result in legacy's exact verdict vocabulary using the grader's OWN bullet thresholds (≥88 Fair, ≥65 Slightly, else Strongly) so grade and verdict can never disagree.
- **Direction convention pinned by test.** `buildTradeValueSnapshot` sums assets by `fromRosterId` (what a side SENDS), so `valueDifference > 0` means Team A gave more away → favors **B**. The `TradeGrade.valueDifference` doc comment claims the opposite; **the code is authoritative** and is now guarded by explicit direction tests in both directions.
- **Rollout:** parity is recorded always (canonical vs legacy LLM grade). `DECISION_OS_TRADE_LIVE_LEGACY=true` makes the canonical grade what users see; default OFF. **Never overrides on `insufficientData`** — a working surface is never blanked. Response always carries `gradeSource: 'canonical_value_engine' | 'legacy_llm_fantasycalc'`.

Verification: 81/81 across every closure suite (the market-basis change regressed nothing) + scoped tsc clean.

## Slice 15 — wrong-row joins: stop binding the wrong athlete

Real pools contain genuine name collisions across positions and sports (QB Josh Allen vs LB Josh Allen). Several joins bound by lowercased NAME alone and took the first hit, so one athlete's injury, projection, or market value could be attached to another — silently, with full confidence downstream.

- **New `lib/player-match/verifiedNameMatch.ts`** — pure, in-memory counterpart to the DB-backed `player-identity` resolver. Index candidates by normalized name (case/accents/punctuation/generational suffixes; `A.J. Brown` ≡ `AJ Brown`), then require POSITION and/or TEAM agreement and **refuse the bind when still ambiguous**. Refusing is the point: a missing injury badge is a gap, the wrong player's injury badge is a false statement.
- **Missing `sport` filters added** to three injury joins that could match another sport's athlete: `userOsContext.ts` (lineup injuries — every sibling query was already scoped), `getCanonicalPlayer.ts` (API-Sports ids are NOT globally unique across sports), `league-rankings-v2.ts` (also name-keyed; now sport-parameterized with an honest NFL default for this Sleeper-only path).
- **`findPlayerByName` (fantasycalc) no longer takes the first substring hit.** It feeds trade valuation, waiver scoring and player outlook. Now: exact matches disambiguate by position/team hints, a substring match is accepted **only when unique**, and ambiguity returns null. Backward compatible for unique names (the overwhelming majority).
- **Projection-enrichment joins verified** at all three sites — the root (`resolveNormalizedPlayerSportsProfiles`, where the mis-bound row also *supplied* position/team/stats downstream) plus both consumers (`tradeProjectionEnrichment`, `waiverProjectionEnrichment`). All three had position/team in hand and were discarding it.
- **Draft-board name-only injury tier now refuses collisions.** The id → name+team → name-only ladder kept its first two tiers; the last tier tracks colliding names and binds nothing for them instead of "first wins".

Verification: 94/94 across every closure suite + scoped tsc clean.

## Slice 16 — the last four audit items

1. **Acceptance probability was mostly a constant.** Four of its six features (`ldiAlignment`, `needsFitScore`, `archetypeMatch`, `dealShapeScore`) have **no producer anywhere in the codebase**, and each silently defaulted to `50` → a fixed `+11.0` added to `z` against an intercept of `-4`. Two thirds of the "model" was an offset that inflated every result, presented as a per-trade percentage. Now: missing features are `null` and are **excluded from `z`** (no fabricated midpoint), and the result carries `featureCoverage` / `missingFeatures` / `degraded`, surfaced on the legacy API payload. Real inputs for these features do exist in `lib/engine/acceptance.ts` — routing this model onto them is the follow-up.
2. **Draft war room: the model no longer overrides the engine.** It used to overwrite the deterministic `risk` label and replace `alternatives` with players of its own choosing, while stamping a single object-level `provider` — so nothing downstream could tell `bestPick`/`confidence` (engine) from `risk`/`alternatives` (model), and a "risky" board badge could contradict the engine's own confidence. Now `risk` stays deterministic, `riskNote` may be model prose, and `alternatives` may be **reordered but must be a subset** of the engine's ranked alternates. Added per-field `fieldSources` provenance.
3. **Scoring-settings-aware valuation.** `POSITION_SCARCITY` is tuned for standard 1-QB redraft and was the only market the engine could express — Superflex QBs and TE-premium TEs were graded against the wrong one. `scoringScarcityMultiplier` now adjusts for superflex/2QB (2QB strictly stronger), TE premium (capped), and PPR/half-PPR pass-catcher lift. Threaded through `buildTradeValueSnapshot`. **Defaults to exactly 1.0**, so leagues supplying no scoring context are valued byte-identically to before. The market-value fallback basis is deliberately not lifted (market values already embed the market).
4. **Knowledge graph verified: it has NO writers.** `SignalIngestionService` / `TradeSignalHook` / `WaiverSignalHook` are referenced by nothing outside their own package and tests, so every read resolves against an empty store and manager-behavior/player-exposure profiles are permanently unavailable. Not a correctness bug — live consumers already degrade honestly (`status: 'unavailable'` + a real uncertainty line) — but a capability gap that must not be silently built upon. Documented prominently at the read boundary (`QueryService`) with what it would take to make it real.

Verification: 113/113 across every closure suite + scoped tsc clean.

## Slice 17 — AllFantasy could not see trades that already existed

A user had live pending trades sitting in two Sleeper leagues. The AF Trades tab for those same leagues read **"Active Trades 0."** Not a display bug — the app had genuinely never heard of them: the league importer never calls Sleeper's `/transactions/` endpoint, and the Trades panel read only `AfLeagueTrade` (AF-native proposals). Every downstream promise — grade it, counter it, tell me if it's fair — was unreachable for the trades users most wanted analyzed, because the offer was invisible to the system.

New `lib/provider-trades/scanPendingSleeperTrades.ts` scans provider transactions and projects each one **from the viewer's roster perspective**. Wired into `/api/league/trades-panel` (parallel with the native query, dual Sleeper-ID resolution: claimed `LeagueTeam` → fallback `userProfile.sleeperUserId`) and surfaced in `TradesTab` as an amber notice with an **Open in Sleeper** link.

Boundary held deliberately: provider rows omit `viewerIsReceiver` / `viewerIsProposer`, which suppresses the accept/reject buttons. The Sleeper public API is read-only, so AF **advises but cannot execute** — the copy says so plainly rather than rendering a button that would fail.

Three bugs caught in desk review, all in logic lifted from the existing dashboard code:
1. **Draft picks only ever credited the receiver** — the sending roster's side of a pick trade rendered empty. Now `previous_owner_id` debits the sender.
2. Direction was hardcoded `'incoming'`, so a user's own outgoing offer displayed backwards. Added `proposedByViewer`.
3. Unclaimed teams were skipped entirely, hiding trades from anyone who imported but never claimed a roster.

Verification: 8/8 new tests. **Not** verified against live data — the sandbox died before integration testing, so the give/get direction is the highest-risk unconfirmed surface.

**Ops (2026-08-10):** all six `DECISION_OS_TRADE_SHADOW_*` flags enabled in the committed `.env.production`, covering all ten surfaces. `LEGACY` mattered most: the dashboard "Trade Analyzer" tile routes to `/af-legacy`, so leaving it dark would have let the Phase 3 flip gate report "ready" while blind to the highest-traffic trade path in the product. Vercel dashboard values still override the file, so instant rollback survives.

**Remaining from the audit, in priority order:** (name-only injury fallback, first-fuzzy-hit binding, projection namespace mismatch, injury join missing sport filter); trade acceptance-probability placeholder features (all default `50`); draft war room LLM overriding deterministic risk/alternatives; scoring-settings-aware valuation; verify the knowledge-graph signal hooks actually write (assemblers read a store nothing may be writing to).

**Phase 2 outcome (2026-08-09):** `lib/decision-os/trade/surfaceShadow.ts` — per-surface shadow instrumentation wired into all four surfaces (console / dynasty / keeper / draftpick), flags `DECISION_OS_TRADE_SHADOW_<SURFACE>` default OFF. Design: structured skip events name the FIRST missing canonical input (league → rosters → snapshot) and carry each surface's own deterministic verdict — the telemetry IS the convergence roadmap and the Phase 3 sample stream. Console additionally now requires session for league-scoped analysis (anonymous global analysis still allowed). FINDING: `lib/keeper/ai/keeperTradeAnalyzer.ts` is a hardcoded placeholder (B/B/counter for every trade, behind a paid entitlement) — marked `placeholder_stub` in telemetry; needs a product decision (honest empty-state vs wiring to canonical trade decision).
Owner: Guap

**Phase 0/1 outcome (2026-08-09):** `/api/engine/trade/analyze` deleted; replacement `app/api/trades/analyze/route.ts` live (session + assertLeagueMember + rate limit, behavior-preserving response shape); both proxies repointed; dead trade seam + broken waiver shadow-compare test deleted; route-inventory test added. Scoped tsc clean; new tests pass; remaining vitest failures pre-existing and outside this PR's import graph.

**NEW FINDING → Phase 0.5 (merge before Phase 2):** `app/api/engine/trade/simulate-counter/route.ts` is a second NO-AUTH engine route with a live UI caller (`components/TradeCounterSuggestions.tsx:76`). Decision: GATE (not delete) with the same auth pattern as `/api/trades/analyze`, then shrink the route-inventory allowlist to empty. Also in Phase 0.5: fix pre-existing `route-budget.test.ts` red (add the two vercel.json cron routes to FILES_KEPT) and add stale-module notes to the two waiver shadow-compare docs.

---

## Decisions (locked)

1. **First slice = Trade unification + auth P0.** Draft VORP and Player Command Center come after.
2. **`/api/engine/trade/analyze` gets DELETED**, not gated. Its two internal proxies get repointed.
3. **Cutover style = shadow-first, flip per-surface** — same playbook as the waiver shadow (parity telemetry, per-surface env flags), NOT one global cutover.

---

## Verified current state (audited 2026-08-08 against `main`)

### Live trade surfaces (~6, fragmented)

| Surface | Route | Auth | Uses Decision OS? |
|---|---|---|---|
| Dynasty analyzer | `app/api/dynasty-trade-analyzer/route.ts` | session only, no league membership; free-text regex context | No |
| Trade Value Console | `app/api/trade-value/analyze/route.ts` | session OPTIONAL, IP rate limit only | No (`lib/trade-value-console/`) |
| Draft pick trade builder | `app/api/leagues/[leagueId]/draft/trade-builder/analyze/route.ts` | full (session + `canAccessLeagueDraft` + roster) | No (`lib/live-draft-engine/`) |
| Redraft trade proposals | `app/api/redraft/trade-proposals/route.ts` | session + `assertLeagueMember` | **Yes — only route**, flag-gated (`DECISION_OS_TRADE_SHADOW`/`_LIVE`) |
| Raw engine | `app/api/engine/trade/analyze/route.ts` | **NONE — no session, no rate limit** | No |
| Others | `app/api/ai/trade-analysis`, `app/api/keeper/ai/trade-analysis`, `app/api/mock-draft/trade-*` | varies | No |

### Key facts

- Canonical engine exists: `lib/decision-os/trade/index.ts` → `runTradeEvaluateDecision` (World → DCO → Decision → Parity). Its ONLY caller is `lib/decision-os/trade/shadow.ts`, whose only route caller is redraft trade-proposals.
- De facto value engine everything bottoms out in: `lib/trade-value/snapshot.ts` → `buildTradeValueSnapshot`.
- **Dead seam:** `lib/decision-os/trade/sharedServiceTradeValueShadowCompare.ts` imports `@/lib/shared-services/trade/TradeValueConsoleShadowService` — `lib/shared-services/trade/` does not exist. Nothing imports this file. Delete it.
- **Proxies to the no-auth route:** `app/api/app/leagues/[leagueId]/trades/analyze-ai/route.ts` and the catch-all `app/api/app/[...path]/route.ts` (line ~243) both `proxyToExisting` → `/api/engine/trade/analyze`.
- Multi-team honesty already exists: `TradeEvaluatorSupport = 'supported' | 'unsupported_by_legacy_evaluator'` in `lib/decision-os/trade/dco.ts` — preserve this behavior on every surface.

---

## Target architecture

One canonical chain, many views:

```
Route (auth + league membership per surface)
  → lib/decision-os/trade/index.ts  runTradeEvaluateDecision
      world.ts   (facts: rosters, league settings, picks — legacy Prisma for now)
      dco.ts     (deterministic evaluation, wraps buildTradeValueSnapshot)
      rules.ts   (legality gates)
      decision.ts (What happened / Why it matters / Confidence / What to do)
  → surface-specific adapter (console view, dynasty view, draft-pick view, Chimmy prose)
```

No surface computes its own trade verdict. Chimmy consumes the Decision Object; it never re-derives the grade.

---

## Phases

### Phase 0 — Security P0 (own PR, merge first)

1. Delete `app/api/engine/trade/analyze/route.ts`.
2. Repoint both proxies (`app/api/app/leagues/[leagueId]/trades/analyze-ai/route.ts` and the `analyze-ai` branch of `app/api/app/[...path]/route.ts`) to a session-authenticated target. Interim target: the redraft trade-proposals evaluation path or a new thin `app/api/trades/analyze/route.ts` that requires session + `assertLeagueMember(leagueId)` and calls the same `lib/engine/trade` `runTradeAnalysis` (behavior-preserving) — Decision OS shadow added in Phase 2.
3. Grep `components/`, `hooks/`, `lib/`, mobile/web clients for any direct fetch of `/api/engine/trade/analyze`; migrate or fail loudly. (Audit found zero in `components/` and `hooks/`; re-verify `lib/` and any client SDK.)
4. Add a route-inventory test asserting no `app/api/**/route.ts` under `engine/trade` exists.

### Phase 1 — Delete dead code (same PR as Phase 0 or immediately after)

1. Delete `lib/decision-os/trade/sharedServiceTradeValueShadowCompare.ts` (dangling import, zero consumers).
2. Delete or fix `__tests__/decision-os/waiver-shared-service-shadow-compare.test.ts` — it imports `lib/decision-os/waiver/sharedServiceShadowCompare.ts`, which does not exist. Delete the test (the Decision OS waiver slice shadow in `lib/decision-os/waiver/shadow.ts` is the real, live one).
3. Update `docs/os/FANTASY_OS_WAIVER_SHADOW_COMPARE.md` + `FANTASY_OS_WAIVER_MULTI_LEAGUE_VALIDATION.md` with a stale-module note so the 39/39 claim isn't attributed to a module that doesn't exist.

### Phase 2 — Shadow wiring, per surface (one PR per surface)

Order: **Trade Value Console → Dynasty analyzer → keeper/ai trade-analysis → draft pick trade builder** (mock-draft sims last; they may stay on the lightweight engine intentionally — decide when reached).

For each surface:

1. Add env flag `DECISION_OS_TRADE_SHADOW_<SURFACE>` (e.g. `_CONSOLE`, `_DYNASTY`, `_DRAFTPICK`).
2. On request: run the legacy path (authoritative, returned to user) AND `runTradeEvaluateDecision` in shadow with timeout isolation (copy the pattern from `lib/decision-os/waiver/shadow.ts` + `app/api/waiver-ai/engine/route.ts`).
3. Emit parity telemetry via the existing `emitShadowParity` pattern with decision id `manager.trade.evaluate`, tagged by surface.
4. Surface-specific world assembly gaps to close while wiring:
   - **Console:** typed assets already exist (Zod) — map `player`/`pick`/`faab` assets into the DCO participant graph. Session must become REQUIRED when a leagueId is supplied.
   - **Dynasty analyzer:** free-text name matching is the weak point. Resolve names through canonical player identity (`lib/shared-services/player-identity/`) before building the DCO; emit `completeness` degradation instead of silently guessing.
   - **Draft pick builder:** already has the best auth; map `slotOrder`/`tradedPicks`/`resolvePickOwner` state into DCO pick assets.
5. Multi-team trades: keep `unsupported_by_legacy_evaluator` degradation on every surface (null grade + honest messaging), never a fake two-team score.

### Phase 3 — Flip per surface

For each surface, once shadow parity holds over a real sample window (target: ≥95% verdict equivalence over ≥50 real evaluations, divergences triaged):

1. Flip `DECISION_OS_TRADE_LIVE_<SURFACE>` — Decision OS verdict becomes authoritative; legacy runs in reverse-shadow for one more window.
2. Chimmy/AI prose on that surface switches to consuming the Decision Object fields only (no independent grading).
3. Then delete the surface's bespoke scoring code (keep the world/context assembly it contributed).

### Phase 4 — Consolidation cleanup

1. Collapse remaining trade routes onto one service module; routes become thin auth + adapter layers.
2. Single UI contract: the four answers (What happened / Why it matters / Confidence / What to do) + provenance + freshness on every trade surface.
3. Update `AF_REMEDIATION_PLAN.md` and `docs/os/SPORTS_DATA_DECISION_OS_DEPENDENCY_MAP.md`.

---

## Acceptance criteria

- `/api/engine/trade/analyze` returns 404; proxies still work with auth enforced.
- Zero unauthenticated trade evaluation endpoints (route-inventory test).
- `sharedServiceTradeValueShadowCompare.ts` and the broken waiver shadow-compare test are gone; `tsc` and vitest pass in CI (CI runs vitest per #281 — trust CI, not local tsc).
- Each wired surface emits `manager.trade.evaluate` parity telemetry tagged by surface, visible in the existing parity dashboard/Control Room.
- Multi-team trades degrade honestly on every surface.
- No new Prisma migration needed for Phases 0–2 (world reads existing models). If any schema change appears necessary: additive Prisma Migrate file, NEVER `db push` (prod = Neon).
- PUBLIC repo: no secrets, no `.claude/settings.local.json`, scan before push.

---

## Ready Claude Code prompt

Paste into Claude Code at repo root:

```
Read AF_TRADE_UNIFICATION_BRIEF.md at the repo root and execute Phase 0 and Phase 1 as a single PR.

Constraints:
- Behavior-preserving except for the intended changes: deleting the no-auth route, enforcing session + league membership on its replacement, and deleting the two dead modules listed in Phase 1.
- Do NOT touch lib/trade-value/, lib/trade-value-console/, lib/live-draft-engine/, or any scoring logic in this PR.
- Do NOT create Prisma migrations or modify schema.prisma.
- Follow the existing patterns: assertLeagueMember for membership, getServerSession(authOptions) for auth, and the error-shape conventions used by app/api/redraft/trade-proposals/route.ts.

Steps:
1. Delete app/api/engine/trade/analyze/route.ts.
2. Create app/api/trades/analyze/route.ts: POST, requires session (401 otherwise); requires leagueId in body or query and asserts league membership (403 otherwise); adds the same rate-limit wrapper used by app/api/trade-value/analyze/route.ts; then calls runTradeAnalysis from lib/engine/trade with the same request/response shape the old route used, so proxies keep working.
3. Repoint app/api/app/leagues/[leagueId]/trades/analyze-ai/route.ts and the analyze-ai branch in app/api/app/[...path]/route.ts (~line 243) from /api/engine/trade/analyze to /api/trades/analyze.
4. Grep the entire repo (including lib/ and any client code) for 'engine/trade/analyze'; migrate every reference. Report every file you changed.
5. Delete lib/decision-os/trade/sharedServiceTradeValueShadowCompare.ts. Verify nothing imports it first; if something does, stop and report.
6. Delete __tests__/decision-os/waiver-shared-service-shadow-compare.test.ts (its import target lib/decision-os/waiver/sharedServiceShadowCompare.ts does not exist).
7. Add a vitest route-inventory test that fails if any route file exists under app/api/engine/trade/.
8. Run the affected vitest suites and tsc. Note: local tsc can false-clean — list the exact commands run and their output so CI comparison is possible.
9. Output a summary: files deleted, files created, files modified, references migrated, tests added, and anything you found that the brief didn't anticipate.

Do not start Phase 2 in this PR.
```

After Phase 0/1 merges, ask for the Phase 2 prompt (per-surface shadow wiring, starting with Trade Value Console).
