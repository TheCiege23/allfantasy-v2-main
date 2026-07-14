# AllFantasy Fantasy OS — Master Architecture Specification

**Status:** Planning document. Read-only deliverable — no code was written or changed to produce this spec.
**Supersedes-in-spirit:** [`docs/os/FANTASY_OS_SUITE_CLIENT_AGNOSTIC_ROADMAP.md`](FANTASY_OS_SUITE_CLIENT_AGNOSTIC_ROADMAP.md) (which established the client-agnostic framing) and is grounded in the 2026-07-09 ten-part pivot audit (published as an artifact; summarized in project memory `fantasy-os-pivot-audit`). This document is the blueprint those findings feed into.
**Audience:** whoever picks up Phase 1 engineering work next — this is meant to be handed to an engineer or an agent as a standing reference, not read once and archived.

---

## Table of Contents

1. Executive Architecture Summary
2. Core Boundary Definitions
3. Fantasy Knowledge Graph Specification
4. Import Lifecycle
5. Live Data Lifecycle
6. Market Value Lifecycle
7. Decision Pipeline
8. OS Module Boundaries
9. Trade Intelligence Architecture
10. Game Day Architecture
11. Commissioner Content Architecture
12. Specialty League Architecture
13. Privacy, Trust, and Data Visibility
14. Relationship to Licensed Decision OS
15. Implementation Roadmap
16. Engineering Principles
17. Open Questions
18. First Recommended Implementation Prompt

---

## Part 1 — Executive Architecture Summary

AllFantasy stops competing with Sleeper, ESPN, Yahoo, Fantrax, and MFL as a place to *host* a league. It becomes the place a manager checks *instead of* checking five apps — an intelligence layer that sits above every platform a league might actually live on. The product promise is: **keep playing wherever you already play; let AllFantasy tell you what to do about it.**

That promise only holds if seven layers work together cleanly, each with one job:

1. **External fantasy platforms** — Sleeper, ESPN, Yahoo, Fantrax, MFL, and whatever comes next. AllFantasy does not control these; it reads from them under whatever auth model each one offers (public API, OAuth, cookie, API key, or manual CSV as a last resort).
2. **Provider adapters** — one adapter per platform, each responsible only for translating that platform's raw shape into a common normalized shape. All platform-specific weirdness (Sleeper's `previous_league_id` chain, ESPN's cookie auth, Yahoo's OAuth refresh, MFL's XML) is quarantined here and never leaks past this layer.
3. **Normalized Fantasy Data Layer** — the one shape every downstream system reads: leagues, managers, rosters, scoring, settings, schedules, matchups, transactions, trades, drafts, playoffs — regardless of which platform they came from.
4. **Live Sports Data Layer** — Rolling Insights (primary), plus weather, news, injuries, and secondary stats providers, joined to normalized data via a canonical player identity.
5. **Market Value Layer** — FantasyCalc as the raw market-value input, with AllFantasy's own format/team/league adjustments layered on top.
6. **Fantasy Knowledge Graph** — the fantasy-specific learning layer: exposure, tendencies, league economy, format-specific patterns. This is the layer that makes AllFantasy smarter than the sum of its imports, and it is described in full in Part 3.
7. **Decision OS** — the generic, industry-agnostic recommendation engine: context in, scored candidates with confidence/risk/evidence out. It knows nothing about fantasy football specifically; it only knows how to score options and grade its own track record.
8. **Feature Surfaces** — Legacy, Game Day, Trade Center, Waiver Center, Commissioner Center, Player Search, Specialty Dashboards. These are where a user actually spends time; everything below them exists to make these surfaces good.

```
┌─────────────────────────────────────────────────────────────────┐
│                    EXTERNAL FANTASY PLATFORMS                     │
│   Sleeper · Yahoo · ESPN · Fantrax · MFL · Fleaflicker · (future)  │
└───────────────────────────────┬─────────────────────────────────┘
                                 │ raw provider payloads
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                     PROVIDER ADAPTER LAYER                        │
│   {Provider}FetchService  →  {Provider}Adapter.normalize()        │
│   auth (OAuth / cookie / API key / public / CSV) · pagination     │
│   rate limiting · retry & backoff · coverage self-report           │
└───────────────────────────────┬─────────────────────────────────┘
                                 │ ImportCoverageBucket: full / partial / missing
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                NORMALIZED FANTASY DATA LAYER                      │
│  users · platform identities · leagues · managers · rosters       │
│  scoring · settings · schedules · matchups · transactions         │
│  trades · drafts · playoffs                                       │
└───────┬────────────────────────────────────────────┬────────────┘
        │                                             │
        ▼                                             ▼
┌────────────────────────┐                 ┌─────────────────────────┐
│  LIVE SPORTS DATA LAYER │                 │   MARKET VALUE LAYER     │
│  Rolling Insights        │                 │   FantasyCalc (raw) +    │
│  weather · news · injury │                 │   AF format/team/league  │
│  depth charts · schedule │                 │   adjustment engine       │
└────────────┬────────────┘                 └────────────┬────────────┘
             │                                            │
             └──────────────────────┬─────────────────────┘
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FANTASY KNOWLEDGE GRAPH                         │
│  player exposure · manager tendencies · league economy             │
│  trade outcomes · waiver behavior · format-specific patterns        │
│  (fantasy-specific learning — the layer competitors don't have)    │
└───────────────────────────────┬─────────────────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                          DECISION OS                               │
│  context → candidates → score → confidence → risk → evidence       │
│  → snapshot → later outcome evaluation   (industry-agnostic)        │
└───────────────────────────────┬─────────────────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                        FEATURE SURFACES                            │
│  Legacy · Game Day · Trade Center · Waiver Center                  │
│  Commissioner Center · Player Search · Specialty Dashboards         │
└─────────────────────────────────────────────────────────────────┘
```

The current codebase already has real, substantial pieces of every layer except two: the Fantasy Knowledge Graph doesn't exist as a named, unified thing yet (its ingredients are scattered across `lib/trade-*`, `lib/waiver-*`, and Decision OS's behavioral subsystem), and the Game Day surface doesn't exist in any form. Everything else described in this document is either "consolidate what's there" or "finish what's half-built," not "invent from nothing" — with the two exceptions above, plus new specialty-format rule design for Pirate and Empire (Part 12).

---

## Part 2 — Core Boundary Definitions

Each layer owns exactly what's listed and nothing more. When a future feature doesn't obviously belong to one layer, that's a signal the feature needs to be split, not that the boundary needs to bend.

### Provider Import Layer
**Owns:** authentication per platform (Sleeper public API, Yahoo OAuth2, ESPN cookie pair, MFL API key, Fantrax — currently CSV, needs a live connector), pagination, rate limiting, retry/backoff, raw-payload parsing, and self-reported coverage (what did this fetch actually get: full / partial / missing, per data type).
**Does not own:** any opinion about what the data *means* for fantasy strategy. An adapter's job ends the moment it hands off a normalized payload.
**Today:** `lib/league-import/{sleeper,espn,yahoo,mfl,fantrax,fleaflicker}` + `ILeagueImportAdapter`. Real for five of six providers; Fantrax has no live path; Fleaflicker is missing scoring/schedule/draft/trades entirely; CBS Sports and NFL.com Fantasy don't exist yet.

### Normalized Fantasy Data Layer
**Owns:** the single canonical shape for users, platform identities, leagues, managers, rosters, scoring, settings, schedules, matchups, transactions, trades, drafts, playoffs — one shape regardless of source platform.
**Does not own:** live player state (injuries, weather) or market value — those join in from adjacent layers, they don't live here.
**Today:** partially real. Roster/scoring/settings/draft normalization is solid; playoff *results* (not just structure) and cross-platform player identity are the two real gaps (see Part 4).

### Live Sports Data Layer
**Owns:** player status, injuries, practice participation, inactives, schedules, stats, fantasy points, weather, depth charts, news, game logs, remaining schedule, opponent strength.
**Does not own:** fantasy-specific interpretation (e.g., "is this injury a buy-low signal" is Knowledge Graph / Decision OS territory, not this layer's job — this layer reports facts, not fantasy meaning).
**Today:** Rolling Insights is deep and real; OpenWeatherMap is real; both are currently wired to native leagues only, not imported ones — that's the join gap Game Day needs closed (Part 10).

### Market Value Layer
**Owns:** raw market value (FantasyCalc), historical value snapshots, and the format-adjustment math that turns "market value" into "value in this specific league."
**Does not own:** a final decision. Market value is an input to a recommendation, never the recommendation itself (see Part 6).
**Today:** FantasyCalc integration is real and current; its player-identity directory is underused as the actual cross-platform ID bridge (currently only feeds valuation, not import reconciliation — Part 4 fixes this).

### Fantasy Knowledge Graph
**Owns:** everything fantasy-specific that's *learned* rather than merely imported: exposure trends, manager tendencies, league economy, trade/waiver outcome patterns, format-specific strategy patterns.
**Does not own:** generic scoring/confidence/risk math — that's Decision OS. The Knowledge Graph produces *evidence*; Decision OS turns evidence into a *ranked recommendation*.
**Today:** does not exist as a unified thing. Full specification in Part 3.

### Decision OS
**Owns:** the domain-agnostic recommendation lifecycle — gather context, generate candidates, score, attach confidence and risk, attach evidence, snapshot the decision, later evaluate the outcome.
**Does not own:** anything fantasy-specific. Decision OS should not know what a "Superflex QB premium" is; it only knows how to rank candidates it's handed, with numbers it's given.
**Today:** `lib/decision-os` is real (~220 files, ~3,000 tests) but its trade/waiver "slices" are read-only shadow validators, not the operative engines — the actual trade/waiver logic sits outside Decision OS in 17+ and 6+ scattered directories respectively. Part 9/12 define the consolidation target.

### Feature Surfaces
**Owns:** the UI and user-facing workflow for Legacy, Game Day, Trade Center, Waiver Center, Commissioner Center, Player Search, Specialty Dashboards.
**Does not own:** any business logic that could be reused by another surface. If a surface needs logic another surface might also need, that logic belongs one layer down, not duplicated in the surface.
**Today:** several surfaces already violate this (three competing "Legacy" pages, five competing trade-grading implementations) — Part 16 makes this an explicit engineering principle going forward.

---

## Part 3 — Fantasy Knowledge Graph Specification

This is the layer that turns "we imported your league" into "we understand fantasy football." It is the single most important addition this spec proposes, because it's the one layer with no current home — its ingredients exist, scattered, inside trade/waiver engines and Decision OS's behavioral subsystem, but nothing treats them as one graph a manager, a league, or a format can be queried against.

### What it is
A derived, continuously-updated model of **patterns observed across imported fantasy data** — not a copy of the data itself. The Knowledge Graph never stores raw messages, raw login timestamps, or anything not already implied by fantasy transactions (trades, waivers, rosters, drafts, standings). It answers questions like "how does this manager typically behave in a trade," "how inflated are QBs in Superflex formats right now," or "what's the going rate for a rebuilding team's veteran RB" — questions no single imported league can answer on its own, because they require aggregation across many leagues.

### 1. Entities
`Player` · `Manager` (a cross-platform identity, not a per-league account) · `League` · `Team` (a manager's roster within one league-season) · `Season` · `Trade` · `WaiverClaim` · `Draft` / `DraftPick` · `ScoringFormat` · `LeagueFormat` (the specialty-format type) · `Platform` · `MarketValueSnapshot`.

### 2. Relationships
`Manager —participates_in→ League` · `Manager —owns→ Team (scoped to one Season)` · `Team —rosters→ Player (with slot + date range)` · `Trade —involves→ Manager × 2, Assets (players + picks) × N` · `WaiverClaim —submitted_by→ Manager —targets→ Player` · `League —has_format→ LeagueFormat` · `League —has_scoring→ ScoringFormat` · `Player —has_value→ MarketValueSnapshot (dated, format-scoped)` · `Manager —has_derived→ ManagerTendencyProfile` · `League —has_derived→ LeagueEconomySnapshot`.

### 3. Signals
Raw, atomic events the graph observes as they happen — never interpreted at capture time: trade proposed / accepted / rejected / countered; waiver claim submitted / won / lost; roster move (add/drop/IR/taxi); lineup start/sit decision; draft pick used on a player; playoff-adjacent roster activity (a proxy for "playoff push" behavior, derived only from roster/trade/waiver timing relative to the schedule — never from anything outside fantasy transactions).

### 4. Aggregates
Derived, periodically recomputed views built from signals:
- **PlayerExposureAggregate** — what share of imported rosters own/start a given player, segmented by format.
- **PlayerValueTrend** — market value time series plus format-adjusted deltas (see Part 6).
- **ManagerTendencyProfile** — trade frequency, risk appetite, contender/rebuilder lean, waiver aggressiveness, negotiation style.
- **LeagueEconomySnapshot** — trade volume, waiver competitiveness, parity index, and scoring-environment effects (Superflex QB inflation, TEP premium, IDP value behavior) measured *for that specific league*, not just platform-wide.
- **FormatStrategyPattern** — patterns specific to a `LeagueFormat` (e.g., Guillotine protect-vs-trade behavior near elimination weeks, Pirate steal-exposure patterns once that format exists).
- **TradeOutcomeAggregate** — at-the-time grade versus realized value some weeks later, tracked in aggregate, never as a public per-manager scoreboard of "bad trades."
- **CommissionerEngagementPattern** — league-health signals (activity cadence, response to prompts) that feed Commissioner Center, never individual-manager shaming metrics.

### 5. Privacy rules
- Only data from an authorized import feeds the graph. No scraping outside what a provider's own API/auth model permits.
- Platform-wide aggregates (format effects, exposure baselines, market trend commentary) are always safe to compute and surface broadly, because they are not attributable to one manager.
- Individual `ManagerTendencyProfile` data is real and useful — Manager OS depends on it — but is scoped: full detail is visible only to (a) the manager themselves, and (b) that manager's own commissioner, within that manager's own league context. It is never surfaced to a stranger who doesn't share a league with that manager, beyond whatever is already publicly visible on the source platform itself (most platforms already show rosters, trade history, and standings to all leaguemates).
- Trade intent (a proposal not yet accepted) is never leaked to the other side of the trade, or to third parties in the league, before it resolves.

### 6. Anonymization rules
- Any pattern surfaced to a third party — not the manager themselves, not their commissioner — must have manager identity stripped or hashed, and the underlying cohort must meet a minimum size threshold (recommended: n ≥ 20 distinct leagues) before being surfaced. This matters more for niche formats (a first-year Pirate-format cohort will be small) than for Redraft.
- Below the cohort threshold, an aggregate is treated as internal-only until enough volume exists — never partially anonymized and shipped anyway.

### 7. What is user-visible
A manager's own tendency profile, exposure, trade/waiver history and grades; their own league's economy snapshot and health; leaguemates' data to the extent the source platform already exposes it to all league members; platform-wide aggregate commentary ("TEP tight ends are currently valued Nx over standard-scoring tight ends").

### 8. What is internal-only
Raw signal-level event logs; any cross-league Manager Archetype detail for a manager the viewer doesn't share a league with; any aggregate below the cohort-size threshold; anything used purely for model calibration and never meant to be product copy.

### 9. How imported usernames can safely improve the system
A username import is, first, a *product* action (the user wants their leagues visible in AllFantasy) and only *second* a data-contribution action. The system should never require more than what's needed to serve that user back their own experience. Cross-manager learning (tendency profiles, economy snapshots) is a byproduct of serving many users, not a separate data-collection program — which is why the privacy rules above scope everything back to "visible to the manager and their own commissioner" by default, with cross-league aggregation only ever surfaced in anonymized, cohort-gated form.

### 10. Handling the existing ~100+ Sleeper username seed dataset
Treat this exactly as the Trade Learning workstream already established a precedent for (project memory: `trade-learning-closed-loop-program` — real staging volume was required before calibrating on real signal, and a small sample was explicitly ruled NO-GO for calibration). The seed dataset is a **cold-start bootstrap corpus only**: it can seed initial format-effect baselines (e.g., "Superflex QB premium ballpark") so the product isn't empty on day one, but it must be tagged distinctly from live customer data, weighted down as real usage volume grows, and never permanently blended into personalized (per-manager) recommendations without being clearly attributed as seed-derived. The moment real customer volume in a format exceeds the seed cohort, the seed data's weight should decay toward zero for that format.

---

## Part 4 — Import Lifecycle

The full lifecycle when a user imports a Sleeper username (the first proof provider; the same shape applies to Yahoo/ESPN/MFL/Fantrax as they mature).

1. **Identity resolution** — username → Sleeper `user_id` → linked to (or creates) an AllFantasy account. One AllFantasy account can hold multiple platform identities (a Sleeper user_id, a Yahoo GUID, an ESPN SWID) — identity resolution must be additive, never one-platform-per-account.
2. **League discovery** — enumerate every league for that `user_id`, walking the `previous_league_id` chain backward for historical seasons (Sleeper-specific mechanism; ESPN/Yahoo/MFL have their own equivalents already implemented).
3. **Permission model** — three tiers, not two: (a) **member import** — any league member may import their own view of a league; (b) **commissioner-attested import** — a self-declared commissioner claim, recorded and auditable, unlocking full-league facts (not just the importing user's own team); (c) **open-read** (currently MFL/Fantrax/Fleaflicker) — no membership proof required at all today. Tier (c) is a known trust gap (see Part 13) and should converge toward requiring at least membership proof, matching Sleeper/Yahoo/ESPN.
4. **User-owned data** — the importing manager's own team, roster, trade/waiver history: fully theirs, fully visible to them.
5. **Reference league data** — everything else in the league (other rosters, league-wide standings, settings): imported for context, subject to the visibility rules in Part 3 §5 and Part 13.
6. **Manager data** — display name, platform identity, and (only where the platform already exposes it to leaguemates) trade/transaction history.
7. **Avatars** — imported as a display convenience, never used as an identity signal beyond display.
8. **Rosters** — current and historical, per team, per season.
9. **Starters / bench / IR / taxi** — full slot-level detail, not just an aggregate roster list — this is what Game Day and Start/Sit need.
10. **Scoring settings** — full ruleset per league, including nonstandard modifiers (TEP, bonus thresholds, etc).
11. **Waiver settings** — FAAB vs. priority, budget, processing day/time.
12. **Trade settings** — veto rules, review windows, deadline.
13. **Playoff settings** — team count, start week, bracket structure (structure only today — see gap below).
14. **Draft history** — full draft results, including which pick became which player (needed for Trade OS's pick-tracking, Part 9).
15. **Transaction history** — adds/drops, waiver claims, over full available history.
16. **Trade history** — accepted trades over full available history, including the assets on both sides.
17. **Matchup history** — weekly results across all available seasons.
18. **Current live roster state** — the most recent snapshot, refreshed on the cadence in Part 5.
19. **Historical season storage** — every prior season retained as its own immutable snapshot, not overwritten by the next import.
20. **Refresh lifecycle** — two modes: on-demand delta refresh (user opens the app, or explicitly asks to sync) and a scheduled background refresh during the active season. Historical seasons, once fully imported, do not need re-fetching.
21. **Error handling** — a failed fetch must never silently degrade the imported dataset. Every failure becomes a recorded, user-visible freshness warning, not a silent gap (see item 24).
22. **Fetch retry/resilience expectations** — every provider fetch service must implement retry with exponential backoff and a hard timeout, and must never swallow an error into a silent null. This is a standing engineering requirement, not optional hardening — the pivot audit found the flagship Sleeper integration currently violates it.
23. **Rate limiting** — respect each provider's published or observed limits; back off rather than fail outright on 429s.
24. **Data freshness flags** — every imported entity carries a "last successfully synced" timestamp and a coverage flag (full / partial / missing per data type), surfaced to the user wherever staleness could change a recommendation (most visibly in Game Day, Part 10).
25. **Provider source attribution** — every fact in the Normalized Fantasy Data Layer knows which platform and which fetch it came from, for auditability (Part 13).

**Product rule on visibility (restated from the brief, and made binding):** a normal user may import and see their own historical and live data, and may see other league managers' data for comparison/reference *where the source platform already makes that visible to leaguemates*. Derived, private intelligence about another manager (their tendency profile, their Decision OS recommendations) is never exposed outside that manager's own context — importing a league does not entitle anyone, including the commissioner, to another manager's private intelligence layer. See Part 13 for the full visibility matrix.

---

## Part 5 — Live Data Lifecycle

Rolling Insights is the primary live sports data provider; weather, news, and injuries ride the same ingestion pipeline (already real today, just native-league-scoped — Part 10 fixes that scoping).

**Data types carried:** player status (active/questionable/out/IR/inactive), injuries, practice participation, game schedules and kickoff times, stats and fantasy points, weather (via OpenWeatherMap, joined by venue/kickoff), depth charts, news, historical game logs, remaining schedule, opponent strength, player value trends (joined in from the Market Value Layer, not computed here).

**Refresh cadence categories:**
- **Real-time / game day** — player status changes, live stats, in-progress fantasy points. Highest-frequency refresh, active only during live windows.
- **Daily** — injury reports, practice participation, depth chart changes. Standard cadence outside game day.
- **Weekly** — schedule, matchup context, opponent strength, weather forecasts as they firm up closer to kickoff.
- **Season-long** — bye weeks, full-season schedule, roster construction context.
- **Historical snapshot** — game logs and past-season stats, fetched once and retained, not re-polled.

**How live data joins imported league data — the canonical chain:**

```
Sleeper player_id
      → Normalized Player (canonical AllFantasy player identity)
            → Rolling Insights player record (live status, stats, schedule)
                  → FantasyCalc market value (raw)
                        → league-specific decision (Part 6/7)
```

The join key at the second step — a canonical player identity that every provider's ID maps onto — is the single most load-bearing piece of plumbing in this entire architecture. Every downstream layer (Market Value, Knowledge Graph, Decision OS, every Feature Surface) depends on that join being correct. Today it partially exists (FantasyCalc's own player directory already cross-maps Sleeper/ESPN/Yahoo/MFL/Fleaflicker IDs for valuation purposes) but is not yet the *canonical* identity table import adapters themselves write into — see Part 4 item 24-adjacent work and the roadmap in Part 15.

---

## Part 6 — Market Value Lifecycle

FantasyCalc represents **market value** — what the field currently thinks a player is worth, in the aggregate, across many leagues and formats. It is an *input*, never the final answer. AllFantasy's job is to take that raw number and adjust it down through several layers until it reflects one manager's actual decision in one actual league:

1. **Market value** (FantasyCalc, as-is).
2. **Format-adjusted value** — adjusted for the league's actual ruleset: Superflex vs. 1QB, TEP vs. standard, dynasty vs. redraft vs. keeper vs. best ball vs. salary cap, IDP scoring presence.
3. **League-adjusted value** — adjusted for this specific league's scoring environment and roster construction norms, which can differ from the format average.
4. **Team-adjusted value** — adjusted for the specific team holding or targeting the asset: a contender values immediate production differently than a rebuilder values draft capital and youth.
5. **Playoff-context value** — a time-decay/urgency adjustment as the fantasy playoffs approach; a rest-of-season role matters more in week 12 than week 3.
6. **Manager-specific value** — the final adjustment, informed by that manager's own tendency profile (risk appetite, trade style) from the Knowledge Graph.

**Worked examples the value engine must handle correctly:**
- **Josh Allen, Superflex vs. 1QB** — same market-value input, materially different format-adjusted output; a 1QB-only value would be actively wrong for a Superflex trade evaluation.
- **A tight end in TEP vs. standard scoring** — the TEP premium is real and must show up before the value reaches team-adjustment.
- **A veteran RB, contender vs. rebuilder team** — same market value, opposite team-adjusted direction: a contender pays a premium for immediate production a rebuilder should be actively discounting.
- **An injured star, redraft vs. dynasty** — a short-term injury craters redraft value far more than dynasty value, where the market is pricing multiple future seasons.
- **A future draft pick, before and after the actual draft selection resolves** — a pick's value is a probability distribution over "what player might this become," collapsing to that specific player's own value the moment the pick is used. The value engine must treat these as the same underlying asset across that transition, not as two unrelated numbers, so Trade Time Machine (Part 9) can show continuity.

---

## Part 7 — Decision Pipeline

One shared pipeline every recommendation type runs through — trades, waivers, start/sit, Game Day alerts, playoff predictions, commissioner alerts, specialty-format recommendations. A recommendation type may skip steps that don't apply, but it may not implement its own competing version of a step that does.

1. **Gather context** — league, team, roster, schedule, format.
2. **Normalize inputs** — resolve every referenced player/pick/team to its canonical identity.
3. **Resolve feature objective** — what is this recommendation actually optimizing for (win-now, rebuild, fill a bye-week hole, avoid an IR trap)?
4. **Apply league settings** — scoring, roster construction rules, waiver/trade rules.
5. **Apply format adapter** — the specialty-format rule layer (Part 12).
6. **Apply live sports data** — status, schedule, weather, opponent.
7. **Apply market value** — the full Part 6 chain.
8. **Apply user/team context** — this specific roster's needs and surplus.
9. **Apply manager behavior context** — this manager's own tendency profile.
10. **Apply league economy context** — this league's trade/waiver market conditions.
11. **Generate recommendation candidates** — the actual option set (which players, which trade shapes, which waiver claims).
12. **Score candidates** — a single scoring function per recommendation type, not several competing ones.
13. **Calculate confidence** — how much evidence supports this ranking.
14. **Calculate risk** — what could make this wrong, and how badly.
15. **Attach evidence** — the specific facts that drove the score, in a form a user could actually read and evaluate.
16. **Attach alternatives** — the next-best candidates, not just the winner.
17. **Record decision snapshot** — an immutable record of what was recommended, when, and on what evidence — required for later outcome evaluation (Part 9's "at-the-time vs. updated" distinction depends entirely on this step existing).
18. **Later, evaluate outcome** — compare the snapshot against what actually happened, feeding the Knowledge Graph's outcome aggregates (never a public per-manager scoreboard, per Part 3 §5).

This is the backbone Part 16's "no duplicate engines" principle exists to protect: today, trades alone run through five different, non-shared implementations of something like this pipeline. Consolidating onto one shared pipeline is most of what Parts 9 and 15's Trade/Waiver OS consolidation phases actually are.

---

## Part 8 — OS Module Boundaries

For each module: inputs, outputs, owning data, dependencies, and — just as important — what it must *not* own.

### Legacy OS
- **Inputs:** full historical import (all seasons, all leagues), trade/draft/matchup history.
- **Outputs:** fantasy resume, historical grades, career rankings, manager profile, Trade Time Machine, share cards.
- **Owns:** career-long, cross-season, cross-league narrative and grading.
- **Depends on:** Normalized Fantasy Data Layer (historical), Market Value Layer (historical snapshots), Decision OS (outcome evaluation).
- **Does not own:** live, in-season recommendations — that's Game Day/Trade/Waiver OS.
- **Consolidation target:** the real engines already exist (`legacy-score-engine`, `hall-of-fame-engine`, `career-prestige`) and should become the single Legacy home; the hardcoded-mock `app/legacy` page and the 18k-line `app/af-legacy` monolith both need to retire into this, not persist alongside it.

### Game Day OS
- **Inputs:** live sports data (Part 5), full roster state across every imported league, player search index.
- **Outputs:** all-leagues view, all-players view, exposure, injury/status board, kickoff-window grouping, deep links.
- **Owns:** the "what do I need to know and do, right now, across everything" surface.
- **Depends on:** Live Sports Data Layer, Normalized Fantasy Data Layer, Market Value Layer (for replacement suggestions).
- **Does not own:** trade/waiver decision logic itself — it surfaces alerts and links out to Trade/Waiver OS, it doesn't reimplement their scoring.
- **Status:** greenfield. Nothing here exists today beyond disconnected fragments (Part 10).

### Trade OS
- **Inputs:** market value, league-adjusted value, roster construction, manager tendencies, schedule/playoff context.
- **Outputs:** trade evaluation, at-the-time grade, mutual-benefit score, Trade Time Machine entries.
- **Owns:** everything about evaluating a specific trade or trade proposal.
- **Depends on:** Market Value Layer, Knowledge Graph (manager tendencies, league economy), Decision Pipeline.
- **Does not own:** waiver logic, even though the two share the same underlying pipeline and often the same roster-need calculation — that calculation should be a shared service both call, not duplicated.
- **Consolidation target:** collapse the five existing trade-valuation/grading implementations (Part 9) onto this one module.

### Waiver OS
- **Inputs:** roster need, FAAB/priority rules, replacement value, league scarcity, schedule, injury replacement urgency.
- **Outputs:** waiver recommendations, claim urgency, bid guidance.
- **Owns:** everything about who to claim and how aggressively.
- **Depends on:** Market Value Layer, Live Sports Data Layer (injury/status triggers urgency), Decision Pipeline.
- **Does not own:** trade logic, even where a waiver need and a trade need are the same underlying roster gap.

### Start/Sit OS
- **Inputs:** lineup rules, matchup, weather, scoring format, floor/ceiling projections.
- **Outputs:** start/sit recommendation, confidence, risk.
- **Owns:** week-to-week lineup decisions only.
- **Depends on:** Live Sports Data Layer, Market Value Layer (marginal, for close calls), Decision Pipeline.
- **Does not own:** roster-construction-level decisions (trades, waivers) — those are different time horizons and belong to their own modules.

### Manager OS
- **Inputs:** a manager's full transaction/trade/waiver/lineup history.
- **Outputs:** behavior profile, trade style, waiver style, risk profile, negotiation tendency, historical decision quality.
- **Owns:** the "who is this manager, strategically" model that other modules consume as context.
- **Depends on:** Knowledge Graph.
- **Does not own:** recommendations themselves — Manager OS informs Trade/Waiver/Start-Sit, it doesn't generate its own competing recommendations.
- **Consolidation target:** the existing provider-agnostic `userOs.ts` path is the right shape; the Redraft-coupled Manager Intelligence Platform should converge onto it rather than remain a second, narrower system.

### League OS
- **Inputs:** full league-level transaction/scoring/settings history.
- **Outputs:** league economy snapshot, scoring environment classification, activity level, trade market health, positional scarcity, parity.
- **Owns:** the league-as-a-whole model.
- **Depends on:** Knowledge Graph, Normalized Fantasy Data Layer.
- **Does not own:** any single manager's profile or any single recommendation.

### Commissioner OS
- **Inputs:** League OS output, Manager OS output (aggregated, not individually exposed), league health signals.
- **Outputs:** league health briefs, inactive-manager flags, rivalry/storyline briefs, copy-ready chat content (Part 11).
- **Owns:** the commissioner-facing narrative and health layer.
- **Depends on:** League OS, Legacy OS (for historical storylines).
- **Does not own:** any individual manager's private intelligence beyond what League OS already aggregates.
- **Consolidation target:** the four currently non-interoperating Commissioner Intelligence subsystems must converge on League OS + Knowledge Graph as their one shared source, so the Hub can't show two different "correct" numbers for the same league.

### Specialty League OS
- **Inputs:** the format adapter for whichever specialty rule set applies (Part 12).
- **Outputs:** format-specific evaluation logic layered on top of Trade/Waiver/Start-Sit OS.
- **Owns:** rule adapters, not a parallel copy of Trade/Waiver/Start-Sit logic.
- **Depends on:** every other OS module, via the format adapter pattern.
- **Does not own:** anything that should be shared logic — a Guillotine trade is still a trade; only the elimination-specific rule layer is unique to it.

---

## Part 9 — Trade Intelligence Architecture

**Target state:** one Trade OS, consuming one shared Decision Pipeline, replacing today's five parallel valuation/grading systems (the general trade evaluator, the native in-league trade workflow, the T2 grader + Decision OS shadow slice, the Trade Finder's own inline grader, and the Replay Framework's backtesting layer — the last of which should remain deliberately separate as a validation-only system, per its own existing architectural rule, rather than being merged into the live recommendation path).

**Required capabilities:**
- **Current trade evaluation** — a live proposal, scored through the full Decision Pipeline.
- **Historical trade evaluation** — any past trade, re-scored with today's model for comparison.
- **At-the-time grade** — what the trade looked like given only information available when it happened. This must be a stored, immutable snapshot (Part 7 step 17), never recomputed after the fact.
- **Updated legacy grade** — how that same trade looks with hindsight, computed separately and always labeled as hindsight, never conflated with the at-the-time grade.
- **Trade Time Machine** — a chronological view of a trade's assets, including what a traded pick became once used, and how each side's return has performed since.
- **Pick tracking** — a pick is one asset across its full lifecycle: traded pick → drafted player → that player's ongoing value. The value engine (Part 6) must preserve this continuity.
- **Player drafted with pick** — resolved automatically from draft history the moment the draft happens, updating every Trade Time Machine entry that referenced the pick.
- **Value movement over time** — a time series, not a point-in-time number, for every asset in a trade.
- **Playoff odds impact** — before/after playoff-odds delta for each side (the existing Monte Carlo simulator already computes this; it currently has no route or UI — activating it is one of the cheapest, highest-value fixes identified in the pivot audit).
- **Championship impact, team record impact** — same idea, different horizon.
- **League setting impact, scoring impact, roster construction impact** — the trade evaluated in the actual context of this league's rules, not a generic context.
- **Manager past trade behavior, tendencies** — pulled from Manager OS, informing (not overriding) the evaluation.
- **Mutual benefit score** — see philosophy below.

**Product philosophy — stated explicitly because it should shape every UI decision downstream:**

> A trade is not fair unless both sides lose something and both sides gain something relevant to their goal.

Avoid a simple winner/loser framing entirely. A contender trading a rookie pick for a proven veteran and a rebuilder trading that veteran for the pick are *both* making the right move if the evaluation accounts for their actual goals — that's not a "loser" on either side. Prefer this vocabulary in every trade-facing surface: **Mutual Benefit, Strategic Fit, Contender Fit, Rebuilder Fit, Market Balance, Opportunity Cost, Risk, Confidence.** Never ship "Team A wins this trade" as a headline.

---

## Part 10 — Game Day Architecture

**Target state:** a single Game Day Hub — the surface that most literally proves the pivot thesis, and the one with the least existing code to build from (per the pivot audit, no version of this exists today in any form).

**Required capabilities:**
- **All-leagues view** — every imported league, one screen.
- **All-players view / player search** — the global player index, already real, extended to carry live status.
- **Player exposure** — how much of a manager's total roster footprint, across every league, is invested in a given player. (The underlying scoring function already exists and is format-agnostic; it has simply never been connected to real data or a real UI — this is a connection task, not new logic.)
- **Injury/status board** — status across every rostered player, every league, one place.
- **Questionable/out starter alerts** — specifically flagging when a *currently started* player's status changes, not just any status change.
- **Kickoff-window grouping** — early / late / Sunday night / Monday night slate buckets. Raw kickoff timestamps already exist in the schema; nothing currently groups them.
- **Weather risk, opponent risk** — surfaced per player, pulled from the existing weather pipeline and opponent-tracking logic, both of which exist today for native leagues only and need extending to imported ones.
- **Bench/waiver replacement suggestions** — a thin Game Day-specific view into Start/Sit OS and Waiver OS, not a new scoring system.
- **Deep links back to outside platforms** — every alert should link out to where the actual roster move needs to happen (Sleeper, ESPN, etc.), since AllFantasy isn't the system of record for the roster itself.
- **"Fix first" queue** — a single prioritized list across every league, of the highest-urgency lineup problems, ranked by kickoff proximity and impact.
- **Data freshness indicators** — every panel shows when it was last synced, using the freshness flags from Part 4 item 24; Game Day is the surface where staleness is most consequential, so it should never hide it.

**The single most important requirement, verbatim from the brief, restated as a binding spec:**

> A user should be able to search any player and instantly see every imported league where that player appears — owned by the user, benched by the user, starting for the user, playing against the user, available on waivers where known — along with injury/status, kickoff time, and a deep link back to that league.

This single feature does not exist in any form today. It is the highest-priority build in this entire spec, because it is the shortest path from "we imported your data" to "you can feel the product working."

---

## Part 11 — Commissioner Content Architecture

**Target state:** a content engine, owned by Commissioner OS, that produces copy-ready posts a commissioner can paste into their league's actual chat — Sleeper, ESPN, Yahoo, or Discord. No automated posting is required for an MVP; copy/paste is enough, and should remain the default even after direct-posting integrations exist, since commissioners often want to add their own voice before sending.

**Content types:** weekly league pulse, rivalry preview, playoff race update, upset recap, trade fallout, waiver recap, power rankings, manager spotlight, injury chaos report, championship odds update.

**Tone options:** clean, fun, spicy, commissioner-neutral. Tone is a rendering choice applied to the same underlying facts — never a different underlying analysis.

**Every piece of content must be grounded in real league data** — no generic filler, no content that could apply to any league. If League OS or Knowledge Graph data can't support a specific claim for a specific league, the content generator should omit that content type for that league rather than generate something vague.

---

## Part 12 — Specialty League Architecture

**Core architectural rule:** specialty formats are not redraft variants with a different label. They are separate rule adapters, each defining its own unique decision rules, plugged into the shared Trade/Waiver/Start-Sit/Decision Pipeline rather than reimplementing it.

**Formats with real, existing rule engines today** (per the pivot audit — these should be wrapped as format adapters onto the shared pipeline, not rebuilt): Dynasty, Keeper, Best Ball, Salary Cap, Guillotine, Survivor, Zombie, Tournament, Big Brother, Devy, C2C, IDP (a cross-format modifier, correctly not a standalone format).

**Formats that do not exist in code today and require new rule design, not consolidation:** Pirate and Empire.

### Pirate League — new rule adapter (design, not yet built)
A steal-mechanic format: winning a matchup grants some right to take an unprotected asset from the defeated opponent. The rule adapter must define:
- **Protected slots** — how many roster spots a manager may shield from steal each week/season.
- **Unprotected asset risk** — a live, per-player "steal exposure" score for every unprotected roster spot.
- **Steal risk scoring** — the probability and expected-value cost of a given asset being targeted, based on opponent strength and matchup outcome likelihood.
- **Best player to protect** — a weekly recommendation, informed by market value plus the manager's own roster need.
- **Best player to target after a win** — the mirror recommendation for the winning side.
- **Matchup-based theft strategy** — factoring in who a manager is actually playing this week, not a generic ranking.
- **Trade impact on steal exposure** — a trade that changes which assets are protected or exposed must be evaluated with steal risk as an explicit factor, not just raw value.
- **Waiver impact on protection strategy** — since a waiver add can either bolster a bench (adding exposed depth) or be an intentional decoy asset.

### Empire League — new rule adapter (needs product definition before engineering)
Unlike Pirate, "Empire" is not a standardized fantasy term with settled conventions the way Guillotine or Survivor are. Before this format is built, product needs to define its actual rule set (common conventions in the wild include expanded rosters, multi-conference/"kingdom" structures, or promotion/relegation between tiers) — this spec flags it as an open question (Part 17) rather than inventing rules without validation.

**For every specialty format**, the adapter must define: trade support (does this format even have trades — Survivor and Zombie currently don't), waiver support, evaluation/decision support, and which of the shared OS modules (Trade/Waiver/Start-Sit) it plugs into versus opts out of by design.

---

## Part 13 — Privacy, Trust, and Data Visibility

### Visibility matrix
| Data | Visible to importing user | Visible to commissioner | Visible in aggregate | Internal only | Never shown |
|---|---|---|---|---|---|
| Own team/roster/history | Yes | Yes (in-league) | — | — | — |
| Leaguemate data already public on source platform | Yes | Yes | — | — | — |
| Individual Manager Tendency Profile | Own only | In-league only | Anonymized, cohort-gated | Below cohort threshold | Cross-league to non-leaguemates |
| Trade intent pre-acceptance | Proposer only | No | No | Yes, until resolved | Other side / third parties |
| League Economy Snapshot | Yes | Yes | Platform-wide version, yes | — | — |
| Raw signal-level event logs | No | No | No | Yes | — |
| Model calibration data (seed dataset) | No | No | Tagged as seed-derived only | Yes | Presented as live personalization |

### Auditability
Every fact traces back to a specific import run and provider (Part 4 item 25). Every recommendation traces back to a decision snapshot (Part 7 step 17). Nothing in this system should ever be un-explainable after the fact.

### Source attribution, confidence, freshness
Every recommendation-facing surface shows: where the underlying data came from, how confident the system is (Part 7 step 13), and how fresh the data is (Part 4 item 24). These three labels are not optional polish — they are the trust mechanism that makes "we read your Sleeper league" credible instead of suspicious.

### User-facing disclaimers
Any output derived substantially from the small seed dataset (Part 3 §10) or from a low-cohort aggregate (Part 3 §6) should carry a plain-language note that the sample is limited — never presented with the same confidence as a fully-seasoned aggregate.

### Provider terms awareness
Each provider's access model carries its own trust posture: Sleeper (public API, low friction, implicitly broad usage terms), Yahoo (sanctioned OAuth, officially supported), MFL/Fleaflicker (public APIs, but currently open-read with no membership proof — a real gap, Part 4 item 3), ESPN (cookie-based, not an official partner integration — the least durable of the group, since it depends on undocumented auth surviving ESPN's own changes), Fantrax (no live API today at all). Provider-specific legal/ToS review is out of scope for this engineering spec but should happen before any provider's integration depth materially increases.

---

## Part 14 — Relationship to Licensed Decision OS

### Generic Licensed Decision OS
Reusable across industries. Owns: scoring, recommendation ranking, confidence, risk, evidence, outcome tracking, the learning/calibration framework itself. It should be possible to point this at a completely different domain (not fantasy sports) and have it still work, because it has no fantasy-specific knowledge baked in.

### AllFantasy Fantasy OS
The fantasy-specific application built on top of licensed Decision OS. Owns: every provider adapter, FantasyCalc, Rolling Insights, the player/league/trade/waiver/scoring/roster domain model, every specialty-format rule adapter, commissioner content, Legacy.

**The dividing line, stated as a rule:** if it depends on fantasy sports rules, players, providers, scoring, rosters, or commissioner behavior, it belongs in AllFantasy. If it is generic decision science — the kind of scoring/confidence/risk/evidence/outcome-tracking logic that would make sense in a completely different product — it belongs in the licensed Decision OS. When in doubt, ask: "would this line of code make sense if fantasy football didn't exist?" If yes, it's licensed Decision OS. If no, it's Fantasy OS.

---

## Part 15 — Implementation Roadmap

Phases in the requested order. Each includes goal, why it matters, dependencies, deliverables, test strategy, risk, and expected product impact.

### Phase 1 — Fantasy Knowledge Graph foundation
- **Goal:** stand up the entity/relationship/signal/aggregate model from Part 3 as a real, queryable layer — even before every consumer exists.
- **Why it matters:** every other phase either feeds this layer or reads from it; building it last would mean re-plumbing everything that came before.
- **Dependencies:** none — this can start immediately on top of existing imported data.
- **Deliverables:** entity/relationship schema, signal capture wired to existing trade/waiver/roster events, first two aggregates (PlayerExposureAggregate, ManagerTendencyProfile) computed from real data, cohort-size gating enforced from day one.
- **Test strategy:** aggregate correctness against known historical leagues; privacy/cohort-gating unit tests before any aggregate ships.
- **Risk:** building this ahead of consumers risks over-designing for hypothetical needs — keep the first version minimal (two aggregates, not all eight) and expand only as real consumers (Phase 4+) demand more.
- **Product impact:** invisible directly to users at first; everything after Phase 3 becomes meaningfully better because of it.

### Phase 2 — Sleeper import hardening
- **Goal:** fetch retry/backoff/timeout, honest error surfacing, no silent data loss — on the flagship, most-trusted provider.
- **Why it matters:** the pivot audit found the current Sleeper fetch path has none of this; large/old leagues are the likeliest to silently under-import exactly the historical depth every other phase depends on.
- **Dependencies:** none.
- **Deliverables:** resilient fetch service, freshness flags wired end to end, warnings surfaced to the user rather than swallowed.
- **Test strategy:** mocked-failure integration tests (network error, timeout, 429, 5xx) confirming retry + eventual honest failure, never silent null.
- **Risk:** low — this is hardening existing code, not new architecture.
- **Product impact:** protects trust in the provider almost every user will start with.

### Phase 3 — Provider/player identity normalization
- **Goal:** the canonical cross-platform player identity join described in Part 5, built from (and replacing the narrow scope of) FantasyCalc's existing identity directory.
- **Why it matters:** this is the join key every downstream layer depends on; nothing in Phases 4+ works correctly across more than one provider without it.
- **Dependencies:** Phase 1 (identity is itself an entity in the Knowledge Graph).
- **Deliverables:** a canonical player-identity table populated by every import adapter, not just read by valuation.
- **Test strategy:** cross-provider identity resolution accuracy against known players across at least three providers.
- **Risk:** medium — provider ID formats vary in reliability; some manual reconciliation may be needed for edge cases (practice-squad players, recently-signed free agents).
- **Product impact:** unlocks accurate cross-league features (Game Day search, exposure) for the first time.

### Phase 4 — Trade OS consolidation
- **Goal:** collapse the five existing trade systems onto the one Trade OS defined in Part 9.
- **Why it matters:** this is the highest-drag duplication found in the audit; it also blocks trade intelligence from working for non-Sleeper leagues today (the context assembler is hardcoded to Sleeper's client).
- **Dependencies:** Phase 1 (Manager tendencies, League economy), Phase 3 (player identity).
- **Deliverables:** one shared Decision Pipeline instance for trades, one canonical grading function, the dormant playoff-impact simulator wired to a real route, Trade Time Machine.
- **Test strategy:** parity tests against the outgoing systems' known-good historical grades before cutover; regression suite on the consolidated engine.
- **Risk:** highest in the roadmap — this touches the most existing surface area and the most user-visible numbers (trade grades). Stage behind a shadow/parity period before fully replacing any existing grader, the same pattern Decision OS already uses elsewhere in this codebase.
- **Product impact:** trade intelligence starts working for imported ESPN/Yahoo/Fantrax/MFL leagues, not just Sleeper — the first real proof of the pivot thesis at the trade layer.

### Phase 5 — Waiver OS consolidation
- **Goal:** the same consolidation, applied to the 6+ scattered waiver systems.
- **Why it matters:** same drag pattern as trades, smaller blast radius.
- **Dependencies:** Phase 1, Phase 3, and ideally Phase 4 (waiver and trade share the roster-need calculation — build it once, use it for both).
- **Deliverables:** one Waiver OS, a new waiver-grade capability (currently doesn't exist at all).
- **Test strategy:** same parity-then-cutover approach as Phase 4.
- **Risk:** medium.
- **Product impact:** waiver recommendations become cross-platform-consistent; waiver grades close a gap trade grades already partially cover.

### Phase 6 — Legacy rebuild
- **Goal:** retire the three competing Legacy surfaces (especially the hardcoded-mock one) into the real, already-existing second-generation engines.
- **Why it matters:** a live route serving fake numbers is a reputational risk that costs little to fix and currently sits alongside genuinely good real engines.
- **Dependencies:** Phase 1 (career-long aggregates benefit from the Knowledge Graph), Phase 4 (Trade Time Machine feeds Legacy's trade history).
- **Deliverables:** one Legacy home, real data throughout, Trade Time Machine and share cards integrated.
- **Test strategy:** content audit confirming no page in the Legacy surface renders non-derived/mock data.
- **Risk:** low-medium — mostly consolidation of already-real engines.
- **Product impact:** a coherent "fantasy resume" experience, safe to show to a prospective customer or investor without caveats.

### Phase 7 — Game Day Hub
- **Goal:** build the surface defined in Part 10 from scratch.
- **Why it matters:** this is the single feature that most literally proves "check AllFantasy instead of five apps" — and it doesn't exist yet in any form.
- **Dependencies:** Phase 3 (player identity, required for cross-league search), Phase 1 (exposure aggregate).
- **Deliverables:** all-leagues view, cross-league player search, exposure tracking connected to real data and a real UI, kickoff-window grouping, roster-status alerts actually wired to the injury pipeline (currently built but orphaned — the cheapest possible win in this whole roadmap).
- **Test strategy:** end-to-end test of the "search a player, see every league" requirement across at least two providers.
- **Risk:** low on the orphaned pieces (wiring existing logic); medium on the greenfield UI.
- **Product impact:** the highest-visibility, most differentiating surface in the entire product.

### Phase 8 — Commissioner OS consolidation
- **Goal:** collapse the four non-interoperating commissioner-intelligence subsystems onto League OS + Knowledge Graph.
- **Why it matters:** the same Hub currently can show numbers that disagree with each other, depending on which of four subsystems a given panel happens to read from.
- **Dependencies:** Phase 1, Phase 4/5 (commissioner briefs reference trade/waiver activity).
- **Deliverables:** one data source for the Commissioner Hub, the content engine from Part 11.
- **Test strategy:** consistency checks confirming every panel in the Hub reads the same underlying numbers for the same league.
- **Risk:** medium — this is the most mature existing product, so consolidation must not regress a working, revenue-relevant surface.
- **Product impact:** commissioner trust in the Hub's numbers; copy-ready content becomes a real, sellable feature.

### Phase 9 — Specialty League OS integration
- **Goal:** wrap the twelve existing format rule engines as format adapters onto the now-consolidated shared pipeline; design (not yet build) Pirate and Empire.
- **Why it matters:** these formats are the product's real differentiator versus Sleeper/ESPN/Yahoo, but only if they plug into one shared Trade/Waiver/Start-Sit pipeline rather than each reinventing it.
- **Dependencies:** Phases 4, 5, 7 must be stable first — adapting a format onto a pipeline that's still being consolidated doubles the work.
- **Deliverables:** format-adapter interface, all twelve existing formats ported, Pirate rule spec validated with real users before engineering begins, Empire rule set defined (open question, Part 17).
- **Test strategy:** per-format regression suite confirming format-specific behavior (e.g., Survivor/Zombie correctly opting out of trade support) survives the port.
- **Risk:** medium — twelve formats is a lot of surface area, but each is a port of existing logic, not new logic, except Pirate/Empire.
- **Product impact:** specialty-format users get the same intelligence depth Redraft users get, closing the gap the audit flagged.

### Phase 10 — Yahoo/ESPN/Fantrax/MFL expansion
- **Goal:** bring the remaining providers up to Sleeper's depth: playoff results (not just structure), a live Fantrax connector replacing the CSV-only path, a fully-fleshed Fleaflicker adapter.
- **Why it matters:** this is where "sits above every platform" stops being aspirational and becomes actually true for users on non-Sleeper platforms.
- **Dependencies:** everything above — this phase is deliberately last because expanding provider breadth before the core pipeline is consolidated would mean building four times the surface area on top of a foundation still being fixed.
- **Deliverables:** live Fantrax connector, complete Fleaflicker coverage, playoff/consolation bracket *results* modeled for every provider, tightened commissioner-import gating across the open-read providers.
- **Test strategy:** the same import-fidelity test suite Sleeper already has, run against each remaining provider.
- **Risk:** medium-high on Fantrax specifically (genuinely new integration, not hardening); low on the others.
- **Product impact:** the pivot's stated scope — every major platform — actually delivered, not just Sleeper.

---

## Part 16 — Engineering Principles

Binding for all future work on this codebase, grounded in specific duplication the pivot audit found:

- **Do not create another duplicate trade engine.** Five already exist; Phase 4 exists to end that, not to add a sixth.
- **Do not create another duplicate waiver engine.** Same rule, six-plus existing systems.
- **Do not create another duplicate commissioner system.** Four already disagree with each other; converge, don't add a fifth voice.
- **New features must consume shared OS services**, not reimplement scoring/valuation/tendency logic locally (the Trade Finder's own inline grader is the cautionary example — a fourth trade-grading implementation that nobody asked for and nobody consolidated).
- **Provider-specific logic belongs in adapters.** If a file imports a provider's client directly outside the adapter layer (the trade context assembler's hardcoded Sleeper import is the found example), that's a bug to fix, not a pattern to repeat.
- **Fantasy-specific logic belongs in Fantasy OS. Generic decision logic belongs in licensed Decision OS.** Apply the Part 14 test before writing new scoring/ranking code: would this make sense if fantasy football didn't exist?
- **Every recommendation must include evidence, confidence, risk, and source freshness.** Not optional fields — Part 7 steps 13-15 and Part 4 item 24 are load-bearing for user trust, not polish to add later.
- **Historical evaluations must distinguish at-the-time decision quality from later outcome quality**, always labeled as such, never silently blended (Part 9's grade/legacy-grade distinction is the concrete instance of this rule).
- **No AI-forward marketing language in user-facing product copy.** Use Intelligence, Decision Engine, Coach, Scout, Pulse, Brief, Command Center, Legacy. Never "AI Trade Analyzer," "AI Waiver Bot," "AI Coach," or "AI-generated" — even where the underlying computation is, in fact, deterministic non-AI logic, and even in the cases where an LLM genuinely is involved (Chimmy). The product's differentiator is being right and explainable, not being AI-labeled.

---

## Part 17 — Open Questions

1. **Empire League's actual rule set** — unlike every other specialty format in this spec, "Empire" has no settled convention to port from. Needs product definition and user validation before Part 12's adapter can be designed, let alone built.
2. **Open-read provider gating (MFL/Fantrax/Fleaflicker)** — should these converge to Sleeper/Yahoo/ESPN's membership-proof standard immediately, or is there a legitimate product reason (e.g., public-league browsing/scouting) to keep some read paths open? Needs a product decision, not just an engineering fix.
3. **Fantrax integration approach** — does a live Fantrax connector mean a public API (if one exists or can be obtained), authenticated scraping, or a partnership conversation with Fantrax directly? The audit only confirmed today's CSV-only state, not which path forward is viable.
4. **Cohort-size threshold for anonymized aggregates (Part 3 §6)** — this spec proposes n ≥ 20 as a starting point; the right number depends on how granular the aggregate is (a platform-wide format effect needs a much larger n than a single league's economy snapshot, which is inherently league-scoped and not anonymized the same way).
5. **Seed dataset decay schedule (Part 3 §10)** — this spec says seed-data weight should decay as real volume grows, but doesn't set the exact formula; that should be calibrated against real Phase 4+ usage once it exists, following the same real-volume-required precedent the Trade Learning workstream already established.
6. **CBS Sports / NFL.com Fantasy** — genuinely a scope decision (how much of the target user base plays there) rather than an architecture question; this spec assumes they're out of scope until that's answered.
7. **ESPN cookie-auth durability** — the least durable integration in the provider set, since it depends on undocumented auth. Worth a standing risk note rather than a fix, since there may be no fix short of ESPN offering an official API.

---

## Part 18 — First Recommended Implementation Prompt

For whoever (human or agent) picks up Phase 1 first, a self-contained starting prompt:

> Implement the Fantasy Knowledge Graph foundation described in Part 3 of `docs/os/ALLFANTASY_FANTASY_OS_ARCHITECTURE_SPEC.md`. Scope strictly to Phase 1 of the roadmap in Part 15: stand up the entity/relationship schema, wire signal capture from existing trade/waiver/roster events already flowing through the codebase, and compute exactly two aggregates first — `PlayerExposureAggregate` and `ManagerTendencyProfile` — from real imported data already in the database. Do not build the other six aggregates yet. Enforce the Part 3 §6 cohort-size gating (n ≥ 20 leagues, treated as a starting parameter, not final) from the very first version — no aggregate should ship without it. Do not touch the five existing trade-valuation systems, the waiver systems, or the Legacy pages in this pass; Phase 1 is foundation-only and deliberately does not consolidate anything yet. Read the current state of `lib/trade-*`, `lib/waiver-*`, and `lib/decision-os/behavioral` first to confirm what signal sources already exist before writing any new capture code — most of what Phase 1 needs to read from is already being written somewhere, it just isn't being read as one graph yet.
