# AllFantasy Fantasy Knowledge Graph — Specification

**Status:** Planning document. Read-only architecture task — no production code was written, refactored, or modified to produce this spec.
**Parent document:** [`ALLFANTASY_FANTASY_OS_ARCHITECTURE_SPEC.md`](ALLFANTASY_FANTASY_OS_ARCHITECTURE_SPEC.md) — this spec expands that document's Part 3 into the full, standalone design for the Fantasy Knowledge Graph (FKG). Where the two disagree in a small detail, this document is the more deliberated version for anything Knowledge-Graph-specific; the parent document remains authoritative for everything else (layer boundaries, roadmap phase order, OS module definitions).
**Position in the stack:**

```
Normalized Fantasy Data
        ↓
Fantasy Knowledge Graph   ← this document
        ↓
Decision OS
        ↓
Trade OS · Waiver OS · Legacy OS · Game Day OS
Commissioner OS · Manager OS · League OS · Specialty League OS
```

---

## Table of Contents

1. What the Fantasy Knowledge Graph Is
2. Entities
3. Relationships
4. Learning Signals
5. Derived Intelligence
6. Update Events
7. Historical Versioning
8. Confidence Model
9. Privacy Model
10. Per-OS Consumption
11. Deliverable: Architecture Diagram
12. Deliverable: Event Flow Diagrams
13. Deliverable: Query Examples
14. Deliverable: API / Service Boundaries
15. Deliverable: Recommended Implementation Order

---

## Part 1 — What the Fantasy Knowledge Graph Is

### Purpose
The FKG is the layer that turns *imported facts* into *fantasy understanding*. A single imported league can tell you what happened in that league. It cannot tell you whether a trade was fair relative to how trades like it usually go, whether a manager is a buyer or a seller this week, or how inflated quarterbacks currently are in Superflex formats platform-wide. Those questions require aggregating and continuously re-deriving patterns across every league AllFantasy has visibility into. That aggregation-and-derivation job — and only that job — is what the FKG exists to do.

### Responsibilities
- Model fantasy-specific entities and the relationships between them, in a shape every OS module can query the same way regardless of which platform the underlying data came from.
- Capture learning signals (the atomic events — a trade accepted, a claim lost) as they happen.
- Compute and continuously refresh derived aggregates (tendencies, economy snapshots, exposure, popularity) from those signals.
- Version everything that changes over time, so "what did we believe on date X" is always answerable, not just "what do we believe now."
- Attach confidence, freshness, and privacy metadata to every derived output, as a first-class part of the model rather than an afterthought.
- Serve as the one place every OS module queries for fantasy context, so no module re-derives its own competing version of "how aggressive is this manager."

### Boundaries — what it explicitly does NOT do
- **It does not store raw provider payloads.** That's the Provider Adapter Layer and Normalized Fantasy Data Layer's job (per the parent spec, Part 2). The FKG consumes normalized facts; it does not re-parse Sleeper JSON.
- **It does not rank or recommend anything.** Scoring, confidence-weighted ranking, and risk calculation for an actual decision are Decision OS's job. The FKG produces *evidence*; Decision OS turns evidence into a *recommendation*. If a piece of logic decides "this is the best trade to offer," it does not belong in the FKG.
- **It does not own live sports facts.** Injury status, weather, and news arrive from the Live Sports Data Layer; the FKG references them (an Injury Event is a fact the FKG links to, timestamps, and reasons over) but does not own their ingestion pipeline.
- **It does not own raw market value.** FantasyCalc's output is ingested elsewhere; the FKG's own `Player Value Snapshot` entity is a *derived*, format/league/team-adjusted value built on top of that raw ingestion, not a duplicate of it.
- **It does not render anything.** No UI, no copy generation — that's Feature Surfaces' job, several layers up.

### How it differs from a database
A database stores rows. The FKG stores **typed entities with semantic relationships, versioned history, and confidence/privacy metadata baked into the model itself** — it is queryable in terms of fantasy concepts ("this manager's trade tendency as of week 10," "this player's exposure across every league I can see") rather than in terms of tables and foreign keys. In implementation terms the FKG will very likely be *built on top of* the existing relational database (no wholesale migration to a graph database is implied or required), but the query and modeling layer sitting on top of that storage is what makes it a knowledge graph rather than "the app's tables." A database answers "what rows match this filter." The FKG answers "what does the platform currently believe about this manager, and how confident is it."

### How it differs from the licensed Decision OS
The FKG has fantasy semantics wired into its bones — it knows what a trade is, what a waiver claim is, what Superflex means. Decision OS knows none of that; it only knows how to take a set of scored candidates plus confidence/risk inputs and produce a ranked recommendation with an auditable trail. Swap fantasy football for a completely different domain and Decision OS should still work unmodified; the FKG would need to be rebuilt from scratch, because its entire value is being fantasy-specific. The dividing line from the parent spec applies directly: if it depends on fantasy rules, players, trades, or leagues, it's the FKG (or another Fantasy OS layer); if it's generic decision science, it's Decision OS.

---

## Part 2 — Entities

Each entity below is annotated with its versioning behavior: **immutable fact** (recorded once, never changes), **mutable reference** (can be updated in place, e.g. a player's current team), or **versioned derivation** (recomputed over time, every version retained — see Part 7).

| Entity | Definition | Versioning |
|---|---|---|
| **Player** | Canonical, cross-platform player identity — the join target every provider's player ID resolves to. | Mutable reference (position/team can change) |
| **Manager** | A cross-platform person identity — one Manager can hold multiple platform identities (a Sleeper user_id, an ESPN SWID). Not scoped to a single league. | Mutable reference |
| **Commissioner** | Not a separate identity — a **role** a Manager holds with respect to one specific League, established via the commissioner-attestation flow (parent spec Part 4). Modeled as a relationship (`Manager HOLDS_ROLE Commissioner OF League`), not its own entity type. | Relationship, not a standalone entity |
| **League** | One league-instance on one platform, with its own Rule Set, Scoring System, and Season chain. | Mutable reference (settings can change season to season) |
| **Season** | A time-bounded scope for a League — one year/cycle of play. | Immutable once closed; mutable while in progress |
| **Team** | A Manager's participation entity within one League, for one Season — "the roster this manager controls this year in this league." | Mutable reference while season is live; frozen at season close |
| **Roster** | The specific set of rostered players held by a Team, sliced by date/week. | Versioned derivation (a new slice each time it changes) |
| **Matchup** | A weekly head-to-head record between two Teams within a Season. | Immutable fact once the week completes |
| **Schedule** | The real-world sports schedule (kickoff times, bye weeks) that Matchups are anchored to — sourced from the Live Sports Data Layer, referenced (not owned) by the FKG. | Immutable fact once played |
| **Trade** | A completed or pending exchange of assets (players and/or Draft Picks) between two or more Teams. | Immutable fact once resolved (accepted/rejected/expired); the *evaluation* of a trade is a separate, versioned derivation (see Recommendation/Decision/Outcome Snapshots) |
| **Waiver / WaiverClaim** | A submitted claim by a Manager for a Player, with its outcome (won/lost). | Immutable fact once resolved |
| **Draft** | A single draft event for one League-Season. | Immutable fact once completed |
| **Draft Pick** | An asset representing a future or past draft selection — tracked across ownership and trade history, and resolving to a specific Player the moment it's used. | Mutable reference until used, then effectively immutable (resolved) |
| **Scoring System** | A named, versioned ruleset defining how fantasy points are computed for a League. | Mutable reference; changes are versioned events (Part 7) |
| **League Format** | The specialty-format type (Redraft, Dynasty, Guillotine, Pirate, etc.) governing a League's rule adapter. | Mutable reference (rare — a league could theoretically convert formats) |
| **Rule Set** | The full configured ruleset for a League: roster construction, waiver rules, trade rules, playoff rules — Scoring System is one component of it. | Mutable reference; changes are versioned events |
| **Platform** | Sleeper, ESPN, Yahoo, Fantrax, MFL, Fleaflicker, or a future provider. | Immutable reference data |
| **Player Value Snapshot** | The FKG's own **derived**, format/league/team-adjusted value for a player at a point in time — built on top of a raw FantasyCalc Snapshot, never a duplicate of it. | Versioned derivation |
| **Manager Behavior Profile** | Derived tendency model for a Manager: trade frequency, risk appetite, contender/rebuilder lean, waiver aggressiveness, negotiation style. | Versioned derivation |
| **League Economy Profile** | Derived model for a League: trade volume, waiver competitiveness, parity index, scoring-environment effects (Superflex QB inflation, TEP premium, etc.), specific to that league. | Versioned derivation |
| **Game Day Snapshot** | A rolling, short-retention capture of a Manager's cross-league game-day state: statuses, exposure, active alerts. Not a long-term historical record — it exists to serve the Game Day surface, refreshed continuously. | Rolling/ephemeral (short retention, not indefinitely versioned) |
| **Legacy Snapshot** | A point-in-time capture of a Manager's or League's career-level derived state (legacy score, career grade). Long-retained, since Legacy is inherently a historical narrative. | Versioned derivation, long-retained |
| **Recommendation Snapshot** | The specific recommendation actually surfaced to a user at a point in time — one candidate selected out of the Decision Snapshot's full candidate set. | Immutable once recorded |
| **Decision Snapshot** | The full pipeline state (context, all candidates, all scores, confidence, risk, evidence) at the moment a recommendation was generated — per the parent spec's Decision Pipeline step 17. A Recommendation Snapshot is one projection of a Decision Snapshot. | Immutable once recorded |
| **Outcome Snapshot** | What actually happened, captured later, linked back to the Decision Snapshot it evaluates — never merged into or overwriting the original decision. | Immutable once recorded |
| **Player Exposure** | A derived relationship/aggregate: how much of a Manager's (or Team's) total roster footprint, across every visible league, is invested in a given Player. | Versioned derivation |
| **Injury Event** | A fact from the Live Sports Data Layer, referenced (not owned) by the FKG, timestamped. | Immutable fact |
| **Weather Event** | A fact tied to a Matchup/game, referenced from the Live Sports Data Layer. | Immutable fact |
| **News Event** | A fact, optionally carrying a classified impact tag, referenced from the Live Sports Data Layer. | Immutable fact |
| **FantasyCalc Snapshot** | A raw, dated ingestion snapshot of FantasyCalc's market-value output. Owned by the Market Value Layer; the FKG references it as an input to Player Value Snapshot, it does not own the ingestion. | Immutable fact once ingested |
| **Rolling Insights Snapshot** | Same pattern — a raw ingested snapshot from Rolling Insights, referenced by the FKG for derived entities (Injury Event, Weather Event, News Event, live stats) but not owned by it. | Immutable fact once ingested |

---

## Part 3 — Relationships

| Relationship | Meaning |
|---|---|
| `Manager —OWNS→ Team` | Scoped to one Season; ownership is exclusive and time-bounded. |
| `Team —PARTICIPATES_IN→ League` | A Team exists only within one League-Season. |
| `Manager —HOLDS_ROLE→ Commissioner OF League` | The commissioner relationship, per Part 2. |
| `Roster —BELONGS_TO→ Team AT (date/week)` | A time-sliced ownership record, not a single static list. |
| `Player —APPEARS_IN→ League (via Roster)` | Derived from the Roster relationship, not stored redundantly. |
| `Trade —INVOLVES→ Manager × N, Asset × N (Player or Draft Pick)` | A Trade's asset list is the full ledger of what moved and to whom. |
| `Trade —PROPOSED_BY→ Manager`, `Trade —ACCEPTED_BY→ Manager` | Distinguishes initiator from acceptor, needed for tendency analysis (Part 5). |
| `WaiverClaim —SUBMITTED_BY→ Manager —TARGETS→ Player` | Basic claim relationship; outcome (won/lost) is an attribute of the claim, not a separate entity. |
| `Draft Pick —ORIGINALLY_BELONGS_TO→ Team`, `—TRADED_TO→ Team`, `—RESOLVES_TO→ Player` | The full lifecycle a pick moves through — this three-part chain is what makes Trade Time Machine (Part 7) possible. |
| `League —USES→ Rule Set` | One active Rule Set per League per Season. |
| `Rule Set —INCLUDES→ Scoring System` | Scoring System is a component, not a sibling, of Rule Set. |
| `League —HAS_FORMAT→ League Format` | Determines which specialty rule adapter applies. |
| `Player —HAS→ FantasyCalc Snapshot AT (date)` | Raw market value reference. |
| `Player —HAS→ Player Value Snapshot AT (date), DERIVED_FROM FantasyCalc Snapshot + Rule Set + Team context` | The FKG's own adjusted value, explicitly tracing its derivation inputs. |
| `Manager —HAS→ Manager Behavior Profile, DERIVED_FROM (signals)` | Always traceable to the signals that produced it (Part 4). |
| `League —HAS→ League Economy Profile, DERIVED_FROM (signals)` | Same traceability requirement. |
| `Recommendation Snapshot —CREATED_FROM→ Decision Snapshot` | A recommendation is always a projection of a fuller decision record. |
| `Decision Snapshot —RESULTED_IN→ Outcome Snapshot` | Linked later, after the outcome is knowable — never before. |
| `Player —HAS→ Injury Event AT (date)` | Time-anchored fact reference. |
| `Matchup —SCHEDULED_FOR→ Schedule entry` | Anchors fantasy Matchups to real-world kickoff times. |
| `Matchup —INVOLVES→ Team × 2` | Standard head-to-head relationship. |
| `Player —EXPOSURE_OF→ Manager` (aggregate, cross-league) | The relationship Player Exposure derives from — computed across every League a Manager participates in. |
| `Legacy Snapshot —SUMMARIZES→ Manager OR League AT (date)` | Career-level derivations can summarize either a person or a league's history. |

```
        Manager ──OWNS──> Team ──PARTICIPATES_IN──> League ──USES──> Rule Set ──INCLUDES──> Scoring System
           │                │                          │
           │                └──ROSTERS (via Roster)──> Player <──HAS── FantasyCalc Snapshot
           │                                             │
           │                                             └──HAS──> Player Value Snapshot
           │
           ├──HOLDS_ROLE──> Commissioner OF League
           ├──PROPOSED/ACCEPTED──> Trade ──INVOLVES──> Asset (Player | Draft Pick)
           ├──SUBMITTED──> WaiverClaim ──TARGETS──> Player
           └──HAS──> Manager Behavior Profile <──DERIVED_FROM── signals (Part 4)
```

---

## Part 4 — Learning Signals

Signals are the atomic, immutable events the FKG observes as they happen. They are never interpreted at capture time — interpretation happens in Part 5's derivation step, kept deliberately separate so the raw signal log stays a trustworthy, replayable source of truth.

| Signal | Captured when | Feeds |
|---|---|---|
| Trade acceptance | A Trade resolves as accepted | Manager Behavior Profile (trade frequency, style), League Economy Profile (trade volume) |
| Trade rejection | A Trade resolves as rejected/vetoed/expired | Manager Behavior Profile (negotiation tendency) |
| Waiver claims (submitted) | A WaiverClaim is filed | League Economy Profile (waiver competitiveness) |
| Waiver misses | A WaiverClaim resolves as lost | Manager Behavior Profile (waiver aggressiveness vs. success rate) |
| Roster churn | Add/drop/IR/taxi moves over a rolling window | Manager Behavior Profile (roster stability), League Economy Profile (activity level) |
| Draft tendencies | Draft picks used, by position/round/format | Manager Behavior Profile, League Economy Profile (positional runs) |
| Bench decisions | A started player underperforms a benched alternative, or vice versa | Manager Behavior Profile (risk tolerance), Decision quality (Part 5) |
| Playoff appearances | A Team qualifies for playoffs | Legacy Snapshot inputs, championship-likelihood derivation |
| Championships | A Team wins the league championship | Legacy Snapshot inputs |
| Player exposure events | A Player is added to/dropped from a Roster anywhere in the platform | Player Exposure aggregate |
| Manager aggressiveness | Composite of trade/waiver frequency relative to cohort baseline | Manager Behavior Profile |
| Risk tolerance | Composite of bench-decision and roster-construction volatility | Manager Behavior Profile |
| Rebuild signals | Trading proven veterans for picks/youth, roster age trend | Manager Behavior Profile (contender/rebuilder lean) |
| Contender signals | Trading picks/youth for proven veterans, especially near playoffs | Manager Behavior Profile (contender/rebuilder lean) |
| Pirate League stealing | A steal event resolves (format-specific — only exists once the Pirate rule adapter is built, parent spec Part 12) | Manager Behavior Profile (steal-exposure/protection tendency), FormatStrategyPattern |
| Guillotine survival | A Team survives an elimination round | FormatStrategyPattern (protect-vs-trade behavior near elimination) |

Each signal is stored with: the entities it references, a timestamp, the source platform, and (per Part 6) a link to whatever import/event run produced it — never as a bare, unattributed row.

---

## Part 5 — Derived Intelligence

Every derived output below is computed **from signals (Part 4), never directly from raw provider payloads** — this is the line that keeps the FKG's derivations honest and re-computable: if the signal log is complete, every derived value can be rebuilt from scratch.

| Derived intelligence | Computed from | Method category |
|---|---|---|
| **Manager psychology / Behavior Profile** | Trade, waiver, roster-churn, bench-decision signals | Multi-factor composite: frequency rates + decision-consistency scoring against the manager's own history, not just a cohort average |
| **League economy** | Trade/waiver volume, roster churn, scoring-environment facts | Rate-based aggregation (trades per week, claims per roster spot) plus a parity index (standings-spread statistic) |
| **Trade tendencies** | Trade acceptance/rejection signals, asset types traded | Categorical pattern detection (buys picks vs. players, favors upgrade-now vs. upgrade-later) |
| **Waiver tendencies** | Waiver claim/miss signals | Success-rate-adjusted aggressiveness score |
| **Player popularity** | Roster-add signals, platform-wide | Simple frequency count, cohort-normalized by format |
| **Position scarcity** | Roster composition across leagues of a given format | Supply/demand ratio relative to roster-construction rules for that format |
| **League activity** | All signal types, volume over a rolling window | Composite activity index, feeds Commissioner OS engagement patterns |
| **Manager trust** | Consistency between at-the-time trade grades and how a manager followed through (did they trade in good faith, complete transactions as agreed) | Reliability scoring — deliberately not a public-facing "trust score," internal signal only (Part 9) |
| **Decision quality** | Decision Snapshot vs. Outcome Snapshot pairs (Part 7) | At-the-time grade vs. realized-outcome comparison, always kept as two distinct labeled values, never blended |
| **Historical grades** | Trade/draft/season Decision & Outcome Snapshots | Time-series of grades, feeding Legacy Snapshot |
| **Player exposure** | Roster-add/drop signals across every League a Manager participates in | Simple cross-league aggregation (share of total roster spots occupied by a given player) |
| **Roster stability** | Roster churn signal, rolling window | Inverse of churn rate, cohort-normalized |
| **Championship likelihood** | Standings, remaining schedule, roster strength | Reuses the existing Monte Carlo playoff-odds approach already validated in the Trade OS's dormant playoff-impact simulator (parent spec Part 9) — the FKG should call that shared capability rather than re-implement Monte Carlo simulation a second time |

All of the above are recomputed on a schedule tied to Part 6's update events, never computed once and left stale.

---

## Part 6 — Update Events

Exactly what happens on each trigger. Every row follows the same shape: an event arrives → signals are recorded → affected derived entities are marked stale → recomputation runs (immediately for cheap aggregates, batched for expensive ones) → downstream consumers (Decision OS, Feature Surfaces) are notified via a version bump, never via a silent in-place overwrite.

| Trigger | What happens |
|---|---|
| **A Sleeper (or other provider) import runs** | New/updated Trade, WaiverClaim, Roster, Draft, Matchup facts are ingested into the Normalized Fantasy Data Layer, then diffed against the FKG's existing signal log; only genuinely new signals are appended (idempotent — re-running an import must not double-count history). Player Exposure and League Economy Profile for the affected League are marked stale. |
| **A trade occurs** | Trade acceptance/rejection signal recorded → Manager Behavior Profile (both sides) and League Economy Profile (that League) marked stale → Decision Snapshot (if this trade was previously recommended) gets its eventual Outcome Snapshot scheduled for later evaluation. |
| **A waiver claim occurs** | Waiver signal recorded → Manager Behavior Profile and League Economy Profile marked stale. |
| **A lineup changes** | Bench-decision signal recorded (only meaningfully once the underlying matchup result is known — a start/sit choice becomes a "bench decision" signal retroactively, once we know whether it mattered) → Manager Behavior Profile risk-tolerance component marked stale. |
| **A game finishes** | Matchup facts finalized (immutable from this point on) → Decision Snapshots referencing this game become eligible for Outcome Snapshot evaluation → Championship-likelihood derivation for both Teams recomputed. |
| **FantasyCalc updates** | New FantasyCalc Snapshot ingested (owned upstream) → every Player Value Snapshot depending on it is marked stale and recomputed through the full format/league/team adjustment chain (parent spec Part 6). |
| **Rolling Insights updates** | New Rolling Insights Snapshot ingested → Injury/Weather/News Events created/updated → Game Day Snapshot for every affected Manager marked stale (this is the highest-frequency update path, matching the "real-time/game day" cadence in the parent spec's Live Data Lifecycle). |
| **A player is injured** | An Injury Event is created → linked to every Roster currently containing that player → triggers a Game Day Snapshot refresh and, where the player is a currently-started asset, a downstream alert (consumed by Game Day OS, not generated by the FKG itself — the FKG raises the fact, Game Day OS decides how to alert). |
| **A commissioner changes rules** | Rule Set (and/or Scoring System) versioned — the old version is retained, never overwritten, since historical Trade/Decision grades computed under the old rules must remain valid for at-the-time analysis (Part 7). |
| **A season ends** | Season is closed (immutable from this point) → final standings/championship signals recorded → Legacy Snapshot generated for every Manager and the League itself → all in-season "current" derivations for that Season are frozen as historical, and a fresh in-progress set begins for the next Season. |

---

## Part 7 — Historical Versioning

**Core rule: nothing is overwritten. Every derived value is a time series, not a single mutable cell.**

- **Signals** (Part 4) are immutable and append-only from the moment they're recorded.
- **Derived entities** (Manager Behavior Profile, League Economy Profile, Player Value Snapshot, etc.) are recomputed on the update events in Part 6, but each recomputation produces a **new version**, tagged with `computed_at` (when the recompute happened) and `as_of` (the point in time the value describes). The prior version is retained, not replaced.
- This makes two distinct query shapes possible everywhere in the system:
  - **At-the-time analysis** — "what did the platform believe about this manager/trade/player on the date this decision was made?" Answered by fetching the version whose `as_of` is closest to (at or before) the query date.
  - **Current analysis** — "what does the platform believe right now?" Answered by fetching the latest version.
- **Legacy re-grading** is simply running current derivation logic against historical signals and storing the result as a *new, separately labeled* version — explicitly never overwriting the original at-the-time grade. A Decision Snapshot's original grade and any later re-grade are always both retrievable, both labeled for what they are, matching the parent spec's binding rule that at-the-time and hindsight evaluations must never be blended.
- **Trade Time Machine** is a query pattern over this versioning, not a separate storage mechanism: it walks a Trade's asset list, follows each Draft Pick through its `RESOLVES_TO Player` transition, and pulls the Player Value Snapshot time series for every asset on both sides — rendering value-over-time for a trade that may be years old, exactly because nothing along that chain was ever overwritten.
- **Playoff odds**, **decision quality**, and every other "important value" named in the brief follow the identical pattern: versioned, `as_of`-tagged, append-only.

---

## Part 8 — Confidence Model

Every derived insight the FKG produces is wrapped in a standard confidence envelope — not optional metadata bolted on later, but the shape every consumer (Decision OS, every Feature Surface) should expect by default:

| Field | Meaning |
|---|---|
| **confidence** | A normalized score reflecting how much the underlying signal supports this derivation — low for a brand-new manager with three transactions, high for a manager with three full seasons of signal. |
| **freshness** | Time since this specific version was computed, and time since the underlying signals last changed — surfaced distinctly, since a value can be "freshly computed" from stale underlying data if nothing new has happened. |
| **supporting evidence** | The specific signals/facts that drove this derivation, in a form traceable back to Part 4 — never a black-box number with no citation. |
| **sample size** | The count of underlying signals/leagues/managers contributing — required for every cohort-based aggregate (Part 9's anonymization threshold reads directly from this field). |
| **source attribution** | Which platform(s) and which import run(s) the underlying facts trace back to. |
| **risk** | A measure of how much this value could be wrong, distinct from confidence — confidence is "how much evidence do we have," risk is "how much does it matter if we're wrong" (a low-sample-size but low-stakes aggregate can ship; a low-confidence, high-stakes one should be suppressed or flagged). |
| **uncertainty** | A band or interval around the point value, where applicable (e.g., championship likelihood as a range, not a false-precision single percentage). |

Any derived entity below a minimum confidence/sample-size floor is either withheld from user-facing surfaces entirely or explicitly labeled as low-confidence — it is never presented with the same visual weight as a well-supported one. This mirrors the parent spec's disclaimer rule (Part 13) for seed-dataset-derived content.

---

## Part 9 — Privacy Model

This extends the parent spec's Part 3 privacy rules with FKG-specific enforcement detail.

- **Personal:** a Manager's own Behavior Profile, trade/waiver history, Player Exposure, and Legacy Snapshot — visible in full to that Manager.
- **League-visible:** whatever the source platform already exposes to all league members (rosters, trade history, standings) — visible to every Manager and Commissioner within that League.
- **Aggregate:** League Economy Profile, platform-wide format effects (Superflex inflation, TEP premium), FormatStrategyPattern — visible broadly, since these are not attributable to one individual.
- **Anonymous:** any cross-league surfacing of Manager-level patterns to a party outside that Manager's own leagues — permitted only stripped of identity and only once the cohort meets the minimum sample-size threshold from Part 8 (parent spec proposes n ≥ 20 leagues as a starting parameter).
- **Internal-only:** raw signal logs, Manager Trust scores (Part 5 — deliberately never public-facing), any aggregate below the cohort threshold, anything used solely for model calibration.
- **Never shown:** one Manager's pending/unresolved trade intent shown to the other side or third parties before it resolves; any derived insight whose confidence/risk profile falls below the presentation floor (Part 8).

**How imported public usernames improve the graph:** an import is first a product action serving the importing user; cross-manager learning is a byproduct of serving many users well, not a separate collection program. This is why derived Manager-level intelligence defaults to "visible to the manager and their own commissioner" and only becomes broader through the explicit anonymization step above — never through a lower bar applied by default.

**How the 100+ Sleeper seed dataset is safely used:** treated strictly as a cold-start bootstrap corpus for aggregate baselines (format effects, initial cohort sizes) — tagged distinctly as seed-derived in the confidence envelope's source-attribution field, weighted down as real customer signal volume grows in a given format, and never blended into a specific Manager's personalized Behavior Profile. This is the same precedent the Trade Learning workstream already established: a too-small real sample was ruled insufficient for calibration there, and seed data gets the same treatment here — useful for bootstrapping the cold-start problem, never substituted for real signal once real signal exists.

---

## Part 10 — Per-OS Consumption

| OS Module | Inputs from FKG | Typical queries | Outputs it produces | Cached | Live | Historical |
|---|---|---|---|---|---|---|
| **Trade OS** | Player Value Snapshot, Manager Behavior Profile (both sides), League Economy Profile, Draft Pick lineage | "Current adjusted value of these assets," "this manager's trade tendency," "this pick's resolution status" | Trade evaluation, at-the-time grade, mutual-benefit score | Player Value Snapshot (recomputed on FantasyCalc update) | Draft Pick resolution status | Full Trade/Draft Pick lineage for Time Machine |
| **Waiver OS** | Player Value Snapshot, Position Scarcity, League Economy Profile, Injury Event | "Replacement value of this player," "how competitive is this league's waiver wire" | Waiver recommendation, claim urgency | Position Scarcity | Injury Event (drives urgency) | Waiver claim history for tendency modeling |
| **Legacy OS** | Legacy Snapshot, Decision/Outcome Snapshot history, Historical Grades | "This manager's career grade as of every season," "trade time machine for this trade" | Career profile, career rankings, Trade Time Machine, share cards | Legacy Snapshot (recomputed at season end) | — (Legacy is inherently historical, minimal live dependency) | Full Season/Trade/Decision/Outcome history |
| **Game Day OS** | Game Day Snapshot, Player Exposure, Injury/Weather/News Events, Roster (current) | "Every league where this player appears," "current status of every rostered player for this manager" | Cross-league player search, exposure view, status board, alerts | Game Day Snapshot | Injury/Weather/News Events (highest-frequency layer in the whole system) | Not applicable — Game Day is explicitly rolling/ephemeral |
| **Manager OS** | Manager Behavior Profile, signals (Part 4) | "This manager's risk tolerance, negotiation style" | Behavior profile surfaced as context to other modules | Manager Behavior Profile | — | Behavior Profile version history (tendency drift over time) |
| **League OS** | League Economy Profile, League Activity, Position Scarcity | "This league's parity, trade market health, scoring environment" | League economy snapshot | League Economy Profile | League Activity (near-real-time engagement signal) | Economy Profile version history |
| **Commissioner OS** | League Economy Profile, League Activity, Legacy Snapshot (for storylines) | "This league's health," "rivalry/storyline material" | League health briefs, copy-ready content (parent spec Part 11) | League Economy Profile | League Activity | Legacy Snapshot for historical storyline material |
| **Specialty League OS** | FormatStrategyPattern, League Format, format-specific signals (Pirate steals, Guillotine survival) | "How do managers in this format typically protect/steal/survive" | Format-specific recommendations layered onto Trade/Waiver/Start-Sit OS | FormatStrategyPattern | Format-specific live signals (e.g., an active steal window) | Format-specific historical pattern data |

Every module reads through the FKG's Query Service (Part 14) — none writes directly to another module's derived entities, and none re-derives an aggregate another module already owns.

---

## Part 11 — Deliverable: Architecture Diagram

```
┌───────────────────────────────────────────────────────────────────────┐
│                     NORMALIZED FANTASY DATA LAYER                       │
│         (leagues, managers, rosters, trades, drafts, matchups)          │
└───────────────────────────────────┬─────────────────────────────────┘
                                     │ facts
                                     ▼
┌───────────────────────────────────────────────────────────────────────┐
│                      FANTASY KNOWLEDGE GRAPH                            │
│                                                                          │
│   ┌───────────────┐     ┌────────────────────┐     ┌─────────────────┐  │
│   │ Signal Capture │ ──▶ │ Entity/Relationship │ ──▶ │ Derivation       │  │
│   │ (Part 4)        │     │ Model (Parts 2–3)    │     │ Engine (Part 5)  │  │
│   └───────────────┘     └────────────────────┘     └────────┬────────┘  │
│                                                               │            │
│                                                               ▼            │
│   ┌────────────────────────────────────────────────────────────────┐    │
│   │  Versioned Derived Store (Part 7) — every aggregate time-sliced,  │    │
│   │  wrapped in a Confidence Envelope (Part 8), privacy-gated (Part 9) │    │
│   └───────────────────────────────────┬────────────────────────────┘    │
│                                        │                                  │
│                              Query Service (Part 14)                     │
└────────────────────────────────────────┬─────────────────────────────┘
                                          │ evidence, not decisions
                                          ▼
┌───────────────────────────────────────────────────────────────────────┐
│                            DECISION OS                                  │
│        (generic scoring, confidence, risk, recommendation ranking)      │
└───────────────────────────────────┬─────────────────────────────────┘
                                     ▼
┌───────────────────────────────────────────────────────────────────────┐
│  Trade OS · Waiver OS · Legacy OS · Game Day OS · Manager OS            │
│  League OS · Commissioner OS · Specialty League OS                      │
└───────────────────────────────────────────────────────────────────────┘

External joins (referenced, not owned, by the FKG):
  Live Sports Data Layer  ──▶ Injury/Weather/News Events, Rolling Insights Snapshot
  Market Value Layer      ──▶ FantasyCalc Snapshot  ──▶ Player Value Snapshot (derived)
```

---

## Part 12 — Deliverable: Event Flow Diagrams

**Flow A — a Sleeper import runs:**
```
Provider Adapter normalizes payload
        │
        ▼
Normalized Fantasy Data Layer updated (new/changed facts)
        │
        ▼
FKG Signal Capture diffs against existing signal log (idempotent — no double-counting)
        │
        ▼
New signals appended (immutable)
        │
        ▼
Affected derived entities marked stale:
   Player Exposure · League Economy Profile · Manager Behavior Profile
        │
        ▼
Derivation Engine recomputes (cheap aggregates immediately, expensive ones batched)
        │
        ▼
New versions written to the Versioned Derived Store (old versions retained)
        │
        ▼
Consumers notified via version bump (Decision OS, Feature Surfaces re-query, never push-overwritten)
```

**Flow B — a trade occurs:**
```
Trade resolves (accepted/rejected) in Normalized Fantasy Data Layer
        │
        ▼
Trade acceptance/rejection signal recorded (immutable)
        │
        ▼
Manager Behavior Profile (both sides) + League Economy Profile marked stale, recomputed
        │
        ▼
If this Trade was previously the subject of a Recommendation Snapshot:
   an Outcome Snapshot is scheduled for later evaluation (not computed yet — outcome isn't knowable immediately)
        │
        ▼
Trade Time Machine entry created: asset list + Draft Pick lineage + initial Player Value Snapshot references
```

---

## Part 13 — Deliverable: Query Examples

Conceptual, not literal query syntax — illustrating what the Query Service (Part 14) must be able to answer:

1. *"What is this manager's trade tendency, as of week 10 of this season?"* → fetch `Manager Behavior Profile` version with `as_of` ≤ week 10, filtered to the trade-tendency sub-component, returned with its confidence envelope.
2. *"Show me the full value history of this trade, including what the picks became."* → walk `Trade.assets`, follow each `Draft Pick.RESOLVES_TO Player`, pull `Player Value Snapshot` time series for every resulting asset — the Trade Time Machine pattern (Part 7).
3. *"Every league where Player X appears, and this manager's exposure to them."* → traverse `Player —EXPOSURE_OF→ Manager` across every League the querying Manager participates in, joined with current Roster status and the latest Injury Event.
4. *"How inflated are QBs in Superflex leagues right now, platform-wide?"* → aggregate `League Economy Profile` scoring-environment component across every League with `League Format = Superflex`, gated by the Part 9 cohort-size threshold before being returned as a platform-wide statistic.
5. *"What did we believe about this trade's fairness on the day it happened, versus what we believe now?"* → fetch the original `Decision Snapshot` (`as_of` = trade date) and separately the current re-derived grade, returned as two explicitly labeled values, never merged.
6. *"Is this a good week to trade this player, given his team's remaining schedule and this league's playoff push signals?"* → join `Player Value Snapshot` (playoff-context adjusted) with `League Economy Profile`'s activity signal and the requesting Team's own contender/rebuilder lean from `Manager Behavior Profile`.

---

## Part 14 — Deliverable: API / Service Boundaries

The FKG exposes exactly two service boundaries — nothing else should read or write its internals directly:

- **Signal Ingestion Service** — the only write path. Consumes events from Part 6's triggers (import runs, trades, waiver claims, lineup changes, game completions, external-layer updates, rule changes, season closes). Idempotent by design — replaying the same upstream event must never double-record a signal. No OS module writes derived entities directly; only the Ingestion Service, via the Derivation Engine, produces new versions.
- **Query Service** — the only read path for every OS module (Part 10). Every response is wrapped in the Part 8 confidence envelope and passed through the Part 9 privacy gate before leaving the service — privacy and confidence are enforced at the boundary, not left to each consuming module to remember to apply. Supports both "current" and "as_of" query modes natively (Part 7), so no consumer needs its own historical-lookup logic.

No OS module should hold a direct database connection into the FKG's storage. This is what makes "no duplicate trade engine, no duplicate waiver engine" (parent spec Part 16) actually enforceable — if every module is required to go through the Query Service for fantasy context, there's no path to quietly re-deriving a competing version of a Manager Behavior Profile inside a module-specific table.

---

## Part 15 — Deliverable: Recommended Implementation Order

A more granular build sequence than the parent spec's Phase 1, scoped specifically to standing up the FKG itself:

1. **Entity/relationship schema** — Parts 2–3, modeled on top of existing storage (no wholesale migration implied).
2. **Signal Ingestion Service, minimal** — wire capture for the signals that already have clear upstream sources today (trade acceptance/rejection, waiver claims, roster churn) before attempting format-specific signals (Pirate stealing) that don't have a source yet because the format itself doesn't exist.
3. **Two seed derivations only** — `Manager Behavior Profile` and `Player Exposure`, matching the parent spec's Phase 1 scope exactly. Resist building all of Part 5's derivations at once.
4. **Confidence envelope** — wrap those two derivations in the full Part 8 shape from day one; retrofitting confidence metadata onto an already-shipped aggregate is much more expensive than building it in from the start.
5. **Versioned Derived Store** — the `as_of`/`computed_at` versioning model (Part 7), proven against the two seed derivations before any more are added.
6. **Privacy gate enforcement** — the cohort-size threshold and visibility rules (Part 9), enforced inside the Query Service before any aggregate is exposed beyond the owning manager.
7. **Query Service, minimal surface** — enough to serve the two seed derivations to one real consumer (recommend Manager OS, since it's the most direct consumer of Manager Behavior Profile) before opening the service to every OS module.
8. **Remaining derivations** — League Economy Profile, Player Value Snapshot (once Player Value Snapshot's upstream dependency, the cross-platform player identity graph from the parent spec's Phase 3, exists), then the rest of Part 5 in whatever order matches which OS module is being built next per the parent spec's Phase 4+ roadmap.
9. **Decision/Outcome Snapshot wiring** — only once at least one OS module (Trade OS, per the parent spec's Phase 4) is ready to produce real Decision Snapshots for the FKG to later evaluate.
10. **Full per-OS consumption wiring** — Part 10's table, completed module by module as the parent spec's roadmap reaches each one, never all at once.

This order deliberately mirrors the parent spec's "don't consolidate before you've proven which system should be canonical" caution: build the graph's foundation and exactly two real derivations first, prove the versioning/confidence/privacy model works end to end on those two, and only then expand breadth.
