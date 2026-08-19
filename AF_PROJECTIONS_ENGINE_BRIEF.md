# AF Projections Engine — build brief

**Status:** decisions locked 2026-08-10. Not yet started.
**Owner:** Guap

---

## Why this exists

Production has **no projection data at all**. `fantasy_projections` holds 43 rows, every one a
`runtime-seed` fixture with ids (`rwr-member-*`) that join to neither `SportsPlayerRecord` nor
`Player`. `af_projection_snapshots` is empty.

Everything downstream is therefore **dark, not wrong**:

| Surface | Reads | Result today |
| --- | --- | --- |
| Player Command Center `projection` | `fantasyProjection` | always `null` |
| `replacementOptions` (bench + FA) | ranks BY projection | cannot rank |
| Chimmy replacement grounding | the above | no numbers to cite |
| Draft VORP | replacement level from projections | inert (why `observe` is safe) |
| redraft / bestball / guillotine war rooms | `fantasyProjection` | projectionless |

The slice 11–12 honesty passes mean these render "unavailable" instead of inventing numbers. That is
correct behaviour and it is also why the outage went unnoticed for at least a month.

### Root cause chain (all silent)

```
CLEARSPORTS_API_KEY invalid
  -> getClearSportsConfigFromEnv() = null        provider-config.ts:176
  -> clearSportsFetch() = null                   lib/clear-sports/client.ts:83
  -> rowsFrom() = []                             lib/clear-sports/index.ts:175
  -> writes 0 rows, returns ok:true              app/api/cron/import-projections/route.ts:175
```

Cron auth is fine (`requireCronAuth(req,'CRON_SECRET')`). The season gate is fine (NFL = months 8–2).
The cron has been reporting success while writing nothing.

### Neither provider sells projections

- **ClearSports** — on the only working base (`https://api.clearsportsapi.com/api/v1`):
  `nfl/teams|games|player-stats` = **401** (route exists, auth dead);
  `nfl/projections|players|rankings` = **404** (route does not exist).
- **Rolling Insights** — official NFL docs list schedule, live feed, team info, team season stats,
  player info, player season statistics, injuries, depth charts, DK fantasy points, play-by-play.
  **No projections.** `DK_fantasy_points` is scoring for games already played, not a forecast.

---

## Decision

**Compute AllFantasy's own projections from Rolling Insights inputs, into `AFProjectionSnapshot`.**

That table was already modelled for exactly this and has never been written to:
`baselineProjection`, `weatherAdjustment`, `afProjection`, `adjustmentFactors`, `adjustmentReason`,
`confidenceLevel`, `isOutdoorGame`, `snapshotLookupKey`.

Rationale: owned IP rather than reselling a vendor's numbers; league-scoring-aware by construction
(we hold the stat components, so we can score them per league); no new vendor spend; and RI already
supplies every input.

Secondary decision: **ClearSports = fix base URL, then renew key.** Not retired.

---

## Verified provider facts (probed 2026-08-10, not assumed)

**Working REST base:** `https://rest.datafeeds.rolling-insights.com/api/v1`
**Auth:** `?RSC_token=<ROLLING_INSIGHTS_RSC_TOKEN>` query param (64 chars, valid)
**Shape:** `{ data: { NFL: [ ... ] } }`

| Path | Season segment | 2025 result |
| --- | --- | --- |
| `player-stats/{season}/{SPORT}` | yes | **2182 rows** — projection base |
| `team-stats/{season}/{SPORT}` | yes | 32 rows — pace/volume context |
| `player-info/{SPORT}` | no | 9548 rows — roster + position |
| `depth-charts/{SPORT}` | no | present — opportunity share |
| `injuries/{SPORT}` | no | 32 rows — availability |
| `schedule-season/{season}/{SPORT}` | yes | 333 games |
| `weekly-schedule/{season}/{SPORT}` | yes | 16 games |

Path names that do **NOT** exist despite the docs' headings: `team-season-stats`,
`player-season-stats`, `projections`, `rankings`, `adp`. The doc headings are prose titles, not paths.

`player-stats` for season **2026** returns `304` — the season has not kicked off. Prior-season data is
what the engine bootstraps from anyway; handle in-season transition explicitly.

---

## CORRECTED DIAGNOSIS (2026-08-10, after reading the RI provider properly)

An earlier draft of this brief blamed the RI base URL. That was wrong, and the correction matters
because it changes both the fix and the risk.

**The RI integration is nearly correct already.** `lib/workers/providers/rolling-insights.ts`
falls through from api_key mode to a client_credentials probe loop over
`buildRestBaseCandidates × buildRestPathCandidates × rscTokenCandidates`, using `?RSC_token=`.
`DEFAULT_RI_REST_BASES` (line 11) **already contains** the working
`https://rest.datafeeds.rolling-insights.com/api/v1`, and `pathBySportCode(...).projections`
(line 177) **already lists `player-stats/{year}/{sportCode}` first**. Also
`isRollingInsightsEnabledForSport` returns `true` unconditionally (`api-config.ts:91`) — the
`RI_*_ENABLED` vars are not consulted there, so nothing is gated off.

**The actual cause of zero rows: the season.** `import-projections` computes
`currentSeason()` → **2026** (month ≥ 8), so every candidate becomes `player-stats/2026/NFL`, which
returns **304** because the 2026 season has not kicked off. Line 608 records `HTTP 304` and continues;
all candidates exhaust; 0 rows; `ok: true`. There is **no prior-season fallback**. Probed directly:
`player-stats/2026/NFL` → 304, `player-stats/2025/NFL` → **2182 rows**.

**The wrong mapping, and why it is inert rather than dangerous.** `buildRestPathCandidates` maps the
`projections` dataType onto `player-stats/{year}/{SPORT}` — a **historical production** endpoint.
`persistProjectionRows` reads `row.projectedPoints ?? row.points ?? row.fpts ?? row.fantasyPoints ??
row.projection`. Measured 2026-08-10 against 2025 rows: **none of those fields exist**. The real shape is

```
player_id, player, team, team_id, regular_season{...}, postseason
```

so every row would be skipped even with a working season. The mapping is therefore semantically wrong
but harmless today. Still sever it — `projections` must never resolve to a historical endpoint — but it
is not an active correctness bug.

**Shape facts that constrain the engine (measured, not assumed):**
- `player-stats` carries **no `position` field**. Position must come from `player-info` (9548 rows) or
  the depth charts. Any position-aware logic that reads player-stats alone gets `UNKNOWN`.
- `regular_season` contents vary by player type; the first row sampled was defensive
  (`sacks`, `tackles`, `snap_count_defense/offense/special_teams`). Offensive component coverage must be
  confirmed by key-union across all rows before Phase 2 is scoped — if passing/rushing/receiving volume
  is absent, there is no basis for QB/RB/WR/TE projections and the decision must be revisited.
- `depth-charts/NFL` is keyed by team name, with slot codes carrying `id` + `player`
  (`C.1`, `FB.1`, `FS.1`, `KR.1`, `P.1`, …). IDP roles ARE represented (e.g. `FS`).
- `injuries/NFL` returns 32 team rows with a nested `injuries` array, not a flat player list.

---

## Bugs to fix first (each is a silent misconfiguration)

1. **`provider-config.ts:41`** — `DEFAULT_ROLLING_INSIGHTS_BASE_URL = 'https://datafeeds.rolling-insights.com'`
   404s on every path; the working REST host is `rest.datafeeds.rolling-insights.com/api/v1`. NOTE per
   the corrected diagnosis above: the probe loop recovers via `DEFAULT_RI_REST_BASES`, so this is a
   latent trap rather than the active cause — it still misleads the api_key branch and anyone reading
   the config. Fix it, but do not expect it alone to populate anything.
2. **`CLEARSPORTS_API_BASE`** = `https://api.clearsports.com/v1` — host does not resolve. Set to
   `https://api.clearsportsapi.com/api/v1` in `.env` AND Vercel, then renew the key (401 everywhere).
3. **`sports-live-scores-service.ts:361`** — FIXED 2026-08-10. Read both `ROLLING_INSIGHTS_REST_BASE`
   and `..._REST_BASE_URL`; they carry different semantics (host root vs includes `/api/v1`).
4. **Ingest crons must fail loudly.** `import-projections` returns `ok: true` after writing zero rows.
   In-season + unforced + zero rows written must be `ok: false`. This single change turns a month-long
   silent outage into a same-day alert, and must land BEFORE the new pipeline so it is observable from
   the start rather than retrofitted.

---

## Production ingest health (measured 2026-08-10) — read this before Phase 1

| Table | Rows | Newest | Verdict |
| --- | --- | --- | --- |
| `sportsPlayerRecord` | 88,446 | 8.6h | OK |
| `sportsGame` | 4,283 | 11.6h | OK |
| `sportsDataCache` | 2,256 | 2.4h | OK |
| `sportsInjury` | 3,581 | **17.2 DAYS** | STALE — cron runs every 15 min |
| `injuryReportRecord` | 1,358 | **103.7 days** | STALE |
| `gameSchedule` | 0 | never | empty (likely legacy — `sportsGame` is the live table) |
| `fantasyScheduleGame` | 0 | never | empty (likely legacy) |
| `fantasyStatLine` | 0 | never | **EMPTY — this is the projection base** |
| `fantasyProjection` | 43 | 34.4 days | seed fixtures only |
| `aFProjectionSnapshot` | 0 | never | expected (Phase 2 target) |

### 🔴 Injuries are BROKEN differently — and worse — than projections

Projections degrade to `null` (honestly absent). Stale injuries render **confidently wrong**: a player
out for two weeks still shows healthy, and `playerUrgency.ts` — the "OUT and still starting, N minutes
to lock" detection that is the core of the Player Command Center — computes off it.

**Root cause (probed, not inferred):** `import-injuries` uses API-Sports, not Rolling Insights, and the
account is on the **Free** plan:

```
plan: Free   active: true   requests: 36/100
/injuries?team=1&season=2025 -> {"plan":"Free plans do not have access to this season, try from 2022 to 2024."}
/injuries?team=1&season=2026 -> same
```

Not quota. Not cadence. Not code. The plan cannot serve 2025+ at all, so injuries have been impossible
since the 2025 season opened.

**Fix without spending anything:** Rolling Insights already serves injuries — `injuries/NFL` returns
HTTP 200 with 32 team rows (`{team, team_id, injuries[]}`) on the credentials we verified working.
Migrate `syncAPISportsInjuriesToDb` onto RI.

Secondary benefit: `fetchAPISportsInjuriesViaTeamFanout` loops 32 teams, and the cron runs every 15
minutes — ~3,072 requests/day for NFL alone against a 100/day allowance. The RI migration removes that
regardless.

**Also audit what else routes through `apiSportsProvider`** — anything needing 2025+ data from that
provider is dead for the same reason.

### Phase 1 readiness

BLOCKED on two inputs: `sportsInjury` (stale) and `fantasyStatLine` (empty). Repair both before
building the engine, or it computes from nothing — and unlike the current state it would emit numbers
rather than nulls, because emitting a number is a projection engine's job.

---

## Phases

### Phase 0 — stop the silence
Fix bugs 1, 2, 4 above. Add a test asserting the RI base resolves to the `rest.` host. No new features.

### Phase 1 — RI ingest
New cron writing raw RI rows. Reuse the `FantasyStatLine` model (it already has `stats Json` and
`fantasyPointsByScoringPreset`). Cover `player-stats`, `team-stats`, `depth-charts`, `injuries`.

**Highest risk: the ID namespace.** RI player ids are NOT canonical AF ids.
`crossLeaguePlayerPortfolio` resolves canonical ids, so a naive write reproduces exactly the failure we
just measured — rows that exist but join to nothing. Every RI player MUST resolve through the canonical
identity layer, using `lib/player-match/verifiedNameMatch.ts` (slice 15) so position/team are verified
and ambiguity is REFUSED rather than resolved by map order. Track and report the unresolved rate; if it
is high, stop and fix matching before proceeding.

### Phase 2 — projection engine
Compute into `AFProjectionSnapshot`. Inputs: prior-season per-game production, depth-chart role,
injury status, opponent + venue from schedule, weather where available.

Honesty requirements, non-negotiable:
- `confidenceLevel` must be derived from real input coverage, never a constant.
- Missing inputs are EXCLUDED, never defaulted to a midpoint (the acceptance-model lesson from slice 16).
- `adjustmentReason` must name the actual adjustments applied.
- Refuse to emit a projection at all rather than emit a low-confidence guess presented as a number.

### Phase 3 — read port
Point `crossLeaguePlayerPortfolio.ts` (~line 489) at `AFProjectionSnapshot`, keeping
`FantasyProjection` as fallback. Add a `source` field to the payload so the UI can label provenance.

Also fix, in the same pass: **no consumer filters by `scoringPresetId`** even though it is in the
unique key, and consumers collapse rows via `new Map(rows.map(...))` with no `source` filter — a
nondeterministic pick once more than one source exists. `import-projections` hardcodes
`SCORING_PRESET_ID = "ppr"`, so without this every league would see PPR numbers.

### Phase 4 — league-scoring normalization
Score the stored stat components per league's rules, so the same player projects differently in PPR vs
standard vs TE-premium vs superflex vs IDP. This is the payoff for owning the engine, and it lands
almost free once Phase 2 stores components rather than a scalar.

---

## Acceptance

- `af_projection_snapshots` non-empty for the current NFL season, advancing daily.
- Player Command Center shows a real projection with a visible source label.
- `replacementOptions` returns ranked bench and free-agent candidates in a live league.
- IDP positions produce projections (both live test leagues are IDP dynasty).
- A zero-row ingest run returns `ok: false` and is visible on the health chip.
- Unresolved-ID rate reported per ingest run and under an agreed threshold.
