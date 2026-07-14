# Draft Service (Shadow Mode) — Phase 8

Draft OS foundation, Fantasy OS Migration Plan. Mirrors the architecture of [`lib/shared-services/trade/`](../trade/README.md) (Phase 5) and [`lib/shared-services/waiver/`](../waiver/README.md) (Phase 7). **Shadow mode only** — nothing here is called by any live route, no UI changes, no API changes, no recommendation logic is authoritative.

## What was audited first

A full inventory of the draft ecosystem was built before any code was written (4 parallel research passes). This is the largest, most fragmented ecosystem audited across Phases 5–8 — draft logic is organized by draft TYPE/phase (rookie, startup, supplemental, dispersal, devy, C2C) rather than by league format, and several genuinely separate ranking engines coexist for different real purposes. Full findings:

### The one real, canonical recommendation engine
`lib/draft-helper/RecommendationEngine.ts`'s `computeDraftRecommendation()`/`computeDraftPlayerRankings()` — the shared deterministic core behind **every** real live draft-recommendation caller: the human draft assistant (`app/api/draft/recommend`), the War Room route (`app/api/ai/draft/recommend`), Live Draft Brain (`app/api/draft/live-brain`), need-based auto-pick, and Draft Intelligence's queue suggestions. **This is what this module reuses as its own primary recommendation value** — same role `computeTradeDrivers`/`scoreWaiverCandidates` played in earlier phases. It is a **VORP-less, name/position/ADP/bye-week based** model — confirmed via the audit that no VORP-style replacement-value calculation exists anywhere in the draft-recommendation path, a genuine, verified difference from Trade OS and Waiver OS.

### The one real, independently-computed comparison engine
`lib/ai/opponents/draft/aiOpponentDraft.ts`'s `decideDraftPickWithScores()` — the same engine real AI-controlled opponent rosters use to auto-pick (base ADP-value + need + reach + personality-weight adjustment; a genuinely separate formula from `RecommendationEngine`'s ADP-edge + need fusion). **This is the one used for divergence** — the "T2"/"waiverRecommendationService" role. It requires a full `BotProfile` (personality weights); rather than inventing one, this module always uses the real, already-defined `'balanced_builder'` archetype (`lib/ai/opponents/botProfiles.ts`) as a neutral baseline, never a fabricated weighting.

### Confirmed dead code, left untouched
`lib/draft/mockDraftAI.ts::getAIPick()` (ADP-jitter mock function) has zero callers anywhere in the repo.

### Real specialty/format infrastructure (studied, not touched)
Draft personalities (`lib/live-draft-engine/npcDraftPersonalityTypes.ts`, ~20 real personas), the live draft state machine (`lib/live-draft-engine/DraftSessionService.ts`, `PickSubmissionService.ts`, separate `AuctionEngine.ts` for auction nomination/bidding), rookie/startup/supplemental/dispersal/devy/C2C/IDP draft logic (each real, each independently verified — see the Phase 8 audit transcript for full per-format detail), and keeper cost-round logic (`lib/keeper/eligibilityEngine.ts`). None of these are touched or migrated by this phase.

### Decision OS has NO draft slice yet
Unlike trade and waiver, **`lib/decision-os/draft/` does not exist.** `lib/decision-os/draft-runtime-intelligence.ts` is a standalone UI-card presenter, not a `Decision<T>`/shadow slice. This is a real gap a future phase could fill using this module as its foundation — not attempted here.

### A genuine architectural win: no live external re-fetch, and true point-in-time replay
Like Waiver OS, and unlike Trade OS, this module never calls `runImportedLeagueNormalizationPipeline` — `DraftSession`/`DraftPick`/`League`/`Roster` rows are already the canonical model. **Better still**, draft picks are strictly ordered by `overall`, so "every pick with `overall < N`" is a *faithful* historical snapshot of the board/roster state at pick N — a real capability neither Trade OS's nor Waiver OS's backtest had. See [`backtest/README.md`](backtest/README.md) for the one real caveat (ADP values are today's snapshot, not point-in-time).

## Modules

- **`DraftContextAssembler.ts`** — assembles the real `RecommendationInput` from `DraftSession`/`DraftPick` + the real AllFantasy ADP snapshot (`lib/adp/readSnapshotForLeague.ts`, "NEVER falls back to external/market ADP") + the real roster-slot template resolver + the real sport-scoped player pool (same one Waiver OS's assembler reuses). Exposes a pure, shared `assembleEngineInputFromPicks()` core so both the live path and the backtest's point-in-time reconstruction stay consistent.
- **`DraftRecommendationAdapter.ts`** — wraps `decideDraftPickWithScores` with the real `balanced_builder` archetype.
- **`DraftShadowService.ts`** — `evaluateDraftShadowFromContext()` (the real evaluation logic, reusable against any context) + `evaluateDraftShadow()` (thin wrapper for the live/current state).
- **`DraftShadowResultStore.ts`** — in-memory shadow log, same disclosed non-durable pattern as Trade OS/Waiver OS.
- **`backtest/`** — see [`backtest/README.md`](backtest/README.md).

## Known limitations

- The real live route (`app/api/draft/recommend`) receives its player pool/roster from the request body, not a server-side read — this assembler is a genuinely new (but schema-verified) reconstruction built specifically for shadow-mode/backtest use, since no equivalent server-side function existed to reuse.
- Player-id resolution for KG lookups (`PlayerExposure`) and the legacy grader adapter is best-effort: ADP snapshot entries carry no player id, so this module cross-references the sport player pool by name; an unresolved match falls back to a synthetic key, never a fabricated id.
- `isTEP` is not detected and defaults to `false` — same documented, bounded simplification used across Trade OS/Waiver OS.
- The legacy grader adapter never reads a manager's real saved draft queue (`DraftQueueEntry`) — comparison-only impact.
- `rosterSlots` is derived from each slot's `starterCount` only (bench/reserve/taxi/devy counts are not expanded into the flat list) — a simplification, not a fabrication.

## What is NOT done in this phase

No consumer (Draft Room, Commissioner tools, Decision OS, Legacy OS, Game Day, APIs, UI) is migrated. No schema/migration added. No live recommendation changed.
