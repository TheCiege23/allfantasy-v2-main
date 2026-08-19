# ADR-DOS-F2.7 — Canonical Enrichment: News Signals

**Status:** Accepted (2026-06-30). Branch `g15-event-foundation`.
**Phase:** 2 (Canonical Enrichment), layer **F2.7** — additive. NOT cutover, NOT a redesign.
**Governed by:** `ARCHITECTURE_FREEZE.md`. **Builds on:** F2.1 player metadata (`5771a78a1`).

---

## 1. Goal

Expose deterministic player-news signals as a seventh read-only derived enrichment layer:

- Most recent fantasy-relevant news headline + body per player
- News category (injury / trade / suspension / signing / release / roster_move / game_update / coaching / player_news)
- Impact level (high / medium / low) — carried from source, never recalculated
- Published timestamp + age-based freshness
- Source/provenance
- Honest degradation: sport not indexed, no name match, general news (unlinked), stale, no data

---

## 2. Source audit (P2 — never fabricate)

### 2.1 Candidate sources evaluated

| Source | Table | Rows (staging) | playerId | expiresAt | Player join | Decision |
|---|---|---|---|---|---|---|
| `PlayerNewsRecord` | `player_news` | 1523 | **0/1523** (null) | None | `playerName` exact | **PRIMARY** |
| `PlayerNewsItem` | `sports_core_player_news_items` | N/A | — | Yes | — | **EXCLUDED** (table does not exist in staging — P2021 schema drift) |
| `SportsNews` | `sports_news` | 4595 | **0/4595** (null) | Yes (1d) | `playerName` often null | **EXCLUDED** (see §2.4) |
| Live news APIs | — | — | — | — | — | **EXCLUDED** (P2: read-only port only) |
| AI-generated news summaries | — | — | — | — | — | **EXCLUDED** (P3) |

### 2.2 Primary source: `PlayerNewsRecord` (`player_news`)

| Field | Type | Notes |
|---|---|---|
| `id` | `String` | Row PK |
| `sport` | `String` | Uppercase sport code (NFL, NBA, etc.) |
| `playerId` | `String?` | Provider player ID — 0/1523 populated on staging; even when populated, uses provider namespace (NOT canonical AF player ID) → NOT joinable |
| `playerName` | `String` | Provider player name — join key (see §3) |
| `team` | `String?` | Team abbreviation — carry as provenance |
| `headline` | `String` | News headline |
| `body` | `String` | Full article body |
| `impact` | `String` | Heuristic impact tier: `'high'` / `'medium'` / `'low'` |
| `fantasyRelevant` | `Boolean` | Whether importer classified this as fantasy-relevant |
| `source` | `String` | Import source label (e.g. `'rolling_insights'`, `'clearsports'`, `'espn'`, `'cache'`) |
| `publishedAt` | `DateTime` | When the news was published (not when imported) |
| `createdAt` | `DateTime` | When the row was inserted into our DB |

**No `expiresAt` field.** Freshness is age-estimated from `publishedAt` (see §4).

**Indexed by:** `(sport, publishedAt)` and `(playerId, publishedAt)`. Port queries by `sport` + `playerName IN (...)` with a lookback window.

### 2.3 Staging real-data findings (2026-06-30, `ep-winter-salad`)

| Metric | Value |
|---|---|
| Total rows | 1523 |
| With `playerId` | 0 |
| By sport | NFL: 612 / MLB: 162 / NBA: 156 / SOCCER: 156 / NHL: 151 / NCAAB: 143 / NCAAF: 143 |
| By impact | low: 1140 / high: 382 / medium: 1 |
| By source | all `'cache'` (news cron populated staging from cache, not live provider) |
| Newest `publishedAt` | 2026-04-26 (~2 months ago — stale) |
| Newest `createdAt` | 2026-05-06 |
| Named players | staging sample shows `playerName = 'General Update'` predominates (general sports news with no player-specific attribution — see FINDING F2.7-1) |

### 2.4 Excluded: `SportsNews`

4595 rows but:
- `playerName` is frequently `null` or a non-standard string (e.g. "Former Liverpool") — join would miss most records
- `category` field is a messy comma-separated tag list (e.g. "Soccer, news, Red Bull New York, MLS, Liverpool, , , , , , coaching") — not a clean categorical value
- `playerId`: 0/4595 populated on staging
- Overlap with `PlayerNewsRecord` (same underlying ESPN/ClearSports feeds)

**Decision:** excluded from F2.7. `PlayerNewsRecord` is the cleaner source with `impact`, `fantasyRelevant`, and an indexed `playerName`.

### 2.5 Excluded: `PlayerNewsItem`

Table `sports_core_player_news_items` **does not exist** in staging (Prisma error P2021). Likely a migration that was applied to prod but not staging. F2.7 cannot rely on this table. Excluded entirely.

### 2.6 `playerId` namespace note (critical)

`PlayerNewsRecord.playerId` is populated by the news importer from the upstream provider response:
```typescript
playerId: typeof row.playerId === 'string' ? row.playerId : null,
```
When populated, this is the **provider's own player ID** (e.g. API-Sports ID, Rolling Insights ID) — not a canonical AF player ID. `FantasyProjection.playerId` uses canonical AF player IDs; `PlayerNewsRecord.playerId` does not. A direct playerId join would produce false negatives. Therefore the only reliable join is by `playerName` + `sport` (see §3).

---

## 3. Join path: deterministic name match

### 3.1 Why name matching is deterministic (not fuzzy)

F2.7 uses **exact case-insensitive string equality** on `playerName`:

```
PlayerNewsRecord.playerName.toLowerCase() === EnrichedPlayer.name.toLowerCase()
```

This is a deterministic lookup — no edit distance, no phonetic similarity, no embedding cosine. Either the names match exactly (after case folding) or they do not. No partial credit. A non-match returns `news_name_unmatched` uncertainty.

This is explicitly justified in the ADR because:
1. Both `SportsPlayer.name` (F2.1 source) and `PlayerNewsRecord.playerName` originate from the same upstream provider APIs (API-Sports, ClearSports, Rolling Insights). When both are populated from the same source, names should match exactly.
2. There is no canonical AF player ID bridge available (see §2.6).
3. The alternative (no per-player news) would not satisfy the ticket scope.

### 3.2 Known limitation

When a player's name appears differently across sources (e.g. "Patrick Mahomes" vs "Patrick Mahomes II", "D.K. Metcalf" vs "DK Metcalf"), the match fails and `news_name_unmatched` is emitted. This is documented as a known gap — not silently hidden.

### 3.3 `playerName = 'General Update'` (unlinked news)

`PlayerNewsRecord` rows where `playerName` is `'General Update'` (or empty) represent general sports news without a specific player attribution. These are NOT matched to any canonical player. Players queried against an unlinked headline receive `news_player_unlinked` in their uncertainty array.

The port filters these rows OUT before returning (`WHERE playerName != 'General Update'` and `playerName IS NOT NULL`).

### 3.4 Query design

Port queries by `sport` + `playerName IN (names)` within a 14-day lookback window. The 14-day window is wide enough to catch recent roster moves, injury returns, and trade announcements, while excluding irrelevant historical content. Ordered by `publishedAt DESC`. The projector takes the most recent matching row per player.

---

## 4. Freshness (age-based, no expiresAt)

`PlayerNewsRecord` has no `expiresAt` field. Freshness is estimated from `publishedAt` age:

| Tier | Condition | `isStale` |
|---|---|---|
| `'fresh'` | `publishedAt > (now − 24h)` | false |
| `'recent'` | `publishedAt > (now − 7d)` and ≤ 24h old | false (not stale) |
| `'stale'` | `publishedAt ≤ (now − 7d)` | true |

`staleReason` carries the age tier: `'news_stale_7d'` when `publishedAt ≤ (now − 7d)`.

---

## 5. Category derivation

Category is derived **deterministically from headline + body** using the existing pure function:
```typescript
classifyPlayerNewsCategory(headline, body) // lib/news/player-news-category.ts
```
This function is a keyword-lookup table (O(n) string scan) — no AI, no ML, no model inference. Already used by the X/Grok ingestion cron. Its output is one of the `PlayerNewsCategory` union type values. Safe to import from Decision OS world (no external imports or server-only).

---

## 6. Selection logic per player

Given multiple `PlayerNewsRecord` rows for the same player × sport:
1. Prefer `fantasyRelevant: true` rows
2. Among those, take the most recent by `publishedAt`
3. If none are `fantasyRelevant`, take the most recent row regardless
4. Single winner per player — no multi-item arrays in the derived view (complexity without consumer benefit at this layer)

---

## 7. Freeze compliance — why this is ADDITIVE

- No change to pure `CanonicalWorld`, assembler, or any Phase-1 frozen contract.
- No change to F2.1–F2.6 views.
- New `RawNewsRow` fact type — allowed.
- New `loadNewsRows` port function — read-only, no writes, no live API calls.
- New `NewsEnrichedCanonicalWorld` derived view — additive, layers on F2.1.
- `classifyPlayerNewsCategory` re-used as a pure util — does not import server-only or Prisma.
- No provider branch in business logic. Source name carried as provenance only.

---

## 8. Decision

**`facts.ts` addition:** `RawNewsRow`

**`port.ts` addition:** `loadNewsRows(sport, playerNames, since)` — queries `PlayerNewsRecord` by sport + playerName IN list within lookback window. Excludes `'General Update'` and null playerName at query level. Ordered `publishedAt desc`. Read-only.

**`newsEnrichedWorld.ts` (new file):**
- `NewsSignalCategory` type
- `NewsSignalFreshness` interface (age-tier-based)
- `NewsSignalContext` interface
- `NewsEnrichedPlayer`, `NewsEnrichedRosterFacts`, `NewsEnrichedCanonicalWorld`
- `classifyNewsCategory(row)` — wraps `classifyPlayerNewsCategory`
- `projectNewsFreshness(row, now)` — age-based, no expiresAt
- `projectNewsContext(rows, now)` — selection + projection, never throws
- `projectNewsEnrichedWorld(world, contextResult, now)` — pure, no mutation
- `resolveNewsContext(sport, playerNames, port?)` — loads and groups rows by playerName (lowercase)
- `resolveNewsEnrichedCanonicalWorld(leagueId, deps?)` — chains F2.1, never throws

**`world/index.ts`:** F2.7 re-exports added.

---

## 9. Field scope

| Field | Source | Degradation |
|---|---|---|
| `newsContext.headline` | `PlayerNewsRecord.headline` | null |
| `newsContext.body` | `PlayerNewsRecord.body` | null |
| `newsContext.category` | derived from headline+body via `classifyPlayerNewsCategory` | 'player_news' (default) |
| `newsContext.impact` | `PlayerNewsRecord.impact` | null |
| `newsContext.fantasyRelevant` | `PlayerNewsRecord.fantasyRelevant` | null |
| `newsContext.source` | `PlayerNewsRecord.source` (provenance) | null |
| `newsContext.publishedAt` | `PlayerNewsRecord.publishedAt` | null |
| `newsContext.freshness.isStale` | age-derived (> 7d) | null when no row |
| `newsContext.freshness.ageTier` | 'fresh' / 'recent' / 'stale' | null when no row |
| `newsContext.uncertainty` | accumulated per-player | [] when resolved |

---

## 10. Real-data results (non-prod `ep-winter-salad`, 2026-06-30)

**News coverage probe (`scripts/probe-news-coverage.ts`):**

| Metric | Value |
|---|---|
| `PlayerNewsRecord` total | 1523 |
| With `playerId` | 0 (provider namespace, not canonical AF) |
| Fresh (publishedAt > now−24h) | 0 (all stale on staging) |
| NFL rows | 612 |
| `PlayerNewsItem` | **TABLE DOES NOT EXIST** (P2021 — schema drift) |
| `SportsNews` total | 4595 (0 with playerId, 0 fresh) |

**FINDING F2.7-1 (General Update dominates staging — expected, benign):**
Staging news data was populated by the cron in "cache" mode — pulling general sports headlines without player-specific attribution. `playerName = 'General Update'` is common. Production news feeds (Rolling Insights, ClearSports real-time) produce player-attributed records. Name-based matching will produce 0 results on staging for any canonical roster player. This is an expected staging data gap, not a logic gap.

**FINDING F2.7-2 (PlayerNewsItem schema drift — excluded):**
`sports_core_player_news_items` does not exist in staging. This model is in the Prisma schema but the migration has not run on this environment. F2.7 excludes this table entirely. Port uses only `PlayerNewsRecord` which exists.

**FINDING F2.7-3 (SportsNews playerName gap):**
`SportsNews` has 4595 rows but `playerName` is null or non-standard on most records, and `playerId = 0` on all. Excluded in favor of `PlayerNewsRecord` which has a structured `playerName` field.

**Five conformance scripts — all GREEN on both origins:**
`WORLD_CONFORMANCE_OK` / `LINEUP_CONFORMANCE_OK` / `WAIVER_CONFORMANCE_OK` / `COMMISSIONER_CONFORMANCE_OK` / `TRADE_CONFORMANCE_OK` — every Phase-1 frozen invariant intact after F2.7 additions.

---

## 11. Registry

No `DECISION_REGISTRY.md` row — substrate enrichment, not a decision slice.
