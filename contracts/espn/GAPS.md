# ESPN — Known gaps

Append here instead of probing. Status: `UNVERIFIED · PROBE_PENDING · RESOLVED · WONTFIX`.

## Resolved by probe, 2026-10-01 — do NOT re-test

| ID | Finding | Evidence |
|---|---|---|
| `R-01` | NCAAB `teams?limit=1000` returns **all 362** Division I teams, season `2026-27` | `fixtures/teams.NCAAB.json` (trimmed; count recorded in `ENDPOINTS.yaml`) |
| `R-02` | ESPN NCAAB team ids are the **same id space as CFBD** | Akron `2006`, Air Force `2005` in both. CFBD sources ids from ESPN (`lib/sport-teams/collegeTeamIdentity.ts:27`). Gives ~250 football schools an independent cross-check when mapping schools. |
| `R-03` | `teams/{id}/roster` with no params returns the **current** season (`2026-27`, `Preseason`) | All three roster fixtures |
| `R-04` | NCAAB `athletes` is a **flat array**, not grouped by position | All three roster fixtures |
| `R-05` | `headshot` is **omitted**, not null, when ESPN has no photo; the derived CDN URL then **404s** | 40/49 athletes carry it; all 40 load; all 9 without it 404 at `.../mens-college-basketball/players/full/{id}.png`. So the field is authoritative — no point constructing URLs for athletes that lack it. |
| `R-06` | `jersey` is a **string** | `"5"`, `"55"`. `SportsPlayer.number` is an int. |

## Measured against our data, 2026-10-01 (read-only, no provider calls)

| ID | Finding |
|---|---|
| `M-01` | 🛑 **Rolling Insights NCAAB `status: ACT` does NOT mean "on the current roster".** Duke has 38 RI `ACT` rows; 33 are not on ESPN's 2026-27 roster, including players who left years ago (Vernon Carey Jr., Cassius Stanley, Javin DeLaurier). Belmont: 28 ACT, 18 absent. New Haven (D1 since 2025): 21 ACT, 1 absent. Any "current NCAAB players" count taken from RI `ACT` is inflated by former players. |
| `M-02` | **RI has not loaded 2026-27 newcomers.** 14 of ESPN's 49 athletes (freshmen and transfers) have no RI row on that team. Drew Scharnowski is Duke #8 on ESPN and still Belmont #11 in RI. Whether RI's NCAAB season is simply not published yet is NOT probed — see `contracts/rolling-insights/`, do not probe it from here. |
| `M-03` | **Name + jersey match is clean on the same team.** 35 of 49 ESPN athletes match exactly one RI row on (same school, normalized name, jersey); **0** matched on name with a different jersey. |
| `M-04` | **Photo yield:** 33 of the 35 matched (94%) have an ESPN headshot; newcomers 7 of 14 (50%) — ESPN adds freshman photos during the season, as it does for college football (`lib/devy/devyHeadshotRefresh.ts`). |

## Open

| ID | Question | Status |
|---|---|---|
| `E-01` | Does a mid-season roster call reflect in-season transfers/walk-ons, and how quickly? | UNVERIFIED — re-probe one team in January, once |
| `E-02` | Does `roster` accept a `season` param for past seasons? (Would let former players' photos be captured.) | UNVERIFIED — not needed for phase 2 |
| `E-03` | Does the teams list ever include non-D1 or inactive programs? | UNVERIFIED — 362/362 were `isActive` on 2026-10-01 |
| `E-04` | Rate limits. ESPN documents none. A full roster sweep is 362 requests. | UNVERIFIED — spread the sweep across cron ticks; do not burst |
| `E-05` | Image rights for hotlinking ESPN headshots. Precedent exists (college football devy headshots already use this CDN), but TheSportsDB's contract restricts headshots to CC-licensed images. | **RESOLVED 2026-10-01 — owner decision:** use them for NCAAB on the same basis as college football. |
| `E-06` | Scope of phase 2 given `M-02` (current players with no RI row). | **RESOLVED 2026-10-01 — owner decision:** photos only for ESPN athletes that match an existing RI row (same school, name + jersey). No ESPN-sourced player rows; newcomers fill in if RI later loads them. |

## Probe protocol

1. Only via `scripts/probe.sh`, only for a new endpoint/sport combination.
2. Trim large bodies with `contracts/fleaflicker/scripts/trim-fixture.mjs` (it refuses to lose a key path); record any counts from the FULL body in `ENDPOINTS.yaml` first.
3. Fixture + `ENDPOINTS.yaml` + this file, **in one commit**.
4. A 403 is recorded here and work stops. No spoofed headers.
