# Fantasy OS — V7.2 Historical Ingestion Pipeline (reusable infrastructure)

**Branch:** `g15-event-foundation` · **Scope:** internal validation tooling (extends `lib/validation-cohort/`).
No new Operating System, no Decision OS change, no presentation change, no backend tenancy.

> **Status: the reusable ingestion infrastructure is built and live-verified. The actual V7.2 cohort
> validation did NOT run — no username cohort was supplied.** Per the phase instruction ("if the cohort is
> unavailable, complete the reusable ingestion infrastructure and stop rather than inventing validation
> results"), this phase built and tested the historical-discovery pipeline and stopped. No usernames were
> invented, no portfolios or validation results were fabricated.

---

## 1. Cohort input — confirmed absent

Checked the repository (no cohort/usernames file), environment (no `SLEEPER_COHORT`-style var), and the
current context (no list pasted). **No username cohort is available.** The only "cohort"-named files are
this project's own V7.1 tooling. Therefore Parts 1 (resolution reports), 4 (Decision OS validation), 5
(seven-OS verification), and 6 (populated artifacts) cannot produce real data yet and were not faked.

## 2. What was built (reusable, provider-neutral)

V7.1 validated a single current season. V7.2 adds the **historical** dimension it lacked:

| File | Adds |
| --- | --- |
| `portfolioDiscovery.ts` | Bounded **multi-season enumeration** (explicit `--seasons` list, never an open range); per-league **role resolution** (commissioner/member); anonymized refs; `runDiscovery` orchestrator |
| `portfolioManifest.ts` | `buildPortfolioManifest` — assembles **season-continuity chains** (via `previous_league_id`), **shared-league** detection (same league under >1 account), totals; `buildHistoricalCoverageMatrix` — records only OBSERVED evidence categories |
| `types.ts` | `DiscoveredLeague`, `AccountPortfolio`, `LeagueChain`, `PortfolioManifest`, `EvidenceCategory`, `HistoricalCoverageMatrix` |
| CLI `--discover` | Writes `portfolio-manifest-*.json` + `historical-coverage-matrix-*.json`; requires explicit `--seasons`; `--noRoles` to skip role calls |

**Reuse, not rebuild:** discovery reuses the V7.1 `resolveUsername`, `runPool` (bounded concurrency), and
anonymization. No parallel importer was created.

### Boundaries honored (Part 2/3)

- **Bounded, no unbounded crawl:** discovery only enumerates the explicit season list for the *approved
  root accounts*; it never walks into other league members' unrelated leagues.
- **Chains are assembled from the discovered set** (linking `previous_league_id` among discovered leagues)
  — it does not chase leagues outside the requested boundary.
- **Anonymized + privacy-preserving:** accounts (`acct_<hash>`) and leagues (`lg_<hash>`) only; no raw
  provider ids, usernames, or names in any artifact.
- **Coverage matrix records only observed truth:** discovery marks `metadata` present and
  `previous_league` where a prior exists; every other category stays absent until a live import verifies
  it — never assumed.

## 3. Live verification (tooling, not a customer cohort)

The Sleeper API is reachable here, so the pipeline was smoke-tested against one **public** account already
used as a repo default (`theciege24`), to prove it works — distinct from any customer cohort:

```
--discover --username=theciege24 --seasons=2024,2023,2022 --noRoles
→ resolved 1/1 · uniqueLeagues=329 · seasons=[2022,2023,2024] · chains=101 · sharedLeagues=0
```

329 real leagues across three seasons, **101 season-continuity chains** correctly assembled from
`previous_league_id` — real proof the multi-season enumeration and chain logic work end to end.

## 4. Tests

`__tests__/validation-cohort/portfolio-discovery.test.ts` (5, fixture/DI): bounded enumeration, role
resolution, anonymization (no raw ids leak), a 3-season chain, shared-league detection, coverage-matrix
observed-only semantics, and `runDiscovery` end-to-end (resolved + unresolved + ambiguous handled without
guessing). Full cohort suite green.

## 5. What remains (needs the real cohort)

When a username cohort is supplied:
1. `--discover --cohort=<file> --seasons=<list>` → real Portfolio Manifest + Historical Coverage Matrix.
2. Extend the per-league import to gather the remaining evidence categories (standings, matchups, drafts,
   draft picks, FAAB) and populate the coverage matrix from observed data.
3. Run Decision OS over the corpus (Part 4), verify differentiated seven-OS outputs (Part 5), and produce
   the remaining artifacts (Part 6) — all from real observed data only.

The DB-less reachability boundary from V7.1 still applies; for full seven-OS derivation on a subset, use
the existing DB-backed non-prod runner.
