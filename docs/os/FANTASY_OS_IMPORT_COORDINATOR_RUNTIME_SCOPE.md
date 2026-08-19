# Import Coordinator Runtime Scope Audit (Phase 23)

**Status: audit + design. No distributed coordination implemented. Flag remains default OFF everywhere.**

**Phase 24 update:** attempted real production evidence (safe, read-only header inspection against `https://www.allfantasy.ai`'s live routes) — inconclusive for the specific instance-sharing question (`X-Vercel-Id` is a per-request trace ID, not a stable instance identifier; proven by 3 identical requests to the same route returning 3 different token values). The remaining topology question stays genuinely unresolved without live Vercel deployment access. This did **not** block a final readiness decision — see [`FANTASY_OS_PRODUCTION_READINESS_REPORT.md`](FANTASY_OS_PRODUCTION_READINESS_REPORT.md) (classified **A — Ready**) and [`FANTASY_OS_PRODUCTION_DEPLOYMENT_FINDINGS.md`](FANTASY_OS_PRODUCTION_DEPLOYMENT_FINDINGS.md) for full detail. Phase 24 also closed the `lib/data/news.ts` gap disclosed here (`getLatestNews`/`getHighImpactNews` now covered) — see [`FANTASY_OS_NEWS_IMPORT_COVERAGE_AUDIT.md`](FANTASY_OS_NEWS_IMPORT_COVERAGE_AUDIT.md).

## Corrected Phase 22 documentation

Two real corrections, verified fresh this phase and carried into the other required doc updates:

1. **`getPlayersByTeam()` has zero real callers anywhere in the live app.** Verified again this phase (unchanged from Phase 22's finding) via `grep -rn "getPlayersByTeam" app lib` (zero matches outside its own definition) and by listing every file importing from `lib/data/players` (11 files, none call it).
2. **`lib/data/players.ts`'s `getPlayerNews()` and `lib/data/news.ts`'s `getPlayerNews()`/`getLatestNews()`/`getHighImpactNews()` are separate systems.** `lib/data/news.ts`'s own `getPlayerNews()` (line 30) has zero real callers (orphaned/dead code — nothing imports it by that path). Its siblings `getLatestNews()` and `getHighImpactNews()` **do** have real live callers.

## New finding this phase: a real, undocumented coverage gap

Building the corrected caller graph for all four coordinator entry points (`requestPlayerImportRefresh`, `requestPlayerNewsRefresh`, `runSportsDataImporter`, `runNewsImporter`) surfaced a gap neither Phase 21 nor Phase 22 examined: **`lib/data/news.ts`'s `getLatestNews()` and `getHighImpactNews()` have real, live, production callers and still synchronously `await runNewsImporter(...)` on a cache miss — completely unprotected by the Phase 21/22 guardrail.**

| Function | File | Real callers | Miss-path behavior |
|---|---|---|---|
| `getLatestNews(sport, limit)` | `lib/data/news.ts:8` | `app/api/leagues/[leagueId]/draft/assistant-context/route.ts`, `lib/ai-orchestration/sports-context-enricher.ts`, `lib/chimmy/chimmy-sport-data-digest.ts` | **Synchronous, unguarded** `await runNewsImporter({sports:[sport]})` |
| `getPlayerNews(playerId)` | `lib/data/news.ts:30` | **None found** — orphaned | Synchronous, unguarded, but unreachable |
| `getHighImpactNews(sport)` | `lib/data/news.ts:55` | Not confirmed reached by a live route this phase — same file, same risk class, listed for completeness | Synchronous, unguarded |
| `getPlayerNews(playerId, limit)` | `lib/data/players.ts:135` | `app/api/trade-value/player-detail/route.ts`, `lib/ai-orchestration/sports-context-enricher.ts`, `lib/ai-tools-start-sit/runStartSitAnalysis.ts`, `lib/ai-tools-start-sit/runStartSitGlobalAnalysis.ts` | **Guarded** (Phase 22) via `requestPlayerNewsRefresh` when flag enabled |

**This is disclosed, not fixed.** Extending coverage to `lib/data/news.ts` would be new-surface expansion beyond this phase's explicit scope (audit + runtime-scope design for the *existing* coordinator, "no importer rewrite," no new function coverage listed in the brief). It is flagged here precisely so it isn't silently lost, and is a natural candidate for Phase 24 or a dedicated follow-up.

## Complete corrected caller graph

### `requestPlayerImportRefresh()`
All 4 call sites are internal to `lib/data/players.ts` (`getPlayer`, `searchPlayers`, `getPlayersByTeam`). Classification: **live customer route** (indirect, via `player-search`/`player-detail`/`/api/trade-value/analyze`) for `getPlayer`/`searchPlayers`; **currently unused** for `getPlayersByTeam` (function has zero real callers).

### `requestPlayerNewsRefresh()`
1 call site, internal to `lib/data/players.ts`'s `getPlayerNews`. Classification: **live customer route** (4 real callers, listed above).

### `runSportsDataImporter()` (direct, bypassing the coordinator)
| Caller | Classification |
|---|---|
| `app/api/cron/import-players/route.ts` | Background/cron route — explicit, intentional, awaited |
| `lib/admin-dashboard/AdminSportsSyncService.ts` | Administrative path — explicit, intentional, awaited |
| `lib/fantasy-data/importNflFantasyData.ts`, `lib/fantasy-data/importNcaafFantasyData.ts` | Administrative/pipeline path — explicit, intentional, awaited |
| `lib/data/players.ts` (flag-off miss paths, 3 sites) | Live customer route — legacy/rollback path only, unchanged since Phase 21 |
| `lib/data/players.ts` (pre-existing stale-refresh via `triggerBackgroundRefresh`, 3 sites) | Live customer route — already non-blocking (pre-Phase-21 mechanism, unrelated to this coordinator) |

### `runNewsImporter()` (direct, bypassing the coordinator)
| Caller | Classification |
|---|---|
| `app/api/cron/import-news/route.ts` | Background/cron route — explicit, intentional |
| `lib/admin-dashboard/AdminSportsSyncService.ts` | Administrative path — explicit, intentional |
| `lib/fantasy-data/importNflFantasyData.ts`, `lib/fantasy-data/importNcaafFantasyData.ts` | Administrative/pipeline path — explicit, intentional |
| `lib/data/players.ts` (flag-off miss + stale-refresh, `getPlayerNews`) | Live customer route — flag-off legacy path (miss) / already non-blocking (stale) |
| **`lib/data/news.ts` (`getLatestNews`/`getPlayerNews`/`getHighImpactNews`, 6 call sites)** | **Live customer route — unguarded, real gap, see above** |

## Deployment runtime (source-config evidence)

- **Framework**: Next.js 14.2.15, App Router.
- **Runtime**: No route in the relevant call chain (`player-search`, `player-detail`, `analyze`, `cron/import-players`) declares `export const runtime = 'edge'` — all default to Vercel's standard **Node.js serverless runtime**.
- **`vercel.json`**: defines ~45 cron jobs, hitting real app routes on schedule. No `functions` block — no custom bundling, memory, or region overrides; default Vercel Function behavior applies throughout.
- **`next.config.js`**: no `output: 'standalone'` or custom serverless bundling configuration that would consolidate multiple API routes into one function.
- **Vercel MCP tools were not authorized in this session** (requires interactive OAuth) — this audit could not query live deployment/function-topology data directly. The conclusions below are based on (a) this source-config evidence, (b) a local production-build test (see below), and (c) well-documented, stable Vercel/Next.js architectural behavior, explicitly labeled as such rather than presented as measured live-deployment fact.

## The decisive architectural fact (labeled: informed reasoning, not measured this phase)

**Vercel's standard deployment model for a Next.js App Router application compiles each API route (`route.ts`) into its own independent serverless function by default.** This is Vercel's foundational, documented behavior — not something that varies between dev and production *builds*; it is a property of the *deployment* (how many discrete functions are created and invoked), which a local `next start` single-process test cannot reproduce or falsify, because `next start` runs the entire application in one Node.js process with no per-route function separation at all.

This means the more consequential answer to "does one production process share one coordinator instance across all relevant routes" is very likely **no** in a real Vercel deployment — each API route most likely runs as its own function/process with its own module registry, independent of whatever the Phase 22 dev-mode compilation artifact was actually caused by. Vercel's Fluid Compute (which improves warm-instance reuse) changes *how often a given route's own function stays warm across invocations* — it does not merge *different* routes into one shared function or module registry.

**Practical implication**: cross-route single-flight/cooldown sharing should not be relied upon in production regardless of what any local single-process test shows. The local production-build test below answers a narrower, still-useful question — whether the Phase 22 anomaly was a `next dev`-specific compilation artifact — but does not and cannot prove cross-route sharing in real Vercel production, because no local single-process test can.

## Local production-build test (distinguishing dev-mode artifact from a deeper bug)

Ran `next build` (production mode, `NODE_ENV=production`) then `next start` locally against `.env.test`, repeating Phase 22's exact controlled experiment (a miss on sport X via `player-search`, immediately followed by a miss on the same sport X via `player-detail`) within one persistent Node process — this time with the new `coordinatorInstanceId`/`pid` instrumentation, so the result is directly measured, not inferred from timing.

**Result: definitive and clean.** Both routes produced the identical `coordinatorInstanceId` (`e2aa70c3-c10e-4e7f-b376-c71a510140fe`) and identical `pid` (`41736`):

```
[sports-data-import-coordinator] {"event":"refresh_started","sport":"NCAAF","triggerSource":"search_players_miss","coordinatorInstanceId":"e2aa70c3-...","pid":41736,...}
[sports-data-import-coordinator] {"event":"refresh_joined","sport":"NCAAF","triggerSource":"get_player_miss","coordinatorInstanceId":"e2aa70c3-...","pid":41736,...}
```

The second request (`player-detail`, a different route file) correctly **joined** the in-flight import started by the first request (`player-search`) instead of starting a duplicate — proving the coordinator's dedup logic is correct. A follow-up cross-sport check (NBA via search, MLB via detail) confirmed both routes share the same instance while still tracking sports independently (`refresh_started` fired separately for each sport, no incorrect cross-sport blocking).

**This confirms the Phase 22 anomaly (NBA/MLB/NCAAB cross-route dedup failures) was genuinely a `next dev`-mode compilation artifact, not a logic bug in the coordinator.** Within any single running Node process — dev or production build — the coordinator behaves exactly as designed.

**What this does NOT prove**: whether a real Vercel deployment runs all these routes in one shared process to begin with. `next start` is still a single-process test; it cannot observe or replicate Vercel's per-route serverless function separation (see "the decisive architectural fact" above). The honest, complete picture is: **the coordinator's logic is proven correct wherever it runs in a shared process; whether Vercel's actual deployment topology gives it a shared process across `player-search` and `player-detail` remains the one unresolved, unmeasured question this phase could not answer without live Vercel deployment access** (the Vercel MCP connector was not authorized in this session).

## Coordinator instance-ID instrumentation (added this phase)

`lib/workers/sports-data-import-coordinator.ts` now generates `COORDINATOR_INSTANCE_ID` (via `randomUUID()`) once when the module is first evaluated, included in every log line alongside `pid`. Two log lines sharing the same `coordinatorInstanceId` came from the same module instance (state genuinely shared, not inferred from timing); two different IDs prove separate instances. `getCoordinatorInstanceInfo()` is exported for direct verification. This is process-scoped/module-scoped identification, not a claim about distributed coordination — it exists purely to make the runtime-scope question empirically checkable rather than argued from timing heuristics, as Phase 22 had to do.

## Answers to the Core Questions

| Question | Answer |
|---|---|
| Does one production process share one coordinator instance across all relevant routes? | **Within one process: yes, proven directly this phase** (`coordinatorInstanceId`/`pid` matched across `player-search` and `player-detail` in a real production build). **Across Vercel's actual deployment topology: very likely no** — that's a question about how many processes exist, not whether the code shares state within one, and remains unmeasured without live Vercel access. |
| Do separate route bundles create separate in-memory coordinator states? | **In `next dev`, yes** (Phase 22, dev-mode compilation artifact). **In a production build within one process, no** — proven this phase, both routes shared the identical module instance. Vercel's per-route function deployment (if it applies to this app) would still separate them, but for an architectural reason unrelated to route-bundle compilation. |
| Do concurrent serverless instances independently run imports? | **Yes, by design of any serverless platform** — this was never in question and is unrelated to the route-bundling issue; two concurrent invocations of the *same* route can still land on two different warm/cold instances. |
| Does production reuse warm instances enough for the current guardrail to provide meaningful protection? | **Yes, for the primary goal.** The non-blocking latency behavior (the reason this guardrail exists) does not depend on cross-instance or cross-route sharing at all — every request benefits regardless of dedup scope. Same-invocation and same-warm-instance dedup (proven repeatedly in Phase 22) still meaningfully reduces duplicate work for the common case of a burst of requests landing on the same warm function. |
| Is the current process-local solution sufficient for controlled rollout? | **Yes, for the primary customer-latency goal. Not fully sufficient if "at most one import per sport, period" is required as an operational guarantee** — see Production Design doc. |
| If not, what is the narrowest safe cross-instance design? | See [`FANTASY_OS_IMPORT_COORDINATOR_PRODUCTION_DESIGN.md`](FANTASY_OS_IMPORT_COORDINATOR_PRODUCTION_DESIGN.md). |
