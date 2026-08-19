# AllFantasy Data Provenance Audit

Branch: `fix/access-tier-and-landing` · Read-only audit, no feature changes.

Goal: know exactly what every surface shows — live vendor data, live sports data, computed
from real data, static/fabricated, or honest-empty — so the team can demo against real Sleeper
leagues without ever showing a prospect a made-up number.

Classification legend:

- **LIVE-VENDOR** — fetched from the vendor API (Sleeper/ESPN/etc.) at request time
- **IMPORTED-REAL** — real vendor data captured at import, stored point-in-time
- **LIVE-SPORTS** — real live sports data (stats/scores/injuries/news/projections/ADP) from a sports-data API
- **COMPUTED** — derived from real data by an engine (inputs named per row)
- **STATIC/FAKE** — hardcoded, mocked, sampled, randomized, or fabricated
- **EMPTY** — honest empty state, no data yet

Everything below was traced to actual files/functions/API calls, not inferred from naming or
commit messages. Where a prior commit message claimed a fix, the current code state was
re-verified independently.

---

## 1. Dashboard

| Data point | Classification | Source | Notes |
|---|---|---|---|
| League board rows — name/format/teams/status | IMPORTED-REAL / COMPUTED | `app/dashboard/universal/components/LeagueCards.tsx` ← `lib/dashboard/get-dashboard-league-list.ts` | Native AF leagues = live DB rows; Sleeper-imported = point-in-time snapshot. |
| League board — win/loss record | EMPTY (by design) | `get-dashboard-league-list.ts` | Not carried at list level — correctly omitted, not faked. |
| League board — commissioner badge | COMPUTED | `resolveViewerLeagueCommissioner()` in `get-dashboard-league-list.ts` | Real `Team.isCommissioner`/role flags. |
| League board — paid/free badge (native leagues) | COMPUTED | `extractEntryFeeUsd(settings)` | Real `settings.entryFee`/`buyIn`. |
| League board — paid/free badge (Sleeper-imported leagues) | **STATIC/FAKE (gap)** | `getLegacyLeagueBoardItems`, `get-dashboard-league-list.ts:118-121` | `isPaid` hardcoded `false`, `entryFee` hardcoded `null` — imported leagues never show a paid badge even if real. |
| Priority-by-Platform | COMPUTED | `app/dashboard/universal/components/PriorityByPlatform.tsx` → `deriveSignal()` | Rule-based over real `roster-legality-summary`, `status`, `draftDate`, `currentWeek`. |
| Dynasty Planet — search suggestions | LIVE-SPORTS / IMPORTED-REAL | `/api/players/search` | Real DB player table. |
| Dynasty Planet — headshot | IMPORTED-REAL | `getPlayerImage()` (`lib/players/getPlayerImage.ts`) | Keyed on real `sleeperId`. |
| Dynasty Planet — team logo | COMPUTED | `teamLogoUrl()` (`lib/media-url.ts`) | Deterministic mapping, not fabricated. |
| Dynasty Planet — season stats | LIVE-SPORTS / IMPORTED-REAL | `/api/players/season-stats` → `player_season_stats` | Same source `PlayerStatsResolver.ts` uses for Trade/Draft tools. |
| Dynasty Planet — cross-league ownership % | COMPUTED | `/api/player-portfolio?search=` | Honest 0% when unrostered anywhere. |
| **"Live data connected" indicator** | **STATIC/FAKE** | `app/dashboard/universal/components/DashboardHeader.tsx:100-105` | Unconditional hardcoded markup, no health check, no state — always claims all 7 listed feeds connected. |
| League Buzz | **EMPTY** (re-verified, not fake) | `app/api/shared/activity/route.ts` → `LeagueActivityFeed.tsx` | Commit 76ef03cb1 confirmed: fabrication generator (`lib/activity/placeholder.ts`) removed; route now returns `{status:"ok", items:[]}` honestly since no real cross-source aggregator exists yet. Renders correct empty state. |
| Portfolio Analytics — "Season Performance Index" chart | **EMPTY** (disclosed) | `PortfolioAnalytics.tsx` | Not rendered — no cross-league weekly rollup exists; explanatory text shown instead of fabricating. |
| Portfolio Analytics — "Points For · last 6 weeks" | **EMPTY** (disclosed) | `PortfolioAnalytics.tsx` | Same reason as above. |
| Portfolio Analytics — "This Week's Best Matchup" | COMPUTED / LIVE-VENDOR | `/api/leagues/[leagueId]/matchup-center` (`buildMatchupCenterPayload`) | Real matchup scores/win-probability, same engine as League Hub. |

## 2. Ranking

| Data point | Classification | Source | Notes |
|---|---|---|---|
| XP inputs (career wins/playoffs/championships/seasons/league-size bonus) | COMPUTED | `lib/rank/calculateRank.ts::calculateAndSaveRank()` | Real merged rows: Sleeper imports (`League.import_*`), legacy Sleeper history (`legacyLeague`/`legacyRoster`), native AF (`franchiseSeason`, finalized only). Weights in `lib/rank/rank-xp-constants.ts` are fixed design constants, disclosed to users. |
| Rank/tier level | COMPUTED | `lib/rank/levels.ts::getLevelFromXp()` | Real threshold walk against the real XP total; the 25-level table is shown in-UI (`RankingSystemOverview`), not hidden. |
| Career — seasons count | IMPORTED-REAL | `app/api/user/rank/route.ts:641,656` | Real distinct-season count. Seasons↔leagues un-swap fix (commit 466fdfd91) re-verified correct in both response branches. |
| Career — leagues count | IMPORTED-REAL | same route, :663,672 | Real row count. |
| Career — W-L record | IMPORTED-REAL | same route, :637-638,659-660 | Real aggregated wins/losses. |
| Career — championships count | IMPORTED-REAL, **but inconsistent** | `careerChampionships` (:661, branch-aware, used by dashboard `RankingsCard`) vs `rank.championshipCount` (:642,717, always legacy-table-sourced, used by `/af-rankings` `CareerStats`) | Two real-but-independent counts can diverge for a user with both Sleeper-imported and legacy-table history. Not fabrication — a genuine consistency bug. |
| Career — win/loss streaks | **EMPTY** | `AfRankingsHistoryPlaceholder` renders literal `—` under "Unlocks with history"; `RankMovementChip` always gets `movement={null}` | No streak-detection code exists anywhere on the ranking surface. `XP_SOURCES.streak3/5/7plus` constants exist but are never referenced by any calculator — dead, unused. |
| Dormant secondary ranking engine | N/A (unused but present) | `lib/ranking/computeLegacyRank.ts` + `lib/ranking/config.ts` (`XP_SOURCES`: win=50, playoff=200, championship=500 — a totally different scale) + `lib/ranking/difficulty.ts` (1.0–3.0× multiplier) | Writes only `legacyUserRankCache`, used only as a fallback if `user_profiles` denorm is missing. Real data in, but a **different XP scale** than the canonical engine — risk of a user momentarily seeing numbers ~5-10x off if the canonical write hasn't run yet. |
| "Yearly projection" (`ai_low/mid/high_year_xp`) | **STATIC/FAKE**, confirmed unwired | `computeLegacyRankPreview` | Hardcoded "AI lift" multipliers (not from any real model) applied to real base numbers. Verified **not rendered anywhere** on the ranking surface today — dead code, not currently misleading, but a landmine if ever wired up as-is. |

## 3 & 4. AF Legacy toolset + OS engines behind them

Six deep-action tools, gated to `war_room` (AF Legacy) this session:

| Tool | Classification | Real per-league scoring settings? | LLM role |
|---|---|---|---|
| Trade Command Center (`generateTradeProposals`) | COMPUTED (FantasyCalc-priced) + LLM overlay | Partial — `isSuperFlex` via string heuristic on `league.scoring`, not real `roster_positions`; `numTeams` **hardcoded to 12** regardless of real league size | Narrative + a **second, unreconciled acceptance %** from GPT-4o alongside the deterministic `acceptanceModel.score` — the two can disagree in the UI |
| Trade Review — Finder (`components/TradeFinderV2.tsx::runFinder`) | COMPUTED (FantasyCalc) | **Yes** — real `roster_positions`/`scoring_settings.bonus_rec_te`/`total_rosters` | Ranks/explains only; system prompt forbids inventing trades; clamped server-side to real asset IDs; falls back to `aiEnhanced:false` raw candidates on LLM failure |
| Trade Review — Matchmaking (`runMatchmaking`) | COMPUTED (FantasyCalc) | Yes | None — pure deterministic |
| Waiver AI (`runWaiverAnalysis`) | COMPUTED (FantasyCalc + live Grok news search) | **Yes** — real `roster_positions`/`scoring_settings`/`num_teams` | Narrative-only by explicit system-prompt constraint; falls back to deterministic-only summary on LLM failure |
| Opponent Behavior (`runManagerComparison`) | Real underlying stats, **but the grade is unaudited LLM judgment** | N/A (cross-league) | **Letter grade, "winner", "trash_talk" are 100% GPT-4o output** — no deterministic scoring function verifies the stated weights (championship 35%/win% 25%/playoff 25%/consistency 15%) are actually applied. Not reproducible/auditable. |
| Team Direction (`runRankingsAnalysis`) | **STATIC/FAKE valuation engine** | Displayed correctly but **not used** in the valuation math | `getFantasyCalcValues()` in `server/api-route-modules/legacy/rankings/analyze/route.ts:540-542` **always returns an empty map** — never calls the real vendor despite the name. Every player falls to `getPositionBaseValue(position) * getAgeAdjustment(age)` — e.g. every QB priced flat ~4000, every RB ~3500, blind to actual talent/production/market value. This generic value drives 30% of `overallScore`, all positional values, and the Contender/Frisky/Fraud/Trust-the-Process tier label. |
| Market Board (`runSocialPulse`) | LIVE-SPORTS / LIVE-VENDOR | N/A | Genuinely live-search-grounded (Grok `x_search`/`web_search`, last 7 days), prompt forbids hallucination; confidence/impact scores are cosmetic heuristics on top of real results |
| Legacy Score / Tier (snapshot header) | COMPUTED | `lib/legacy/overview-scoring.ts::computeCompositeProfile` | Fully deterministic, auditable formula over real per-league records; no LLM |
| "Archetype" tile (dashboard `LegacySnapshotCard`) | **DEAD** | `app/dashboard/components/LegacySnapshotCard.tsx:44,84` | `rankPayload?.managerArchetype` is never populated by `/api/user/rank` at any level — always renders `—`. (Different component from the `/af-legacy` page's own `aiReport.archetype`, which does render since it reads a real AI-report field.) |

## 5. Import — which platforms are real

Six provider adapters exist in `lib/league-import/adapters/` (the audit brief assumed 7 —
actual count is 6; no 7th platform exists in code):

| Provider | Status | Evidence |
|---|---|---|
| Sleeper | **Real, certified** | Extensively certified with a real account this session (canonical discover→preview→commit pipeline, commissioner gating, physical DB validation). |
| ESPN | **Real, certified** | Certified with a real account this session (call-graph audit, status mapping, canonical lifecycle, downstream certification). |
| Yahoo | **Real, certified** | Certified this session (OAuth cert, import cert, canonical lifecycle validation, downstream dependency check). |
| MFL (MyFantasyLeague) | **Real, certified** | Certified this session (call-graph/auth audit, commissioner authorization, one-to-one cert with real data, conflict/replay behavior). |
| Fantrax | **Real, certified** | Audited and certified this session (identity model, AppUser ownership, CSV commissioner semantics, access-control tests). |
| Fleaflicker | **Real code, not certified this session** | `lib/league-import/fleaflicker/FleaflickerLeagueFetchService.ts` makes genuine `fetch()` calls to `https://www.fleaflicker.com/api` — not a UX-only stub. But unlike the other 5, it has not been through a live-account certification pass in this session's history; confidence is lower. |

`stubAdapter.ts` exists as a generic fallback shape but is not one of the 6 listed providers in
`lib/league-import/provider-ui-config.ts` — all 6 listed providers (`available: true`) have real
adapter code.

## 6. Live-sports / external data layer

Most sports data flows through one real, DB-first, multi-provider fallback chain:
`lib/workers/api-chain.ts::fetchWithChain` — checks cache/normalized tables first, then tries
providers in priority order (Rolling Insights → TheSportsDB → API-Sports → ClearSports →
CFBD [NCAAF only] → Sleeper → ESPN). Each provider file makes genuine HTTP calls.

| Provider | Classification | Feeds | Note |
|---|---|---|---|
| Rolling Insights | LIVE-SPORTS | players/teams/injuries/news/scores/schedule/standings/projections/rankings/adp/rosters, 8 sports | First-priority provider; dual OAuth token caching. |
| API-Sports | LIVE-SPORTS | NFL/NCAAF teams/players/games/injuries/headshots | Called directly by `import-scores`/`import-injuries`/`import-standings` crons too. |
| TheSportsDB | LIVE-SPORTS | teams/players/schedule/headshots/logos | 2nd-priority non-image, 1st-priority NFL images. |
| CFBD (College Football Data) | LIVE-SPORTS | NCAAF rosters/teams/games | Bearer-auth real client. |
| ClearSports | LIVE-SPORTS | teams/players/games/news/rankings/projections/headshots/logos | Fallback tier. |
| OpenWeatherMap | LIVE-SPORTS (real) | Game-day weather | Real cron (`weather/refresh-cron`) + real UI surfaces across matchup/draft/dynasty/coach panels — not a stub. |
| Giphy | **CONFIGURED-BUT-UNUSED** | GIF search (World Cup bracket chat only) | Key blank in `.env`; no Klipy/Tenor keys either, so `searchGifs()` always returns `[]`. The "dev fallback key" noted in `.env`'s comment is not implemented anywhere in code. |
| GIF search (main league chat) | **STATIC-FAKE** (not an external API at all) | `app/api/chat/gifs/route.ts` reads a local pre-seeded `chat_gifs` Prisma table | Never calls Giphy/any external GIF API — separate code path from the resolver above. |
| NewsAPI | LIVE-SPORTS (used) + dead duplicate | Feeds Chimmy AI chat context (`newsapi-cache.ts`) | A second, fully-built NewsAPI ingestion engine (`lib/workers/newsapi-ingestion.ts`) exists but is never called from anywhere — dead code, not part of the real news pipeline (which goes through the api-chain instead). |
| Serper | LIVE-SPORTS (AI tool-call search) | Grok tool-call web search for Trade Improve / Waiver AI | Real, reachable. |
| TheAudioDB | LIVE (non-sports) | Music/artist metadata widget | Real and wired, but unrelated to sports/fantasy data. |
| ADP consensus | LIVE-VENDOR | `lib/workers/adp-importer.ts` — Fantrax/Sleeper/ESPN/MFL/FFC + internal AI-ADP snapshots | Real multi-source importer. |

**Cron/route gap** (ops finding, not directly demo-visible): 22 cron paths listed in `vercel.json`
have **no matching route file anywhere in the repo** and would 404 if actually invoked, including
`/api/cron/import-projections`, `/api/cron/import-rankings`, `/api/cron/sync-playoff-brackets`,
`/api/cron/health-check`, `/api/cron/data-freshness`, and 17 others. Concretely: **projections and
rankings ingestion have no scheduled cron entry point at all** — that data only flows in on-demand
through the api-chain when something requests it, not on a refresh schedule.

---

## DEMO RISK — ranked worst first

1. **Team Direction (Rankings tab) player valuations are fabricated.** `getFantasyCalcValues()` in `server/api-route-modules/legacy/rankings/analyze/route.ts:540-542` always returns an empty map, so every player gets a flat position+age price instead of real market value — while the tier label (Contender/Frisky/Fraud/Trust the Process) presents as if it reflects real asset value. **Real fix exists in-repo**: `lib/hybrid-valuation.ts`/`canonicalPlayerValuations.ts` already do this correctly for every other tool — just needs to be wired into this one route.
2. **Opponent Behavior (Compare tab) letter grades have no deterministic backing.** Real stats go in, but the A+-to-F grade, "winner", and "trash_talk" are unverified GPT-4o output — not reproducible, could vary run-to-run for identical input.
3. **Dashboard "Live data connected" chip is hardcoded.** Always claims all 7 listed feeds are connected regardless of actual status — a real outage would still show green.
4. **Trade Command Center shows two disagreeing acceptance percentages** — the deterministic `acceptanceModel.score` and a separate LLM-generated "pitch acceptance %" are never reconciled.
5. **Dashboard "Archetype" tile is dead** — `LegacySnapshotCard` always renders `—`; a manager archetype field that's never populated.
6. **Championship count can show two different numbers** for the same user depending on which UI reads it (`careerChampionships` vs `rank.championshipCount`).
7. **League Buzz shows nothing** — an honest empty state, but a prominent dashboard section a prospect will likely ask about.
8. **Portfolio Analytics is missing 2 of its 3 intended tiles** (Season Performance Index, Points For chart) — disclosed-empty, visibly incomplete.
9. **GIF search is effectively dead** outside the pre-seeded static table — cosmetic, low risk.
10. **22 cron paths in `vercel.json` have no route handler** — ops/404 risk, and means projections/rankings data has no scheduled refresh.
11. **Dormant secondary ranking engine** (`lib/ranking/*`) uses a completely different XP scale (5-10x off the canonical one) and could surface if the canonical write hasn't run yet.
12. **Fake "yearly XP projection" AI-lift numbers exist in code** — currently unwired/unrendered, but a landmine if someone wires it up without fixing the hardcoded multipliers first.

## Already-real, safe-to-demo today

- League board rows (native + Sleeper-imported), Priority-by-Platform, Dynasty Planet player search (headshots/logos/season stats/ownership %)
- Trade Review (Finder + Matchmaking) — fully real, LLM tightly clamped, real per-league scoring settings
- Waiver AI — fully real scoring + live news, LLM narrative-only, real per-league scoring settings
- Market Board (Social Pulse) — genuinely live-search-grounded
- Legacy Score/Tier — deterministic, fully auditable, real inputs
- Canonical XP/rank engine, rank/tier level assignment, career seasons/leagues/W-L stats
- Weather integration across matchup/draft/dynasty/coach surfaces
- The core sports-data chain (Rolling Insights/API-Sports/TheSportsDB/CFBD/ClearSports) feeding stats/scores/injuries/news, plus the ADP consensus importer
- Import: Sleeper, ESPN, Yahoo, MFL, Fantrax — all certified with real accounts

## Wiring gaps — what's needed, rough effort

| Gap | Fix | Effort |
|---|---|---|
| Team Direction fake valuations | Wire the existing real `lib/hybrid-valuation.ts` call into `legacy/rankings/analyze/route.ts` in place of the stub | Small |
| Opponent Behavior ungraded LLM verdict | Add a deterministic scoring function matching the disclosed weights; use the LLM for narrative only | Medium |
| "Live data connected" chip | Wire to a real aggregated health check, or remove | Small |
| Trade Command Center dual acceptance % | Reconcile/clamp the LLM pitch-acceptance number to `acceptanceModel.score`, or drop the duplicate | Small |
| Dead Archetype tile | Populate `managerArchetype` for real, or remove the tile | Small |
| Championship count inconsistency | Unify the two career-stat code paths to one source of truth | Small–Medium |
| League Buzz empty | Build the real cross-source activity aggregator (trades+waivers+chat+announcements) — doesn't exist yet | Large |
| Portfolio Analytics missing charts | Build the cross-league weekly-scoring rollup | Medium–Large |
| GIF search dead | Set a real Giphy/Tenor/Klipy key (or leave chat as DB-table-only by design) | Trivial |
| Missing cron route handlers | Build the missing routes or trim `vercel.json` to match reality | Medium |
| Dormant secondary ranking engine | Delete `lib/ranking/*` legacy engine now that `lib/rank/*` is the sole source of truth | Medium |
| Fake yearly-XP projection code | Wire to a real model or delete the dead code before it gets surfaced | Small |
