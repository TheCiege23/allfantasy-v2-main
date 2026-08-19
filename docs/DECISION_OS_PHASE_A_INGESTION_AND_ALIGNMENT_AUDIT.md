# Decision OS Phase A — Ingestion Productionization + Surface Alignment (AUDIT + PLAN)

**Audit only. No implementation.** Produced under the standing NFL-Redraft feature freeze (the user
chose "Audit Decision OS only — implement nothing; freeze stays on"). This maps the *current* state of
the Sleeper historical backfill / snapshot-capture proof and the five target surfaces, then proposes a
phased plan. **Nothing here is built; no flags flipped; no live DB touched.**

**Date:** 2026-07-08 · **Audited on:** `g15-event-foundation` (F: primary). All Decision OS code below
lives on **unmerged branches** (g15 / `decision-os-demo-review`), **not on `main` or `nfl-redraft-beta`**
(consistent with the parked-workstream memories).

---

## 1. Executive summary

The request has two halves; both have real gaps:

1. **"Production-grade, repeatable ingestion pipeline"** — today the Sleeper historical backfill is a
   **post-import / manual-retry service**, not a scheduled, idempotent, orchestrated pipeline. It has
   **no idempotency guards, no scheduler, and no re-run safety** surfaced in the service. It's proof-grade.
2. **"Align 5 surfaces to read the same real Decision OS outputs"** — today the surfaces read
   **divergent sources**, the Decision OS output path is **default-off (503)**, and **2 of the 5 named
   surfaces do not exist** (Mission Control, League Analytics). So there is no single, real, shared read
   path to align *to* yet.

Phase A is therefore two coordinated tracks: **(A) productionize ingestion → real events**, and
**(B) establish one canonical Decision OS read-path and re-point every surface to it.**

---

## 2. Current state — the ingestion "proof"

| Piece | Location | State |
| --- | --- | --- |
| Sleeper historical backfill | `lib/league-import/sleeper/SleeperHistoricalBackfillService.ts` (`syncSleeperHistoricalBackfillAfterImport`) + `SleeperHistoricalSeasonStateSyncService.ts` | Runs **after a league import**; also invoked by a manual **`/api/leagues/[leagueId]/backfill/retry`** route. **No idempotency signals** (0 upsert/onConflict/skip-existing markers in the service), **no cron/scheduler**, no checkpoint/resume. |
| Other providers | `lib/league-import/{espn,yahoo,mfl,fantrax}/*HistoricalBackfillService.ts` + `lib/dynasty-import/backfill-orchestrator.ts` | Parallel per-provider backfills (Sleeper is one of several). |
| Snapshot / Canonical World | `lib/decision-os/**/world.ts`, `lib/decision-os/trade/canonicalMemo.ts` | The read-only origin-blind fact/snapshot layer (Canonical World substrate). |
| Behavioral events (substrate) | `lib/decision-os/behavioral/events/*` (persisted via prisma) | The events the pipeline reads. **Ingestion must populate these for outputs to be non-empty.** |

**Gap → production-grade:** idempotent upserts by natural key (re-runnable safely), an orchestrated +
schedulable job (not post-import-only), checkpoint/resume + retry with backoff, rate-limit handling for
Sleeper's API, and run telemetry/observability (`SleeperHistoricalBackfillSummary` exists but isn't a
durable run-log).

## 3. Current state — Decision OS outputs (the read path)

- **`realDataProvider`** (`lib/decision-os/behavioral/api/real-data-provider.ts`) runs the **full
  read-only behavioral pipeline**: BehavioralEvents (via `prisma`) → `assembleManager/LeagueBehavioralFacts`
  → `deriveManager/League/PlatformBehavioralIntelligence`. This is what "real Decision OS outputs" means —
  **derived on read** from ingested events.
- **`resolveDataProvider()`** (`.../provider-selector.ts`) is **flag-gated**:
  `DECISION_OS_INTELLIGENCE_API_PROVIDER === 'real'` → `realDataProvider`; **else → `stubDataProvider` →
  `null` → HTTP 503 `INTELLIGENCE_UNAVAILABLE`.** i.e. **default-off.** (The flag does not appear enabled
  anywhere in-tree — outputs are effectively unavailable by default.)

## 4. Current state — the five target surfaces (the alignment problem)

| Surface | Exists? | Reads from | Aligned to Decision OS outputs? |
| --- | --- | --- | --- |
| **Manager Intelligence** | ✅ `app/api/v1/intelligence/manager/route.ts` (+ manager-hub) | `resolveDataProvider()` → behavioral pipeline | ✅ *when flag=real* — else 503 |
| **League Health** | ✅ `app/api/league-health/route.ts` (+ commissioner-hub) | **`monitorLeagueHealth` from `@/lib/league-health`** — a **separate, independent** computation | ❌ **different source entirely** |
| **Recommendations** | ⚠ scattered (no single Decision-OS-backed surface) | mixed (AI history/saved, various) | ❌ not unified |
| **Mission Control** | ❌ **not found** by that name (g15 or `decision-os-demo-review`) | — | ❌ **does not exist** |
| **League Analytics** | ❌ **not found** by that name | — | ❌ **does not exist** |

**This is the core misalignment:** the surfaces do **not** read the same outputs. Manager Intelligence
uses the behavioral pipeline (default-off); League Health uses an unrelated `monitorLeagueHealth`;
Recommendations is scattered; and two named surfaces don't exist yet.

---

## 5. Proposed Phase A plan (NOT implemented)

### Track A — Productionize ingestion → real events
- **A1. Idempotent, re-runnable Sleeper backfill** — upsert by natural key (league/season/week/event), so
  re-runs converge instead of duplicating; explicit "already ingested → skip" guards.
- **A2. Orchestrated + schedulable** — a first-class ingestion job (not post-import-only) with
  checkpoint/resume, retry+backoff, Sleeper rate-limit handling, and a durable **run-log** (status,
  counts, cursor) for repeatability + observability.
- **A3. Snapshot capture** — deterministic capture of the Canonical World/BehavioralEvents per league per
  run; verify the pipeline's inputs are populated (imported leagues were "~empty" per memory — confirm
  events actually land).

### Track B — One canonical read-path + surface alignment
- **B1. Single source of truth** — designate the **behavioral pipeline via `realDataProvider`** as the one
  Decision OS output contract (Manager / League / Platform intelligence), keyed per league.
- **B2. Re-point existing surfaces** — migrate **League Health** off `monitorLeagueHealth` onto the
  Decision OS League intelligence output (or wrap it as an adapter over the same facts); consolidate
  **Recommendations** onto the same pipeline.
- **B3. Build the two missing surfaces** — **Mission Control** + **League Analytics** on top of the same
  outputs (**pending the user's clarification** on whether these are new builds or renamed existing surfaces).
- **B4. Controlled enablement** — flip `DECISION_OS_INTELLIGENCE_API_PROVIDER=real` behind a **per-league,
  staging-first rollout** with a parity gate; never a blanket prod default.

### Sequencing
A1–A3 (real events exist + repeatable) → B1 (contract) → B2 (align existing) → B3 (build missing) → B4
(enable). Track B is meaningless until Track A yields non-empty real events for a target league.

---

## 6. Prerequisites, risks, and open questions

**Prereqs / risks**
- **All of this is on unmerged `g15`** (parked). A base-branch/home decision is required before any
  implementation — the same publication problem as the Decision OS demo layer.
- **Outputs need real ingested data.** Memory notes imported leagues were "~empty" for snapshots —
  Track A must actually populate events for a real Sleeper league, or B shows nothing.
- **Standing feature freeze:** the roadmap order is NFL-Redraft closed beta → stabilization → public beta
  → *then* Decision OS. This plan is explicitly **pre-freeze-lift**; implementing it means changing that order.

**Open questions for the user (blockers for a concrete Phase A)**
1. **Mission Control & League Analytics don't exist by name** — are they new surfaces to build, or renames
   of existing ones (e.g., Commissioner Hub / an analytics view)? What should each show?
2. **Target league:** which real imported Sleeper league is Phase A's proof target?
3. **League Health:** replace `monitorLeagueHealth` with the Decision OS output, or federate the two?
4. **Base branch/home** for eventual implementation (g15 is unmerged + churned)?

## 7. Boundaries honored
- Read-only audit; **no code changed, no flags flipped, no live DB, nothing built.**
- Freeze remains in effect; this is a plan to execute **only** on an explicit freeze-lift.
