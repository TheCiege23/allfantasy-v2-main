# AllFantasy Shared Fantasy Data Model — Specification

**Status:** Planning document. Read-only architecture task — no production code, schema, or existing model was written, modified, or refactored to produce this spec.
**Builds on, does not replace:**
- [`ALLFANTASY_FANTASY_OS_ARCHITECTURE_SPEC.md`](ALLFANTASY_FANTASY_OS_ARCHITECTURE_SPEC.md) — layer boundaries, OS modules, roadmap (authoritative for everything outside the data model itself).
- [`ALLFANTASY_FANTASY_KNOWLEDGE_GRAPH_SPEC.md`](ALLFANTASY_FANTASY_KNOWLEDGE_GRAPH_SPEC.md) — the FKG's entities, signals, and versioning model (authoritative for anything *derived*; this document defines the canonical *shape* those derived entities are exchanged in, it does not redefine how they're computed).

**What this document is:** the Shared Fantasy Data Model (SFDM) — the one set of canonical object shapes every provider adapter normalizes into, every layer reads and writes through, and every UI surface renders from. Its entire purpose is eliminating the possibility of "Sleeper's version of a Trade" and "ESPN's version of a Trade" ever existing as two different shapes anywhere past the adapter boundary.

**Terminology reconciliation (read this first):** the FKG spec named several derived entities (`Player Value Snapshot`, `Manager Behavior Profile`, `League Economy Profile`, `Legacy Snapshot`, `Player Exposure`) as part of its own entity model. This document's canonical objects `PlayerValue`, `ManagerProfile`, `LeagueProfile`, `LegacyProfile`, and `PlayerExposure` are **the same concepts, given their canonical wire-shape** — the FKG spec defines how they're computed and versioned; this document defines the shape every consumer sees regardless of which layer populated it. They are not a second, competing set of entities. Where a name differs slightly (`PlayerValue` here vs. `Player Value Snapshot` there), treat them as identical; this document's shorter names are the canonical field/type names, the FKG spec's names are descriptive.

---

## Table of Contents

1. Design Principles
2. Canonical Objects
3. Identity Resolution
4. Provider Mapping
5. Versioning Rules
6. Ownership Rules
7. Validation Rules
8. Testing Strategy
9. Deliverable: Entity Relationship Diagram
10. Deliverable: Recommended Implementation Sequence

---

## Part 1 — Design Principles

**Canonical object philosophy.** There is exactly one shape per concept. A `Trade` is a `Trade` whether it happened on Sleeper or ESPN — the object never carries a `sleeperTrade` vs. `espnTrade` distinction past the adapter boundary. Every field on a canonical object must be meaningful for every provider that can produce one; a field only one provider can populate does not belong on the canonical object (it belongs in the extension bag — see below).

**Provider independence.** No canonical object may contain a provider-specific field at its top level. Decision OS, the Knowledge Graph, and every Feature Surface must be able to operate on a canonical object without ever checking which platform it came from. If a piece of downstream logic branches on provider type, that's a signal the canonical model is missing something it should have normalized away.

**Versioning.** Two versioning regimes apply, and every canonical object declares which one it follows: **immutable-once-resolved** (a fact that becomes permanent once an event completes — a `Trade` once accepted, a `Draft` once completed) and **time-sliced current+historical** (a mutable-while-live object — a `Roster`, `LeagueSettings` — that is snapshotted at meaningful boundaries rather than versioned continuously). Derived objects (`PlayerValue`, `ManagerProfile`, `LeagueProfile`, `LegacyProfile`, `PlayerExposure`) additionally follow the FKG's full `as_of`/`computed_at` continuous versioning, since they're recomputed on a rolling basis rather than at discrete real-world events. Full detail in Part 5.

**Immutability rules.** Once a real-world event is final (a trade accepted, a draft pick used, a matchup played, a season closed), the canonical object recording it does not change. Corrections are modeled as a new, explicitly-flagged correction record referencing the original — never a silent in-place edit, because every derived intelligence computation (FKG) and every historical decision snapshot (Decision OS) may already be built on top of the original.

**Identity resolution.** Every canonical object that represents a real-world entity (a person, a player, a league) has exactly one canonical identifier, generated once. Provider-specific identifiers are stored as a map keyed by platform, never used as the object's primary key elsewhere in the system. Full detail in Part 3.

**Source attribution.** Every canonical object instance carries a `sourceAttribution` block: which platform it came from, which import run produced or last updated it, and when that import ran. This is not optional metadata — it is what makes every downstream confidence/freshness claim (per the FKG's Confidence Envelope) actually traceable back to a real fetch.

**Time-awareness.** Any canonical object whose meaning depends on when you're asking (a `LeagueSettings` that changed mid-season, a `PlayerValue` that drifts weekly) carries an explicit validity window (`effectiveFrom`/`effectiveTo`, or the FKG's `as_of`), never just a bare "current value."

**Extension strategy.** A canonical object may carry a bounded `providerExtensions` bag — a namespaced, platform-keyed field for genuinely provider-specific data that doesn't (yet) belong in the canonical schema. Core logic must never require reading from `providerExtensions`; it exists so provider peculiarities aren't lost, not so they leak into shared logic. Extensions are reviewed periodically (Part 8): any field a majority of providers end up populating is a promotion candidate into the canonical schema itself, so the extension bag doesn't quietly become a second, ungoverned data model.

---

## Part 2 — Canonical Objects

Every object below states: **fields** (the essential set, not an exhaustive production schema), **owning layer** (single owner — see Part 6 for the full rule), **lifecycle** (which versioning regime from Part 1 applies), **required identifiers**, **key relationships**, and **source attribution** behavior.

### Identity & Access

| Object | Fields | Owning layer | Lifecycle | Required identifiers | Relationships | Source attribution |
|---|---|---|---|---|---|---|
| **PlatformIdentity** | platform, providerUserId, displayName, avatarUrl, linkedAt | Normalized Data Layer | Immutable-once-linked (a link event is permanent; unlinking creates a new event, doesn't erase history) | `platform + providerUserId` (natural key) | `BELONGS_TO` one `FantasyUser` | platform + linkedAt |
| **FantasyUser** | canonicalUserId, linked PlatformIdentities[], createdAt | Normalized Data Layer | Mutable reference (identities can be added over time) | canonicalUserId (system-generated, once) | `HAS_MANY` PlatformIdentity; `IS` the account a Manager role attaches to | n/a (system-generated, not sourced from a provider) |
| **Manager** | canonicalManagerId, FantasyUser ref, display context per League | Normalized Data Layer | Mutable reference | canonicalManagerId | `OWNS` Team (per League-Season); `HOLDS` CommissionerRole (optional, per League) | derived from FantasyUser, no independent source |
| **CommissionerRole** | League ref, Manager ref, attestationMethod (self-declared / platform-verified), grantedAt | Normalized Data Layer | Immutable-once-granted (revocation is a new event) | `League + Manager` (natural key) | `Manager —HOLDS_ROLE→ League` | platform + attestation method, since the parent spec flags this as a real trust surface (Part 4/13) |

### League Structure

| Object | Fields | Owning layer | Lifecycle | Required identifiers | Relationships | Source attribution |
|---|---|---|---|---|---|---|
| **League** | canonicalLeagueId, platform, platformLeagueId, name, sport, currentSeason ref | Normalized Data Layer | Mutable reference | `platform + platformLeagueId` (natural key) → canonicalLeagueId | `HAS_MANY` LeagueSeason; `HAS` LeagueFormat, LeagueSettings | platform + platformLeagueId, always |
| **LeagueSeason** | League ref, year, previousSeason ref (chain), closedAt | Normalized Data Layer | Immutable once closed; mutable while in progress | `League + year` | chains backward via `previousSeason` | inherited from League |
| **LeagueSettings** | rosterConstruction, waiverRules, tradeRules, playoffStructure, effectiveFrom/To | Normalized Data Layer | Time-sliced current+historical (Part 5) — a mid-season change creates a new slice, never overwrites | `League + effectiveFrom` | `BELONGS_TO` League; referenced by every Trade/WaiverClaim evaluation active during its window | platform + import run that captured the settings |
| **LeagueFormat** | formatType (redraft/dynasty/guillotine/pirate/etc.), formatVersion | Normalized Data Layer | Mutable reference (rare change) | `League` (one active format) | drives which Specialty League OS adapter applies | platform-declared where available, otherwise commissioner-declared |
| **LeagueScoring** | statCategory → point value map, modifiers (TEP, bonus thresholds) | Normalized Data Layer | Time-sliced current+historical | `League + effectiveFrom` | component of LeagueSettings | platform + import run |

### Roster & Players

| Object | Fields | Owning layer | Lifecycle | Required identifiers | Relationships | Source attribution |
|---|---|---|---|---|---|---|
| **Roster** | Team ref, asOfDate, slots[] | Normalized Data Layer | Time-sliced (a new slice on every meaningful roster change) | `Team + asOfDate` | `HAS_MANY` RosterSlot | platform + import run |
| **RosterSlot** | slotType (starter/bench/IR/taxi), Player ref (nullable if empty) | Normalized Data Layer | Component of Roster's time-slice | `Roster + slotType + position` | `REFERENCES` Player | inherited from Roster |
| **Player** | canonicalPlayerId, name, position, currentTeam, provider ID map | Normalized Data Layer | Mutable reference | canonicalPlayerId (cross-platform join target — see Part 3) | `APPEARS_IN` many Rosters across many Leagues | resolved from the cross-platform identity graph, not one single provider |
| **PlayerSeason** | Player ref, sport-season, stats, games played | Normalized Data Layer | Immutable once the season closes | `Player + sport-season` | `BELONGS_TO` Player | Live Sports Data Layer (Rolling Insights primarily) |
| **PlayerStatus** | Player ref, status (active/Q/O/IR/inactive), asOf | Normalized Data Layer (canonicalized here; sourced from Live Sports Data) | Time-sliced, high-frequency | `Player + asOf` | referenced by Game Day OS, RosterSlot validity | Live Sports Data Layer, timestamped |
| **PlayerValue** *(= FKG's "Player Value Snapshot")* | Player ref, rawMarketValue, formatAdjusted, leagueAdjusted, teamAdjusted, playoffContextAdjusted, asOf | Knowledge Graph | Continuous versioned derivation (FKG Part 7) | `Player + League/Format context + asOf` | `DERIVED_FROM` FantasyCalc Snapshot + LeagueSettings + Team context | Market Value Layer (raw) + FKG derivation lineage |

### Transactions

| Object | Fields | Owning layer | Lifecycle | Required identifiers | Relationships | Source attribution |
|---|---|---|---|---|---|---|
| **Trade** | canonicalTradeId, League ref, participating Teams[], assets[], status, resolvedAt | Normalized Data Layer | Immutable-once-resolved | `League + platformTradeId` → canonicalTradeId | `INVOLVES` TradeAsset × N | platform + platformTradeId |
| **TradeAsset** | Trade ref, assetType (Player/DraftPick), fromTeam, toTeam | Normalized Data Layer | Component of Trade, immutable with it | `Trade + assetType + assetRef` | `REFERENCES` Player or DraftPick | inherited from Trade |
| **TradeOutcome** | Trade ref, at-the-time grade, current re-grade (labeled separately, never blended), playoff-odds delta | Decision OS | Continuous versioned derivation, at-the-time value frozen forever | `Trade + gradeType (at-the-time / current)` | `EVALUATES` Trade, `DERIVED_FROM` PlayerValue time series | Decision OS's Decision/Outcome Snapshot lineage |
| **WaiverClaim** | canonicalClaimId, League ref, Manager ref, Player ref, bid/priority, outcome (won/lost) | Normalized Data Layer | Immutable-once-resolved | `League + platformClaimId` | `SUBMITTED_BY` Manager `TARGETS` Player | platform + platformClaimId |

### Draft

| Object | Fields | Owning layer | Lifecycle | Required identifiers | Relationships | Source attribution |
|---|---|---|---|---|---|---|
| **Draft** | canonicalDraftId, LeagueSeason ref, draftType, completedAt | Normalized Data Layer | Immutable once completed | `LeagueSeason` (one Draft per season, typically) | `HAS_MANY` DraftPick | platform + platformDraftId |
| **DraftPick** | canonicalPickId, originalTeam, currentOwner, round/slot, resolvedPlayer (nullable until used) | Normalized Data Layer | Mutable reference until resolved, then immutable | `LeagueSeason + round + originalTeam` (natural key, stable even as ownership changes via trades) | `ORIGINALLY_BELONGS_TO`/`TRADED_TO` Team, `RESOLVES_TO` Player | platform + import run; resolution event specifically timestamped |

### Schedule & Matchups

| Object | Fields | Owning layer | Lifecycle | Required identifiers | Relationships | Source attribution |
|---|---|---|---|---|---|---|
| **Matchup** | canonicalMatchupId, League ref, GameWeek ref, Teams[2], scores, finalizedAt | Normalized Data Layer | Immutable once finalized | `League + GameWeek + Teams` | `INVOLVES` Team × 2; `SCHEDULED_FOR` Schedule entries (real-world games) | platform + import run |
| **Schedule** | real-world game, kickoff time, venue | Normalized Data Layer (referenced from Live Sports Data Layer, canonicalized here for join purposes) | Immutable once played | `sport + season + week + teams` | referenced by Matchup, GameWeek | Live Sports Data Layer |
| **GameWeek** | League ref, weekNumber, startDate/endDate, slateGrouping (early/late/SNF/MNF — parent spec Part 10 gap) | Normalized Data Layer | Immutable once the week closes | `League + weekNumber` | `HAS_MANY` Matchup | platform + import run, slate grouping computed not sourced |
| **PlayoffBracket** | League ref, structure (team count, rounds, consolation), results (currently a known gap — structure-only today per the pivot audit) | Normalized Data Layer | Immutable once the bracket resolves | `LeagueSeason` | `COMPOSED_OF` Matchup (playoff-flagged) | platform + import run; results field explicitly nullable until the modeling gap (Part 7) is closed |

### Decision & Recommendation

| Object | Fields | Owning layer | Lifecycle | Required identifiers | Relationships | Source attribution |
|---|---|---|---|---|---|---|
| **Recommendation** | candidate selected, presented-to Manager, presentedAt | Decision OS | Immutable once recorded | `DecisionSnapshot + candidateRank` | `CREATED_FROM` DecisionSnapshot | Decision OS pipeline run id |
| **DecisionSnapshot** | full candidate set, scores, confidence, risk, evidence, generatedAt | Decision OS | Immutable once recorded | pipeline run id | `RESULTED_IN` OutcomeSnapshot (later) | Decision OS pipeline run id, referencing every FKG/PlayerValue input it read |
| **OutcomeSnapshot** | DecisionSnapshot ref, what actually happened, evaluatedAt | Decision OS | Immutable once recorded | `DecisionSnapshot + evaluatedAt` | `EVALUATES` DecisionSnapshot | Decision OS, referencing the real-world facts (Matchup/Trade/Season outcome) it compared against |

### Derived Profiles

| Object | Fields | Owning layer | Lifecycle | Required identifiers | Relationships | Source attribution |
|---|---|---|---|---|---|---|
| **LegacyProfile** *(= FKG "Legacy Snapshot")* | Manager or League ref, career grade, historical rankings, asOf | Knowledge Graph | Continuous versioned derivation, long-retained | `subject (Manager/League) + asOf` | `SUMMARIZES` Manager or League history | FKG derivation lineage |
| **ManagerProfile** *(= FKG "Manager Behavior Profile")* | Manager ref, tendency scores, risk profile, asOf | Knowledge Graph | Continuous versioned derivation | `Manager + asOf` | `DERIVED_FROM` signals (FKG Part 4) | FKG derivation lineage |
| **LeagueProfile** *(= FKG "League Economy Profile")* | League ref, economy/activity/parity metrics, asOf | Knowledge Graph | Continuous versioned derivation | `League + asOf` | `DERIVED_FROM` signals | FKG derivation lineage |
| **PlayerExposure** | Manager ref, Player ref, exposure share across visible Leagues, asOf | Knowledge Graph | Continuous versioned derivation | `Manager + Player + asOf` | cross-league aggregation over Roster | FKG derivation lineage |

### Game Day

| Object | Fields | Owning layer | Lifecycle | Required identifiers | Relationships | Source attribution |
|---|---|---|---|---|---|---|
| **GameDayAlert** | Manager ref, Player ref, alertType (status change/kickoff/weather), raisedAt, acknowledged | Feature Surface (Game Day OS) | Rolling/ephemeral — not indefinitely retained, matching the FKG's Game Day Snapshot lifecycle | `Manager + Player + alertType + raisedAt` | `TRIGGERED_BY` PlayerStatus change or GameWeek proximity | Game Day OS, referencing the PlayerStatus/GameWeek fact that triggered it |

---

## Part 3 — Identity Resolution

**Platform user → FantasyUser.** A `PlatformIdentity` links to a `FantasyUser` only through an explicit user action — login, OAuth grant, or an explicit username-claim flow. Identity merging is **never inferred or fuzzy-matched from behavior**; two accounts that happen to look similar are not silently merged. This is both a correctness rule (avoids merging two different real people) and a privacy rule (avoids the appearance of AllFantasy silently correlating identities a user didn't explicitly connect).

- Sleeper user → `PlatformIdentity(platform=sleeper, providerUserId=user_id)` → linked to a `FantasyUser` at import time.
- Yahoo user → `PlatformIdentity(platform=yahoo, providerUserId=GUID)` → linked via the OAuth flow (parent spec Part 4).
- ESPN user → `PlatformIdentity(platform=espn, providerUserId=SWID)` → linked when the user supplies their cookie credentials.
- Fantrax user → `PlatformIdentity(platform=fantrax, providerUserId=synthetic username-based id)` → linked at CSV-upload time today (parent spec Part 3's Fantrax gap applies here too — this identity link is currently the weakest of the group since there's no live auth flow).
- All four (and any future platform) converge on **one `FantasyUser`** the moment a user has linked more than one — the object model supports this from day one, it's not a later migration.

**Player IDs.** Resolved via the cross-platform player identity graph described in the parent architecture spec (Phase 3 of its roadmap) — built from, and superseding the narrow scope of, FantasyCalc's existing Sleeper/ESPN/Yahoo/MFL/Fleaflicker ID directory. Every provider's native player ID is stored in `Player.provider ID map`; `canonicalPlayerId` is the one ID every downstream layer actually uses. A player with no confident cross-platform match yet (a rookie not in FantasyCalc's directory, for instance) still gets a canonical ID immediately — the map is simply sparse until reconciliation catches up, never blocking.

**League IDs.** Leagues are **not** merged across platforms — a manager's Sleeper league and ESPN league remain two separate `League` objects, linked only indirectly through the shared `Manager`/`FantasyUser`. There is no real-world concept of "the same league on two platforms" to reconcile; this is different from Player identity, where the same real person plays across platforms.

**Draft Picks.** Resolved via a natural key of `LeagueSeason + round + originalTeam` — stable even as the pick changes hands through trades, which is exactly what lets `DraftPick.currentOwner` and `DraftPick.RESOLVES_TO Player` update over time without ever needing a new canonical ID.

**Historical seasons.** Each provider exposes its own season-chaining mechanism (Sleeper's `previous_league_id`, ESPN's league-history endpoint, similar concepts for Yahoo/MFL). The SFDM maps every one of these onto a single canonical `LeagueSeason.previousSeason` chain per `League`, so Legacy OS and the FKG never need to know which provider-specific mechanism produced the chain.

---

## Part 4 — Provider Mapping

| Canonical object | Sleeper | Yahoo | ESPN | Fantrax | MFL | Future providers |
|---|---|---|---|---|---|---|
| PlatformIdentity | `user_id` (public API) | OAuth GUID | SWID + espn_s2 cookie pair | synthetic username-based id (no live auth) | user-supplied API key | must supply a real auth model before onboarding |
| League / LeagueSeason | full, 10-season chain via `previous_league_id` | full, gated `includePreviousSeasons` flag | full, 6-season chain | manual per-CSV-upload only — no season chain | full, 8-season chain | — |
| LeagueSettings / LeagueScoring | full, including nonstandard modifiers (TEP etc.) | full (`statModifiers`) | full (`mSettings`, `scoringItems`) | partial, inferred from CSV | full, parsed from XML | — |
| Roster / RosterSlot | full | full | full | partial, from CSV | full | — |
| Trade / TradeAsset | full (one bucket with transactions) | full (message-type parsed) | full (activity feed) | **partial, from uploaded CSV only — no live ingestion** | full | — |
| WaiverClaim | same bucket as Trade | full | same activity feed | partial, inferred | full | — |
| Draft / DraftPick | full | full | full (`mDraftDetail`) | partial, inferred | full (`draftResults`) | — |
| Matchup / GameWeek | full, weeks 1–18 | full | full (schedule + scoreboard merged) | partial, depends on uploaded exports | full | — |
| PlayoffBracket | **structure only — no results modeled** (platform-wide gap, not Sleeper-specific) | structure only | structure only | inferred from schedule flags | structure only | must include real bracket outcomes, not just team count/start week, to close this gap |
| PlayerValue | via FantasyCalc + Rolling Insights joins (provider-agnostic once canonical Player ID resolves) | same | same | same | same | — |

**Fleaflicker** (a sixth existing provider, not in the brief's list but present in the current import registry) is the thinnest of all: only Roster/standings map with any confidence today — Trade, WaiverClaim, PlayoffBracket, and LeagueScoring are effectively unmapped, a gap the parent audit already flagged as needing dedicated work before Fleaflicker can be treated as a first-class provider.

**Cross-cutting gap, every provider:** PlayoffBracket results (not just structure) is unmapped platform-wide — this is a Normalized Data Layer / schema gap, not a provider-adapter gap, since no provider's canonical object even has a field for it yet.

---

## Part 5 — Versioning Rules

Nothing important overwrites. Three regimes, applied per Part 2's per-object lifecycle column:

1. **Immutable-once-resolved facts** (`Trade`, `WaiverClaim`, `Draft`, `DraftPick` post-resolution, `Matchup`, `PlayoffBracket`) — written once, at the moment the real-world event completes, and never edited afterward. A correction is a new record referencing the original via an explicit `correctsRecord` field, never an in-place edit — this matters because Decision OS's `DecisionSnapshot`s and the FKG's signal log may already reference the original by the time an error is caught.
2. **Time-sliced current+historical** (`LeagueSettings`, `LeagueScoring`, `Roster`) — mutable while the real-world thing they describe is still live, but every meaningful change creates a new slice with an `effectiveFrom` (and the prior slice gets an `effectiveTo`), rather than being overwritten in place. This is what lets a `Trade` evaluated in week 3 be re-examined later using the `LeagueSettings` that were actually in effect in week 3, even if the commissioner changed a rule in week 10.
3. **Continuous versioned derivation** (`PlayerValue`, `ManagerProfile`, `LeagueProfile`, `LegacyProfile`, `PlayerExposure`, `TradeOutcome`) — the FKG's `as_of`/`computed_at` model, inherited wholesale from the Knowledge Graph spec rather than redefined here. Every recomputation is a new version; the prior version is retained indefinitely for at-the-time queries and Legacy re-grading.

**How historical snapshots coexist with current state:** every query against a canonical object implicitly asks for "current" unless it explicitly supplies an `asOf`/point-in-time parameter. The default is always the latest version; the historical path is opt-in, never the reverse — this keeps ordinary reads simple while making Trade Time Machine / at-the-time analysis a supported first-class query, not a special case bolted on.

---

## Part 6 — Ownership Rules

Exactly one owning subsystem per object. Every other subsystem reads through that owner's service boundary — never via a direct connection to the owner's storage.

| Object | Owning subsystem |
|---|---|
| PlatformIdentity, FantasyUser, Manager, CommissionerRole | **Normalized Data Layer** |
| League, LeagueSeason, LeagueSettings, LeagueFormat, LeagueScoring | **Normalized Data Layer** |
| Roster, RosterSlot | **Normalized Data Layer** |
| Player, PlayerSeason | **Normalized Data Layer** (Player identity resolution lives here even though the underlying stats are sourced from Live Sports Data) |
| PlayerStatus | **Normalized Data Layer** (canonicalized here; raw status facts are sourced from, but not owned by, the Live Sports Data Layer) |
| PlayerValue | **Knowledge Graph** |
| Trade, TradeAsset, WaiverClaim | **Normalized Data Layer** (the raw fact of what happened) |
| TradeOutcome | **Decision OS** (the *evaluation* of the fact, a distinct concern from the fact itself) |
| Draft, DraftPick | **Normalized Data Layer** |
| Matchup, Schedule, GameWeek, PlayoffBracket | **Normalized Data Layer** |
| Recommendation, DecisionSnapshot, OutcomeSnapshot | **Decision OS** |
| LegacyProfile, ManagerProfile, LeagueProfile, PlayerExposure | **Knowledge Graph** |
| GameDayAlert | **Feature Surface** (Game Day OS) — it consumes Knowledge Graph data but the alert itself, as a specific surfaced notification, is a presentation-layer artifact |

**Preventing duplicate ownership, as a rule, not just a table:** if a future feature seems to need to write to an object outside its own row above, that is a signal the feature has drifted outside its module boundary (per the parent spec's Part 16 engineering principles), not a signal the ownership table needs an exception. The Provider Adapter layer writes nothing directly to canonical objects — it only produces normalized payloads that the Normalized Data Layer's own ingestion service converts into canonical objects, matching the FKG's Signal Ingestion Service pattern one layer up.

---

## Part 7 — Validation Rules

| Validation | Rule |
|---|---|
| **Roster completeness** | Every `RosterSlot` resolves to a valid `Player` reference or is explicitly marked empty — no slot may reference a `canonicalPlayerId` that doesn't resolve. |
| **Trade integrity** | Every `TradeAsset` must reference a `Player` or `DraftPick` that was actually owned by a participating `Team` at the moment the trade resolved — no dangling or retroactively-invalid asset references. |
| **Manager mapping** | Every `Manager` resolves to exactly one `FantasyUser`; no orphaned `PlatformIdentity` without a linking event. |
| **League settings** | `LeagueSettings` must fully populate every field its declared `LeagueFormat` requires (e.g., a Salary Cap format League must have cap fields present, not null) — an incomplete settings record for a format that requires them is a validation failure, not a silently-accepted partial import. |
| **Scoring** | `LeagueScoring`'s stat-category map must validate against the known stat categories for that League's sport — an unrecognized stat category is flagged, not silently dropped. |
| **Playoff structure** | `PlayoffBracket.structure` must match `LeagueSettings.playoffStructure` (team count, round count) — and, per the known platform-wide gap in Part 4, the `results` field is validated as *legitimately nullable* today rather than treated as a data-quality failure, until that modeling gap is closed. |
| **Historical consistency** | A `LeagueSeason` chain must have no gaps or cycles; each season's closing state must be reconcilable with the following season's carryover (rollover picks, keeper designations) where the format requires it. |

---

## Part 8 — Testing Strategy

**Contract tests, one suite per canonical object.** For every object in Part 2, a contract test suite asserts: every provider adapter that can produce this object type produces a conformant instance (all required fields present, correct types, valid relationships) — run against every provider, not just the one being actively developed. This is what catches "ESPN's adapter silently omits `TradeAsset.fromTeam`" before it reaches Decision OS.

**Golden-fixture tests.** Real captured payloads per provider (already partially established precedent in this codebase, per the existing Sleeper validation league referenced in the audit) mapped to an expected canonical output — regression protection against an adapter change silently altering the canonical shape it produces.

**Validation-rule property tests.** Each Part 7 rule gets its own property-based test, run against every provider's normalized output, not hand-picked examples.

**Extension-bag promotion audit.** A periodic (not per-PR) test/report that scans `providerExtensions` usage across all providers and flags any field populated by a majority of them as a promotion candidate into the canonical schema — this is what keeps the extension strategy (Part 1) from becoming an ungoverned second data model by default.

**Cross-provider parity tests.** For any canonical object every provider can produce, a test asserting that semantically-identical source data (the same real trade, described in each platform's native shape) produces byte-for-byte identical canonical objects modulo `sourceAttribution` — the strongest possible proof that "no provider-specific object leaks past the adapter boundary" is actually true, not just asserted.

---

## Part 9 — Deliverable: Entity Relationship Diagram

```
FantasyUser ──HAS_MANY──> PlatformIdentity
     │
     └──IS──> Manager ──OWNS──> Team ──PARTICIPATES_IN──> League ──HAS──> LeagueSeason (chained)
                  │                  │                        │
                  │                  │                        ├──HAS──> LeagueSettings (time-sliced)
                  │                  │                        ├──HAS──> LeagueFormat
                  │                  │                        └──HAS──> LeagueScoring (time-sliced)
                  │                  │
                  │                  └──HAS──> Roster ──HAS_MANY──> RosterSlot ──REFERENCES──> Player
                  │                                                                    │
                  │                                                                    ├──HAS──> PlayerSeason
                  │                                                                    ├──HAS──> PlayerStatus
                  │                                                                    └──HAS──> PlayerValue (KG-owned)
                  │
                  ├──HOLDS_ROLE──> CommissionerRole OF League
                  │
                  ├──(via Team)──> Trade ──INVOLVES──> TradeAsset ──REFERENCES──> Player | DraftPick
                  │                    │
                  │                    └──HAS──> TradeOutcome (Decision-OS-owned)
                  │
                  ├──(via Team)──> WaiverClaim ──TARGETS──> Player
                  │
                  └──HAS──> ManagerProfile, LegacyProfile, PlayerExposure (all KG-owned)

League ──HAS──> Draft ──HAS_MANY──> DraftPick ──RESOLVES_TO──> Player
League ──HAS_MANY──> GameWeek ──HAS_MANY──> Matchup ──INVOLVES──> Team × 2 ──SCHEDULED_FOR──> Schedule
League ──HAS──> PlayoffBracket ──COMPOSED_OF──> Matchup (playoff-flagged)

DecisionSnapshot ──CREATED──> Recommendation
DecisionSnapshot ──RESULTED_IN──> OutcomeSnapshot   (all three Decision-OS-owned)

GameDayAlert ──TRIGGERED_BY──> PlayerStatus change | GameWeek proximity   (Feature-Surface-owned)
```

---

## Part 10 — Deliverable: Recommended Implementation Sequence

Scoped specifically to standing up the SFDM itself — narrower than, and feeding directly into, the parent architecture spec's Phase 1–3.

1. **Identity & Access objects first** (`PlatformIdentity`, `FantasyUser`, `Manager`, `CommissionerRole`) — every other object depends on a resolved identity existing; building anything else first means re-keying it later.
2. **League Structure objects** (`League`, `LeagueSeason`, `LeagueSettings`, `LeagueFormat`, `LeagueScoring`) — the container every transactional object needs to reference.
3. **Roster & Player objects**, *excluding* `PlayerValue` (`Roster`, `RosterSlot`, `Player`, `PlayerSeason`, `PlayerStatus`) — `PlayerValue` is deliberately deferred to step 6, since it depends on the cross-platform player identity graph being reliable first (parent spec Phase 3), not just the canonical `Player` shape existing.
4. **Transactions and Draft objects** (`Trade`, `TradeAsset`, `WaiverClaim`, `Draft`, `DraftPick`) — these are the objects the Knowledge Graph's signal capture (FKG Part 4) directly depends on; sequence this before Knowledge Graph work begins in earnest.
5. **Schedule & Matchup objects** (`Matchup`, `Schedule`, `GameWeek`, `PlayoffBracket`) — including deliberately building the `PlayoffBracket.results` field into the schema now even though no provider adapter populates it yet, so the Part 4 cross-provider gap has somewhere to land the moment it's closed.
6. **PlayerValue**, once the cross-platform player identity graph (parent spec Phase 3) is reliable enough to key it correctly.
7. **Decision & Recommendation objects** (`Recommendation`, `DecisionSnapshot`, `OutcomeSnapshot`) — sequenced to align with the parent spec's Phase 4 (Trade OS consolidation), since that's the first real consumer.
8. **Derived Profile objects** (`LegacyProfile`, `ManagerProfile`, `LeagueProfile`, `PlayerExposure`) — sequenced to align with the FKG spec's own build order (its Part 15), which starts with `ManagerProfile` and `PlayerExposure` specifically.
9. **GameDayAlert**, last — it depends on `PlayerStatus`, `GameWeek`, and `PlayerExposure` all being real first, matching the parent spec's Phase 7 (Game Day Hub) sequencing.
10. **Contract + golden-fixture test suites** (Part 8) stood up incrementally alongside each step above, never retrofitted after the fact — a canonical object without a contract test the moment it's introduced is exactly how the five-competing-trade-systems problem the parent audit found happens again.
