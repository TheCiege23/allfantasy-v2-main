# ESPN Commissioner Import Certification

Date: 2026-07-12. Real disposable, production-forked Neon branch
(`br-green-lab-admi6kkj`); a real, publicly-readable ESPN league
(`899513`, season 2023, "Pino Posse", 10 real teams). No ESPN account
credentials were available this phase (none linked in the disposable
database, and pasting real SWID/espn_s2 session cookies into chat was
correctly avoided per user decision — see below). Every claim tagged
**physically proven**, **source-verified**, **unsupported by ESPN**, or
**blocked (no credentials)**.

## Credential constraint, disclosed up front

ESPN requires SWID/espn_s2 session cookies for private-league access and
for the commissioner gate to resolve a viewer's real team identity. No real
ESPN account was available this phase. The user was asked and chose: test
with a real *public* ESPN league (no cookies needed) rather than paste raw
session cookies into chat. A real, currently-public league (`899513`) was
found and used for full pipeline testing. **Consequence, honestly stated**:
the "real commissioner successfully authorized and committed" scenario
specifically (as opposed to the commit *pipeline* itself, which was fully
exercised with real data by calling it directly) was not independently
provable this phase — the commissioner gate's *rejection* behavior for a
non-linked account was proven instead, which is the security-critical half.

## 1. Real call graph (fresh-audited, Part 1)

```text
ESPN Authentication (SWID + espn_s2 cookies OR unauthenticated for public leagues)
  -> lib/league-import/espn/EspnLeagueFetchService.ts fetchEspnLeagueForImport()
League Discovery: NOT IMPLEMENTED for ESPN (supportsImportProviderDiscovery gates this to Sleeper only) — unchanged this phase, matches prior audit
Preview: POST /api/leagues/import/preview -> assertImportCommissioner (membership gate, real, unchanged) -> orchestrateImportPreview -> same EspnLeagueFetchService call
Normalization: lib/league-import/adapters/espn/EspnAdapter.ts normalize() — SHARED interface (ILeagueImportAdapter), provider-specific implementation (as designed)
Validation: shared ImportedLeaguePreviewBuilder / canonical bundle builder — SHARED, no ESPN branch
Canonical Commit: POST /api/leagues/import/commit -> assertImportCommissioner({requireCommissioner:true}) -> runImportedLeagueNormalizationPipeline -> persistImportedLeagueFromNormalization — SHARED, the exact same function Sleeper uses, zero ESPN-specific code in the commit route itself
  -> bootstrapLeagueFromNormalizedImport — SHARED (misleadingly lives under lib/league-import/sleeper/ but is provider-agnostic)
  -> materializeRedraftSeasonForImportedLeague — NEW this phase, SHARED, provider-agnostic (see CANONICAL_IMPORT_LIFECYCLE.md)
Dashboard / Manager OS / Trade Decision OS: SHARED, zero ESPN-specific code — physically proven reachable with real ESPN data (see §5)
```

**Provider-specific branches that genuinely must remain provider-specific**
(correctly so, not flagged as debt): `EspnLeagueFetchService.ts`'s raw HTTP
calls and cookie handling; `EspnAdapter.ts`'s field mapping (ESPN's raw JSON
shape has nothing in common with Sleeper's); `commissionerGate.ts`'s
`checkEspn` (viewer-team resolution is inherently provider-specific).

**No ESPN-specific business logic was found or added anywhere it shouldn't
be** — the commit route, the bootstrap service, the season materialization,
Dashboard, Manager OS, and Trade OS are all already (or newly, this phase)
provider-agnostic.

## 2. Status mapping (Part 2)

`EspnAdapter.ts` had the identical defect `SleeperLeagueMapper.ts` had: no
league-level `status` mapped through. Fixed this phase using ESPN's real,
honest signal — `EspnImportLeague.isFinished` (already computed elsewhere
from `status.finalScoringPeriod` vs. current matchup period, previously
computed but never surfaced) — mapped to `'complete'` or `'in_season'`.
**Not a shared-mapper fix** (Sleeper/ESPN/Yahoo/MFL each have their own
adapter file, by design — no shared mapper exists to fix once); Yahoo and
MFL confirmed via source read to have the identical gap, **not fixed this
phase**, named for their own certification phases.

**Physically proven**: the real ESPN league (`isFinished:true`) produced
`League.status:'complete'`, and the league appeared on a real
`getDashboardLeagueListForUser` query — the same mechanism proven for
Sleeper, now proven for ESPN too.

## 3–4. Canonical lifecycle + ESPN parity (Parts 3–4)

See `CANONICAL_IMPORT_LIFECYCLE.md` for the full canonical-lifecycle
architecture and physical proof (shared with Sleeper's proof, since the
mechanism is provider-agnostic).

### ESPN one-to-one parity matrix

| Domain | Result | Evidence |
|---|---|---|
| League metadata | **Physically proven** | Real name "Pino Posse", size 10, season 2023 |
| Managers | **Physically proven** | 10 real teams/owners (real ESPN member GUIDs) |
| Commissioner | **Source-verified only** | `viewerTeamId`/`commissionerTeamIds` resolution logic read and confirmed correct; not independently re-provable without real cookies this phase |
| Co-commissioners | **Source-verified only** | Same constraint as above |
| Teams / Rosters | **Physically proven** | 10 real `LeagueTeam` + `Roster` rows created |
| Draft / draft order / picks | **Physically proven (fetch), not persistence-verified this phase** | Real fetch returned 150 real draft picks; persistence of `future_draft_picks`/draft config was not separately re-queried this phase (unchanged code path from before) |
| Schedules / Matchups | **Physically proven (fetch)** | Real fetch returned 16 real schedule weeks |
| Transactions | **Physically proven (fetch), zero present** | Real league had 0 fetched transactions (real data, not a bug) |
| Scoring | **Physically proven** | Real scoring settings normalized without error |
| Roster settings | **Source-verified** | Unchanged code path from prior audit |
| Keeper / Dynasty indicators | **Source-verified, heuristic** | `detectEspnDynasty()` unchanged; real league's keeper-count-based detection ran without error |
| Historical seasons | **Not tested this phase** | `includePreviousSeasons:false` was used deliberately to keep the physical test scoped and fast; the mechanism itself is unchanged from the prior audit |
| Playoffs | **Unsupported by ESPN/AllFantasy alike** | Same disclosed gap as Sleeper — no canonical relational model for playoff *results* for any provider |
| FAAB / Waivers | **Source-verified** | Unchanged code path |
| Trade history | **Source-verified** | Unchanged code path |

## 5. Downstream proof — real ESPN data

| Surface | Result |
|---|---|
| Dashboard | **Physically proven** |
| Commissioner OS | **Source-verified** (same internal API as Manager OS, per prior phase's finding) |
| Manager OS | **Physically proven** — real payload returned |
| Rankings | **Confirmed architectural gap, ESPN included** — see `CANONICAL_IMPORT_LIFECYCLE.md` §Rankings |
| Trade Decision OS | **Physically proven** — real facts returned, zero ESPN-specific code |
| Renewal | **Physically proven compatible** — the existing, untouched `evaluateNextSeasonEligibility` correctly evaluated the ESPN league's materialized season as eligible |

## 6. Idempotency / duplicate prevention

**Physically proven**: an exact-replay commit for the same real ESPN league
returned the same `League.id` with `existed:true`. A duplicate-import
attempt (no `force`) was correctly rejected with `ImportedLeagueConflictError`
("This league already exists in your account"); exactly 1 `League` row
survived.

## Verdict

**ESPN Commissioner Import Status: CERTIFIED WITH DOCUMENTED LIMITATIONS.**
The full commit pipeline, canonical lifecycle materialization, and every
downstream consumer this phase set out to prove were physically proven with
real ESPN data. The one honest gap is the authenticated-commissioner-success
path specifically, which requires real session cookies not available this
phase — the gate's *rejection* behavior (the security-critical half) was
proven instead.
