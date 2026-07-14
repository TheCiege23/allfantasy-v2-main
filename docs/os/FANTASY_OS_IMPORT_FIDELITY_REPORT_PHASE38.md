# Import Fidelity Report (Phase 38, Part 2)

## Honest scope limitation, stated up front

Per this phase's explicit instruction ("never fabricate coverage"): **real import fidelity validation (comparing imported data against the source provider) was only possible for Sleeper**, the sole provider with real imported leagues in `.env.test` (3 leagues). Sleeper's import fidelity has already been extensively, repeatedly real-validated across Phases 13-37 of this effort — no new Sleeper fidelity work was needed or performed this phase.

For ESPN, Yahoo, Fantrax, MFL, and Fleaflicker: **zero real imported leagues exist to measure fidelity against.** The items below reflect what was verified — code completeness and the one confirmed real bug — not measured import fidelity, which requires real data this environment does not have.

## What WAS validated for the 5 non-Sleeper providers (code-level only)

| Field | ESPN | Yahoo | Fantrax | MFL | Fleaflicker |
|---|---|---|---|---|---|
| League metadata | Real parser exists | Real parser exists | Real parser exists (reads local DB) | Real parser exists | Real parser exists (thin) |
| Managers/rosters | Real, complete | Real, complete | Real (dependent on DB row existing) | Real, complete | Real, current-season only |
| Scoring settings | Real, per-stat rules | Real, per-stat rules | Explicitly limited (`'missing'` in most cases) | Weaker — string-matching only | Not parsed at all (`'missing'`) |
| Transactions | Real | Real | Real (if DB row exists) | Real | **Not populated** (`[]`) |
| Draft history | Real | Real | Real (if DB row exists) | Real | **Not populated** (`[]`) |
| Keeper/dynasty settings | Real (`keeperCount`-based) | Real (raw setting keys) | Real (`isDevy` flag) | Real (multiple raw keys) | Heuristic (name/description text match) |
| IDP | Roster slots recognized; individual player positions unmapped (real, disclosed gap) | Not specifically audited this phase | Not specifically audited this phase | Not specifically audited this phase | Not specifically audited this phase |
| Playoffs | Real (`playoff_team_count` derivation confirmed present) | Real | Not specifically audited this phase | Not specifically audited this phase | **Guessed** (`Math.max(2, leagueSize/2)`, not read from real settings) |
| Historical seasons | Real (season-probing discovery + backfill service) | Real (same pattern) | Real (dependent on prior `FantraxLeague` rows existing) | Real (season-probing discovery + backfill service) | **Not supported** — no discovery, no backfill service exists |

## The one confirmed real fidelity defect, found and fixed this phase

**Bench/reserve roster-slot miscounting for ESPN, Yahoo, and MFL imports** (all three, every import, not an edge case) — see Provider-Specific Bug Fixes and the Provider Data Model Audit for full detail. This was a genuine import-fidelity bug: the imported league's real roster structure (bench/IR/taxi slot counts) was silently miscomputed for every real import from these three providers, confirmed via direct code reading and reproduced via a real-execution unit test using each provider's exact real data shape.

## Sample sizes, stated honestly

- Sleeper: not re-measured this phase (already extensively real-validated in prior phases); 3 real leagues exist.
- ESPN/Yahoo/Fantrax/MFL/Fleaflicker: **0 real leagues, 0 real fidelity samples.** Import-only or partial-stub support, code-audited, not fidelity-measured.
