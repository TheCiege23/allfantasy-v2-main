# Draft OS — Performance Audit (Phase 25)

**Status: real measurements from this phase's actual runs against `.env.test`. Optimization opportunities identified only — nothing optimized this phase, per explicit scope.**

## Real measured latency

| Operation | Real measured time |
|---|---|
| Full context assembly for one pick (real pool query + real ADP read + real roster template + identity resolution) | ~1.6s (single sample, `.env.test`) |
| Full mechanics-exercise backtest run: 45 candidate samples (20 evaluated, 25 failed fast on missing roster) | 13,327ms total (~296ms/sample average, dominated by the 20 real evaluations since the 25 failures short-circuit quickly) |

No isolated per-stage breakdown (DB query time vs. engine compute time vs. Knowledge Graph lookup time) was captured this phase — the real numbers above are wall-clock totals, not decomposed. This is a real limitation of this phase's measurement, disclosed rather than estimated.

## Cache performance

- **`DraftPoolCache`**: real Prisma table, TTL-based (default 300s / `AF_DRAFT_POOL_CACHE_TTL_SECONDS`), warmed proactively every 30 minutes by `app/api/cron/draft-pool-prewarm/route.ts` for leagues with an active/upcoming draft. **No proactive invalidation exists** — stale entries only clear via TTL expiry or `upsert` overwrite, confirmed by grep (zero `delete`/`deleteMany` calls on `draftPoolCache` anywhere in the codebase). This means a real roster/player-pool change mid-draft would not be reflected until the TTL expires, a real (if likely low-impact given the pre-warming cadence) staleness window.
- **In-memory layer** (`lib/api-performance/cache.ts`): `MAX_ENTRIES = 1000`, `DEFAULT_TTL_MS = 60_000` — a fast-path in front of the DB cache.
- **ADP is not cached at all** — read live on every single call (`readAllFantasyAdpForLeague`), confirmed by grep. For a single pick evaluation this is fine (one query); for a full draft-room session hitting the recommendation route repeatedly per pick, this is a real, uncached repeated-query pattern — a genuine optimization candidate, not touched this phase.

## Repeated work identified (not fixed)

`assembleEngineInputFromPicks` re-scores the **entire** available pool (up to `available.slice(0, 80)` per `RecommendationEngine.ts:335`) on every single pick evaluation within a draft, rather than incrementally updating scores as the pool shrinks pick-by-pick. For a 12-round, 12-team draft (144 picks), this means the engine potentially re-computes similar scoring work up to 144 times per draft session. Whether this is a meaningful real cost depends on per-call latency at scale — not measured this phase, flagged as a genuine optimization candidate.

## Memory usage

Not measured this phase — no profiling was performed. The `InMemoryDraftShadowResultStore` (`DraftShadowResultStore.ts:17-38`) is an unbounded in-process array with no eviction policy found in the code read this phase — a real, disclosed concern if the shadow module were ever activated at scale (currently moot, since it has zero real callers).

## Optimization opportunities identified (not implemented, per explicit phase scope)

1. Cache ADP reads per-draft-session (single-digit-minute TTL would likely be safe given ADP's own natural update cadence) instead of re-reading live on every pick.
2. Add proactive `DraftPoolCache` invalidation on real roster/pick-commit events, rather than relying solely on TTL.
3. Consider incremental re-scoring instead of full-pool rescoring per pick, if per-pick latency at scale is later found to matter.
4. Add an eviction policy (max size, TTL) to `InMemoryDraftShadowResultStore` before any real activation of the shadow module.

None of these were implemented this phase, per the explicit "identify optimization opportunities only" scope boundary.
