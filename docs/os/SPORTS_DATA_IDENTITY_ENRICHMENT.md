# Deterministic Identity Source Enrichment — Fantasy OS Phase 5F-d

Raises deterministic ESPN→canonical identity coverage by adding a **second** trusted cross-reference source. Coverage went **54.4% → 78.5%** (stat rows) / **56.9% → 75.4%** (unique athletes). No name/fuzzy/LLM matching; scoring inputs unchanged.

## Identity-source inventory (audited, not assumed)
Searched every identity source in the project for a deterministic ESPN cross-reference:

| source | ESPN cross-ref? | usable? |
|---|---|---|
| **Sleeper directory** (`espn_id` per player) | ✅ dual-id record | **used (Tier-1, source A)** — ~55% of players |
| **FantasyCalc directory** (`sleeperId` + `espnId` per record) | ✅ dual-id record | **used (Tier-1, source B)** — 2,702 espn ids; covers players Sleeper leaves null |
| `PlayerIdentityMap.espnId` | populated by 5F-c (from Sleeper) | already the target table |
| `SportsPlayer.externalId/sleeperId` | no espn; 0 rows in non-prod | no |
| Rolling Insights / API-Sports ids | `configured_not_verified` (no verified request) | not usable (unverified) |
| MFL / Yahoo / Fantrax / fleaflicker / clearSports ids | not ESPN | no |
| ESPN core athlete directory | espn id + name, **no canonical anchor** | would require name matching → **rejected** |
| Sleeper other ids (gsis/yahoo/sportradar/rotowire…) | not ESPN | no |

**Finding:** exactly two trusted deterministic sources supply ESPN↔canonical cross-references — **Sleeper** and **FantasyCalc**. Both are fantasy-skill-focused; neither carries ESPN ids for most **IDP/defensive** players.

## Sources actually used & priority
Precedence (explicit, deterministic): **Tier-1 A = Sleeper** (primary), then **Tier-1 B = FantasyCalc** (secondary). Both are *direct dual-id* records (one trusted record holds both ids). **Never** name inference. When A and B agree, the mapping is attributed to A; a mapping only B has is attributed to B (its incremental contribution).

## Multi-source pipeline
```
fetchSleeperEspnCrosswalk (adapter) ─┐
fetchFantasyCalcEspnCrosswalk (adapter) ─┼─→ classifyMultiSourceCandidates (pure)
                                        │      • cross-source conflict: one sleeper id with DIFFERENT espn ids
                                        │      • one espn id ↔ >1 sleeper id
                                        │      • quarantine conflicts; attribute verified to highest-precedence source
                                        └─→ runMultiSourceIdentityPopulation → conflict-safe idempotent upsert
                                             → PlayerIdentityMap → statistics re-resolution (append-only)
```
Reuses the Phase-14 resolver, `statisticsIdentityResolver`, the 5F-c population/upsert, and append-only snapshots. No identity logic duplicated.

## Conflict rules (strict)
If two trusted sources **disagree** on a sleeper id's espn id → **quarantined**, never written, never overwritten. One espn id claimed by >1 sleeper id → quarantined. Confidence is never lowered.

## Resolution metrics (proving run, non-prod, real game `401671744`, 2024 Wk1)
**Population (multi-source):**
| source | totalPlayers | withEspn | **contributed** |
|---|---|---|---|
| sleeper (A) | 12,200 | 6,736 | **6,689** |
| fantasycalc (B) | 4,034 | 2,702 | **924** (new, Sleeper-lacked) |

Cross-source conflicts quarantined: **44**. Created 924 · unchanged 6,689 · skipped 0. `PlayerIdentityMap` **6,718 → 7,642**.

**Certified-statistics re-resolution (append-only):**
| level | before (5F-c) | **after (5F-d)** | total |
|---|---|---|---|
| statistics rows resolved | 43 (54.4%) | **62 (78.5%)** | 79 |
| unique athletes resolved | 37 (56.9%) | **49 (75.4%)** | 65 |

New snapshot: 19 newly resolved, 60 suppressed, 0 changed; prior snapshot retained; stat values unchanged.

## Success target: ≥80% — actual 78.5% (rows) / 75.4% (athletes) — NOT met
**Standards were not lowered.** The remaining gap (17 rows / 16 athletes) is covered by **neither** Sleeper nor FantasyCalc and is almost entirely **IDP/defensive** players (defensive, punt-return, and some deep-roster skill). **Limiting provider gap:** both trusted sources are fantasy-skill-focused and lack ESPN ids for defensive players; the only source with espn ids for IDP players is **ESPN itself, which carries no canonical anchor** (resolving it would require name matching — prohibited). This limitation is **conclusively external** (a provider-coverage gap, not a code gap). Exceeding 80% requires an **IDP-inclusive deterministic crosswalk source** not present in the project.

## Operator observability
`identityCoverage` (counts only: `identityMapRows` / `withEspnId` / `withSleeperId`) is exposed via the admin+gated observability route. Per-source contribution is reported by the population run summary (not persisted — no migration).

## Scoring safety
Production scoring unchanged (`PlayerWeeklyScore` / `PlayerGameLogCache` authoritative). Resolved certified statistics are still not a scoring input.

## Remaining blockers before certified statistics become a scoring candidate
1. IDP/defensive identity resolution (needs an IDP-inclusive deterministic espn crosswalk — **external**; the ~21% ceiling here).
2. Reconcile resolved canonical ids vs the certified players snapshot.
3. Backtest resolved certified stats vs existing scoring inputs.
4. Only then consider certified statistics as a production scoring input (separately proven).

Both exit conditions are satisfied: **coverage improved** (54.4%→78.5%) **and** the remaining limitation is **conclusively external** (IDP provider gap). Recommendation: proceed to **Phase 5G** with the documented known IDP coverage limitation.
