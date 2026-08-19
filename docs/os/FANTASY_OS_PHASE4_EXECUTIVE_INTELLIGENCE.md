# Fantasy OS Phase 4 — Executive Intelligence

Deterministic, evidence-backed executive analytics for the `/fantasy-os` enterprise workspace, built on a
**certified real Sleeper portfolio** persisted to a **non-production** database. Every value reconciles to
the certified manifest; nothing is fabricated.

## 1. Certified source manifest

- **Seed:** `theciege24` (Sleeper user_id `591462610482806784`) — the owner's own real account.
- **Manifest hash:** `sha256:87c0d24653b10c53f121e43704b7ba08f4aeb2e4c22a4b9e449b0b832ecdf752`
- **run_id:** `87c0d24653b10c53f121e437` · **schema_version:** `fos_phase4.v1` · **calc_version:** `discovery.v1`
- **Portfolio:** 542 league-seasons (489 membership + 53 continuity ancestors), 2,663 unique real managers,
  285 commissioners, 254,639 transactions, 9,354 trades, 77,359 waivers, 95,571 free-agent moves, 70,670
  FAAB moves, 641 drafts, 92,941 draft picks, 129,562 matchup records, 14,761 traded future picks, 132
  continuity chains. **Source window: 2019–2025.**

## 2. API accounting reconciliation (discovery)

23,491 total attempts = 23,473 logical requests (23,469 ok + 4 not-found) + **18 recovered retry attempts**;
`fail=0`. The 18-call gap is retries: `calls` counts every attempt, while terminal counters (`ok`/`notFound`/`fail`)
increment only on the terminal outcome. All 18 recovered → zero data loss. Discovery fan-out exceeded Sleeper's
~1,000 req/min guidance; **any re-run/enrichment must add a global rate limiter** (bounded concurrency + backoff + caching).

## 3. Non-production data target + schema boundary

- **Project:** `cool-lab-87438174` ("decision-os-phaseA-verify") · **db:** `neondb` · **branch:** `br-red-waterfall-atbib0j0`
- **Isolated schema:** `fos_phase4` (tables: `import_run`, `league`, `manager`, `continuity_chain`). It never
  touches the 624 pre-existing app tables in that DB.
- **Production is a separate project** (`icy-field-51189449`, "All Fantasy") and is **never** touched by this feature.
- Import is idempotent (`ON CONFLICT DO UPDATE`, no DELETE/TRUNCATE); a rerun produces zero new rows.

## 4. Data-access boundary (`lib/fantasy-os/exec-data/`)

Read-only, `server-only`, env-gated. Enabled **only** when `FANTASY_OS_EXEC_ENABLED === 'true'` **and**
`FANTASY_OS_EXEC_DATABASE_URL` is set. The connection is forced read-only at the session level with an 8s
statement timeout. It **fails closed**: when disabled or on error it returns `{ available: false }` and the
UI renders an explicit unavailable state. It **never** falls back to the application/production schema and
**never** fabricates rows. The credential is never committed, logged, or exposed to the client.

## 5. Aggregate definitions & metric formulas (`lib/fantasy-os/exec-intelligence/derive.ts`)

All metrics are pure functions of the neutral snapshot (deterministic, no LLM, no randomness):

| Metric | Formula / rule | Denominator | Truth label |
|---|---|---|---|
| Platform totals (leagues, managers, transactions, trades, waivers, FA, FAAB, drafts, picks, matchups, traded picks) | Direct sums/counts over persisted rows | — | Live League Data |
| League operational status | `active` = transactions ≥ 50, `quiet` = 1–49, `dormant` = 0 (sampled weeks 1–18) | per league-season | Derived League Intelligence |
| Trade YoY change | `(latest season trades − prior season trades) ÷ prior season trades` | prior-season trades | Derived League Intelligence |
| FAAB adoption | `leagues with faab>0 ÷ leagues with any waiver activity (faab>0 OR waivers>0)` | waiver-active leagues | Derived League Intelligence |
| Avg picks / draft | `draftPicks ÷ drafts` | drafts | Derived League Intelligence |
| Manager participation buckets | 1 / 2–3 / 4–6 / 7+ by distinct `league_count` | managers | Derived League Intelligence |
| Positional draft distribution | **not computed** — position metadata not persisted | — | Insufficient Evidence |
| Per-season manager participation | **not computed** — membership edges not persisted | — | Insufficient Evidence |

Composite/opaque scores are deliberately avoided in favor of transparent statuses and distributions.

## 6. Truth-label rules (Part 9)

Four mutually-exclusive, always-visible labels, never blended:
- **Live League Data** — direct persisted records (KPIs, summed series).
- **Derived League Intelligence** — deterministic calculations (ratios, trends, classifications, rankings).
- **Presentation Preview** — demonstration/layout-only content.
- **Insufficient Evidence** — unavailable/unsupported intelligence (rendered instead of guessing).

Every surface shows `Source window: 2019–2025` and discloses:
`Regular-season weeks 1–18 were sampled. Offseason week-0 dynasty transactions are not included.`

## 7. Confidence rules (`explanation.ts`)

`confidenceFromSampleSize(n)`: High ≥ 100 units, Medium ≥ 20, else Low — one rule reused everywhere.

## 8. Explanation contract (Part 5)

Every insight is a fully-populated `Explanation` (`whatHappened`, `evidence[]`, `whyItMatters`,
`recommendation`, `confidence{level,rationale}`, `truthLabel`, optional `limitations`). `isRenderableInsight`
blocks rendering when any required field is missing. **No LLM** produces conclusions; a deterministic
function computes and a deterministic formatter verbalizes.

## 9. Manager intelligence boundary

Participation-only. The following are **never inferred** without a separately validated contract:
psychology, motivation, personality, skill rating, loyalty, satisfaction, churn probability, retention
intent, willingness to pay, managerial competence.

## 10. Known limitations

- Offseason week-0 dynasty transactions not sampled (separate append-only enrichment pass, TODO).
- Per-season manager participation and league↔manager edges not persisted (aggregates only).
- Player position metadata not persisted → positional distributions are Insufficient Evidence.
- Commissioner status is the provider ownership flag (self-attested).
- Source is a **non-production** verify database, never described as a production/live feed.

## 11. How to rerun validation safely

- Deterministic tests: `npx vitest run __tests__/fantasy-os/exec-intelligence.test.ts __tests__/fantasy-os/exec-data-access.test.ts`.
- Manifest reconciliation is asserted by `reconcileAgainstManifest` (unit-tested) and matches the SQL
  `SUM()` validation over `fos_phase4`.
- Re-discovery/import against Sleeper MUST use a global rate limiter (see §2); never re-run the original
  high-rate discovery pattern.

## 12. How to disable the workspace data source

Unset `FANTASY_OS_EXEC_ENABLED` (or set ≠ `true`), or unset `FANTASY_OS_EXEC_DATABASE_URL`. The workspace
then renders the explicit "not enabled here" unavailable state.

## 13. Why fabricated fallback data is prohibited

The workspace's entire value is truthful executive intelligence. A silent fallback to fabricated or
production data would (a) mislead executives, (b) violate the truth-label contract, and (c) risk exposing
real unrelated-manager PII. The data source therefore fails **closed** to an explicit unavailable state.

## 14. Season-aware synchronization (`lib/fantasy-os/sync/`)

**Cadence** — a deterministic season resolver (`season.ts`) maps the UTC calendar date to a `SeasonState`
(preseason / regular_season / postseason / offseason / unknown). Cadence: **30 min in season** (pre/regular/post),
**4h offseason**, unknown → 4h fail-safe + warning. Boundaries are on the UTC **date** only, so DST clock
shifts never change cadence. NFL boundaries are explicit and tested; the resolver is provider/sport-neutral
(ESPN, Yahoo, Fantrax, MFL, Fleaflicker share the sport calendars).

**Scheduler** — one FREQUENT fixed Vercel cron (`*/30 * * * *` → `/api/cron/fantasy-os-exec-sync`, guarded by
`CRON_SECRET`) resolves the season, derives the cadence, and only syncs when the elapsed time since the last
**completed** run meets that cadence (`isSyncDue`). One fixed schedule ⇒ season-aware behavior. Refreshes never
depend on a page view. The durable runner (`runner.ts`) provides: leased distributed lock (overlap prevention +
stale-lease recovery), retry with exponential backoff + jitter, resumable per-scope checkpoints, idempotent
persistence, run timeout, partial-failure recovery, and full accounting where **request attempts ≠ logical
requests** (both classified). Operational tables live in `fos_phase4`: `sync_schedule`, `sync_run`,
`sync_checkpoint`, `sync_request`, `sync_failure`, `sync_snapshot`, `sync_lock`.

**Incremental** — scheduled runs request only changed data since the last checkpoint (`INCREMENTAL_SCOPES`);
immutable historical records are reused from checkpoint, never re-crawled. The original unrestricted discovery
is never repeated. The **offseason** enrichment (`OFFSEASON_SCOPES`) closes the week-0 gap append-only and
writes a **new** versioned `sync_snapshot` with its own checksum/provenance — it never overwrites the certified
discovery manifest.

**Freshness** — separate from truth labels (`freshness.ts`). Season-aware thresholds: in season current ≤45m /
critical >90m; offseason current ≤5h / critical >8h. Every workspace header shows `syncStatus`
(current/refreshing/delayed/partial/unavailable) + last successful update + season + cadence. Stale REAL data
stays **Live League Data** with a truthful **Delayed** badge — never relabeled as Presentation Preview.

**Failure behavior** — a failed/partial run does NOT delete verified data, fabricate content, mark itself
successful, advance the certified checkpoint, or corrupt totals. Partial runs persist only completed scopes,
record incomplete scopes, expose `partial`, and retain the previous verified snapshot until a new one certifies.

**Live-collector gate** — the rate-limited Sleeper incremental fetchers are gated behind
`FANTASY_OS_EXEC_SYNC_LIVE === 'true'` (separate from `FANTASY_OS_EXEC_ENABLED`), so the heartbeat cron is safe
to deploy and never hits the provider until the collector is explicitly provisioned in an approved environment.

**Deployment** — Vercel Cron supports the required cadences (the repo already runs `*/5`, `*/15`, and 4-hourly
crons). If bounded provider collection ever exceeds function limits, move execution to a dedicated worker while
keeping the read path unchanged.

## 15. Updated Phase 4 exit criteria

Phase 4 is complete only when: automatic season-aware sync runs; cadence changes correctly between season
states; 30-min in-season + 4h offseason schedules operate; offseason week-0 collection is supported; freshness
is visible in all seven workspaces; stale/partial data is labeled truthfully; rate limits + retries are tested;
idempotency is proven; no unrestricted historical discovery repeats; production credentials + data remain
protected. **Design + deterministic core + heartbeat + freshness UI are done and tested; the live rate-limited
collector run + recurring-execution proof are deployment-gated (flag-off by default).**
