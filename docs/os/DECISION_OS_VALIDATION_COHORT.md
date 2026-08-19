# Fantasy OS — Decision OS Validation Cohort (Phase V7.1)

**Branch:** `g15-event-foundation` · **Scope:** internal validation tooling. **Sleeper is a validation
SOURCE, not the product** — its specifics live only in one resolver seam; everything downstream is
provider-neutral. No customer-facing feature, no new Operating System, no presentation change.

> **Goal:** strengthen and validate Decision OS against a diverse set of REAL Sleeper leagues while
> preserving provider abstraction — prove Decision OS produces correct, provider-agnostic decisions, and
> fix only defects that evidence proves.

---

## 1. What was built

A DB-less cohort validation pipeline under `lib/validation-cohort/` + an internal CLI. It resolves a
cohort of Sleeper usernames, imports league data through a single provider seam into **provider-neutral
facts**, classifies archetypes, runs the Decision OS derivations reachable without persistence, and emits
deterministic per-league + aggregate reports with a calibration/anomaly audit.

| Module | Responsibility |
| --- | --- |
| `types.ts` | Registry, neutral facts, archetype, probe, report, anomaly types |
| `normalizeCohort.ts` | Casing/dedupe + username-vs-name pre-classification (no guessing) |
| `sleeperCohortClient.ts` | **The only Sleeper-aware code** — resolve, fetch, and `mapLeagueToFacts` (the seam); bounded-concurrency pool; injectable fetch |
| `archetypeClassifier.ts` | Pure archetype tags, each citing its source field/rule |
| `decisionOsProbe.ts` | DB-less Decision OS derivation + reachability marking |
| `anomalyDetector.ts` | Deterministic calibration detectors (surface, never auto-tune) |
| `reportBuilder.ts` | Deterministic per-league + aggregate report + human summary |
| `runCohort.ts` | Orchestration: resolve → dedupe → facts → classify → probe → detect → report |
| `scripts/decision-os-validate-sleeper-cohort.ts` | Internal CLI (the only live-API caller) |

Command: `npm run decision-os:validate-sleeper-cohort -- --cohort=<file> [--dryRun] [--maxLeagues=N]
[--season=YYYY] [--concurrency=3] [--maxTxWeeks=18] [--resume=<prior.json>] [--out=<dir>]` (or
`--username=<one>`).

## 2. Reuse (Step 1 audit) — no parallel importer

The existing Sleeper primitives are reused, not duplicated: username→userId (`commissionerGate` pattern),
userId→leagues + league payload (`SleeperLeagueFetchService` pattern), and the Decision OS derivation
cores. The genuinely new work is the multi-username **cohort orchestration**, the **archetype
classifier**, the **validation report**, and the **calibration audit**. The pre-existing DB-backed
proof runners (`decision-os-import-sleeper-nonprod.ts`, `…-ingest-…`) remain the path for full,
persisted, all-seven-OS derivation.

## 3. The path

```text
Sleeper username
  → resolveUsername            (GET /v1/user/<username>)
  → fetchUserLeagues           (GET /v1/user/<userId>/leagues/<sport>/<season>)
  → fetchLeagueFacts           (users + rosters + bounded transactions)
  → mapLeagueToFacts           (THE provider seam → NormalizedLeagueFacts)
  → classifyArchetypes         (pure, evidence-cited)
  → probeLeague                (DB-less Decision OS: monitorLeagueHealth + reachability)
  → detect{League,Cohort}Anomalies
  → report (per-league + aggregate, deterministic)
```

## 4. DB-less reachability boundary (honest)

Decision OS has **pure derivation cores** wrapped by async DB adapters. DB-less mode runs the pure cores:

| Operating System output | DB-less | Why |
| --- | --- | --- |
| Commissioner OS — league health | ✅ available | `monitorLeagueHealth` is pure/deterministic |
| League OS — momentum inputs (engagement/fairness/sustainability) | ✅ available | same engine |
| Draft OS — draft-state consistency | ✅ available | derived from draft status |
| Manager OS — trajectory + recommendations | ⛔ db-backed-only | needs persisted rosters/matchups |
| Trade OS / Waiver OS — recommendations | ⛔ db-backed-only | need player pool + roster ownership |
| Platform OS — cross-league focus | ⛔ db-backed-only | aggregate over the above |

Inputs the public API does not expose (chat/votes/disputes/FAAB%/commissioner actions) are **defaulted and
disclosed** (`DB_LESS_UNAVAILABLE_INPUTS`), never fabricated.

## 5. Live validation evidence (real Sleeper data)

The API is reachable from this environment, so the tooling was validated live against one **public**
account already used as a default in this repo's scripts (`theciege24`) — a smoke test of the tooling,
distinct from any customer cohort:

- **Discovery:** dry-run resolved the account and discovered **67 real 2024 leagues**.
- **Full run (bounded: 10 leagues, 3 tx-weeks):** all 10 processed, **0 errors**. Real archetype
  diversity (dynasty/redraft, 1QB/superflex, TEP on/off, standard/large, commissioner/member source,
  activity bands, waiver environments). Health scores differentiated 49–91 across excellent/healthy/at_risk.

### Calibration findings (Steps 7–8) — traced, no tuning

| Signal | Root-cause trace | Verdict |
| --- | --- | --- |
| `fairness = 100` in all 10 leagues | Fairness draws on dispute/collusion/commissioner signals the public API doesn't expose → they default to "no problems" | **Expected DB-less limitation**, not a defect. Exercised only in DB-backed mode with real dispute data |
| `identical-recommendation-across-leagues` (8/10: "…stimulate trade activity") | All 8 are low-trade-activity leagues (one manager's mostly-quiet leagues); the recommendation correctly targets that state | **Expected** (correlated single-account cohort), not a defect. Suppressing it would hide a correct recommendation — forbidden by Step 8 |

**Result: zero proven Decision OS defects → zero Decision OS changes.** One tooling improvement was made
(serialize cohort-anomaly *detail*, not just counts, so root-cause tracing is possible). Whether the
trade recommendation *over*-fires on genuinely active leagues can only be tested by a **diverse,
multi-account cohort** — that is what the supplied cohort is for.

## 6. Privacy & data handling (Step 10)

No credentials, no chat/message content. League ids are one-way anonymized (`lg_<hash>`) in all reports;
account names are never rendered to customers. Only public, user-authorized account data is read, and only
the minimum needed for validation (bounded transaction weeks, capped league count). Any account can be
removed from a cohort by editing the input list.

## 7. Boundaries honored

Sleeper is a validation source, not the product · no Sleeper-specific executive UI · no raw provider
payloads in presentation · no fabricated data/analytics · no new Operating System · no Legacy/B2C · no
unbounded imports (bounded concurrency + `--maxLeagues`) · no tuning without proven cause · the cohort
import is an explicit internal command, never a production request path.

## 8. What remains / next

Run the **supplied username cohort** (not yet provided in-session) through the CLI to validate Decision OS
across genuinely diverse, multi-account leagues, and re-run the calibration audit — the over-firing
question in §5 can only be answered there. For full seven-OS derivation on any subset, use the existing
DB-backed non-prod runner against the Phase E non-prod project.
