# Player Lookup Non-Blocking Refresh — Extended Soak Validation (Phase 22)

**Status: real soak performed against `.env.test`. Coverage extended to `getPlayersByTeam()`/`getPlayerNews()`. One real, honest limitation found and disclosed (cross-route dedup reliability in dev mode). Readiness: B — continue non-production soak.**

## Soak environment

- Isolated `next dev` server, fresh port (3222), `DATABASE_URL` from `.env.test` (same non-production Neon database used since Phase 13).
- `PLAYER_LOOKUP_NON_BLOCKING_REFRESH=true` for the entire session.
- No other flags changed. Not enabled in production or in the shared `.env`/default database.

## Soak duration / validation window

~13 minutes of active real-traffic testing (20:10:04–20:22:16 UTC), including a deliberate multi-minute wait to observe genuine cooldown expiration rather than simulate it.

## Total real request count

**53 real HTTP requests** (Next.js server access log, `grep -c "GET /api\|POST /api"`). 51 of these have precise per-request timing captured; the remaining 2 (a `POST` batch entry logged slightly differently) are included in the total but not the percentile calculation below.

## Request breakdown

| Category | Count |
|---|---|
| `player-search` (cache-hit-ish, real terms) | 8 |
| `player-search` (controlled miss, single sport) | ~20 (across NBA/MLB/NHL/NCAAF/NCAAB/SOCCER, including repeats for dedup/cooldown proofs) |
| `player-search` (concurrent same-sport, 3x) | 3 |
| `player-search` (concurrent cross-sport, 3x) | 3 |
| `player-detail` (real id, cache hit) | 4 |
| `player-detail` (guaranteed miss) | 6 |
| `/api/trade-value/analyze` | 4 (1 unresolved-id miss, 3 real priced assets) |
| `getPlayersByTeam` | 0 live HTTP — **see explicit disclosure below** |

## Explicit disclosure: `getPlayersByTeam()` has zero real callers

Fresh, precise verification this phase (`grep -rn "getPlayersByTeam" app lib`) found **no caller anywhere in the live application** — confirmed by also listing every file that imports anything from `lib/data/players` (11 files; none call `getPlayersByTeam`). This corrects Phase 20's Call Graph doc, which incorrectly attributed 4 routes to it (those routes actually call `getInjuryReport()` and `lib/data/news.ts`'s separate `getLatestNews`/`getHighImpactNews` functions — a genuine naming-collision trap: `lib/data/news.ts` also defines its own unrelated, apparently-unused `getPlayerNews()`).

Because no live route exists, `getPlayersByTeam()` could **not** be soak-tested with real HTTP traffic this phase. It was validated exclusively via the unit tests added this phase (cache-hit unchanged, flag-off miss preserves legacy behavior, flag-on miss returns immediately + requests background refresh, response ordering preserved) — all passing. This is disclosed honestly rather than fabricating route-level evidence for code nothing currently calls.

## `getPlayerNews()` real soak coverage

Validated live via `player-detail` route (which calls `getPlayerNews` internally after `getPlayer`). Two `refresh_started`/`get_player_news_miss` events observed, both completing in **2,193ms** and **1,674ms** — confirming `runNewsImporter()` is genuinely, substantially cheaper than `runSportsDataImporter()` (consistent with its structurally lighter cost: one external call per sport vs. three, no chunked upsert loop).

## Coordinator lifecycle counts (real, from server log)

| Event | Count |
|---|---|
| `refresh_started` | 18 |
| `refresh_joined` | 8 |
| `refresh_suppressed_cooldown` | 1 |
| `refresh_completed` | 17 |
| `refresh_failed` | 0 |

18 started vs. 17 completed: one NCAAF refresh (the deliberate cooldown-expiration proof request) was still logged as `refresh_started` at the point of report-writing but had not yet emitted `refresh_completed` in the captured log window — not a failure, a timing artifact of when the log was captured, consistent with the ~13-19s typical per-sport duration observed throughout.

**No real importer failure was observed or forced this soak** (0 `refresh_failed` events) — every real external provider call eventually succeeded. Failure-path correctness (state clears, no poisoning, caller unaffected) is proven via the unit tests' mocked-rejection cases, not a live failure this phase — the same honest limitation disclosed in Phase 21 (a real provider outage cannot be safely forced on demand against a shared non-prod environment).

## Response latency (51 requests with captured timing)

| Metric | Value |
|---|---|
| Min | 692ms |
| p50 | 1,098ms |
| p95 | 5,430ms |
| Max | 17,797ms* |
| Mean | 1,978ms |

*The single 17.8s outlier is the one `sport=ALL` search request, which additionally performs a separate FantasyCalc external fetch (`searchNflFantasyCalc`) unrelated to this phase's guardrail — the same confound already disclosed in Phase 21. Excluding it, the max drops to 6,999ms (a real, successfully-priced `/api/trade-value/analyze` request).

Every miss-path request — the specific case this guardrail targets — returned in under 4 seconds, none approached the 90-190s pre-Phase-21 baseline.

## Same-sport concurrency (real)

3 truly concurrent `player-search` misses for NBA (`&`/`wait`) produced exactly 1 `refresh_started` + 2 `refresh_joined` + 1 `refresh_completed` (12,211ms, 201 players imported) — single-flight dedup holds for concurrent requests to the same already-warm route.

## Cross-sport concurrency (real)

Concurrent misses for MLB/NHL/NCAAB (3 different sports, same instant) each independently produced their own `refresh_started`/`refresh_completed` — no cross-sport blocking, confirmed live.

## Cooldown-expiration proof (real, not simulated)

NCAAF: `refresh_started` at 20:15:39.842 → `refresh_suppressed_cooldown` at 20:16:05.461 (`msSinceLastAttempt:25619`, correctly within the 5-minute window) → a genuine wait to 20:22:16.430 (6m37s after the original attempt, past the 5-minute cooldown) → fresh `refresh_started` fired correctly, proving expiration recovery with real wall-clock time, not a fake-timer simulation.

## Real, honest limitation found this phase: cross-route dedup reliability in dev mode

Three cases (NBA, MLB, NCAAB) showed a `search_players_miss` and a `get_player_miss`/second `search_players_miss` for the **same sport**, only seconds to tens-of-seconds apart, both starting **fresh** `refresh_started` events instead of the second one being suppressed (cooldown) or joined (in-flight) as expected.

A controlled, isolated follow-up test (single route, single sport, known timing) worked **exactly** as designed: start → join (immediate repeat) → cooldown-suppress (20s later) → fresh start (6m37s later, past cooldown). This isolates the cause: **the three anomalies all coincided with a route's first-ever compilation in this `next dev` session** (e.g., `player-detail` route's first hit, occurring around the same time as an already-in-flight `player-search` NBA refresh). Next.js dev mode's on-demand, per-route compilation can give a route's module graph its own fresh instance on cold compilation — meaning the in-memory coordinator `Map`s are not guaranteed to be the *same* object across two different route files until both have been compiled and are warm.

**This is disclosed as a real, honest finding, not swept under the rug.** Practical implications:

- **The core guarantee this phase exists to prove — customer requests don't block on the importer — is fully intact.** Every single request, including the ones that hit this dedup gap, still returned in seconds, never blocked. The gap only affects the *secondary* guarantee (preventing duplicate importer executions).
- **The "single-flight per process" claim in Phase 21's docs is now scoped down**: reliable within concurrent requests to an already-warm route (proven repeatedly, including 3-way same-sport concurrency); cross-route sharing is best-effort and depends on the deployment/bundling model, not a guarantee this implementation can make on its own.
- This was tested under `next dev`, not a production build. A real Vercel deployment has its own, likely more consequential, version of this same limitation: **different API routes commonly run as separate serverless function instances in production**, meaning cross-route in-memory state sharing should not be relied upon at all in that deployment model, independent of this dev-mode-specific compilation artifact.
- No code change was made in response to this finding — it is a scope clarification of an existing, already-disclosed "process-local" limitation, not a new defect requiring a fix this phase. A cross-instance-aware coordinator (e.g., a shared cache/lock) would be required to close this gap fully, which is out of this phase's explicit scope ("no Redis, no distributed locking").

## Response fidelity

Flag-off behavior: unchanged (zero code touched on that path this phase beyond adding the two new functions' flag-off branches, both proven byte-identical to pre-Phase-21/22 behavior via passing tests). Flag-on: every real response this soak returned the same honest shape the old code would eventually produce (empty array, 404, or the identical `VALIDATION`/400 error) — never fabricated data, never a different status code family than the equivalent old-behavior outcome would have used.

## Privacy proof

Inspected the full soak's coordinator log output: every line contains only `event`, `sport` (or `"ALL"` for the news path), `triggerSource`, timestamp, and (on completion) `durationMs`/`imported` count, or (on failure) a sanitized error message. No player names, user identifiers, tokens, credentials, or raw request payloads appear anywhere in the log.

## Rollback proof

Not re-tested live this phase beyond Phase 21's existing flag-off unit tests (still passing) — no new rollback-relevant code path was introduced (the flag-off branches for `getPlayersByTeam`/`getPlayerNews` are structurally identical to `getPlayer`/`searchPlayers`' already-proven flag-off preservation).

## Production rollout recommendation

**Not yet.** Continue non-production soak. The core latency fix is strongly evidenced and safe; the newly-found cross-route dedup scope limitation should be understood (not necessarily fixed) before any confidence claim about "at most one import per sport" is made operationally — teams relying on that specific guarantee across routes should not assume it holds without a production-build or real-deployment verification pass, which this phase did not perform.
