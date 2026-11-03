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
| `E-06` | Scope of ESPN roster use given `M-02` (current players with no RI row). | **Updated 2026-10-30:** owner confirmed permission to investigate and use ESPN rosters for college eligibility. The earlier photos-only scope is superseded; roster snapshots retain unmatched athletes, but do not themselves create draftable players or enable scoring. |
| `E-07` | College basketball game and player box scores for fantasy scoring. | **Updated 2026-10-30:** owner confirmed permission to use ESPN box scores. One final-game summary and its daily scoreboard returned HTTP 200; a 403 must still stop the ingest pass. Scoring integration, schedule coverage, rate limits, and historical transfer handling remain to be verified. |

**NCAAB contract captures, 2026-10-31:** `summary.NCAAB.event401825532.json` and
`scoreboard.NCAAB.20260221.json` were captured using `scripts/probe.sh` and trimmed with the
standard key-union tool. Their original counts are in `ENDPOINTS.yaml`. The trim retained all
key paths but dropped array values needed to prove both teams, all stat labels, and complete
box-score parsing. The scoreboard capture does not prove daily-slate completeness either.
E-07 remains open for those semantic checks; do not infer that a zero-event day is complete.

College postseason schedule evidence (2026-10-30): the committed Rolling Insights 2025-26
`schedule-season.NCAABB.json` contains 394 postseason games, including the NCAA title game
on April 6; the existing schedule parser and sync preserve those rows. The cached 2026-27
schedule currently ends March 7. Future tournament brackets have not yet been established by
that cached range. A week beyond the published range must remain unfinalized until evidence
covers it; neither an empty scoreboard nor the previous season proves a future slate is complete.

## Probe protocol

1. Only via `scripts/probe.sh`, only for a new endpoint/sport combination.
2. Trim large bodies with `contracts/fleaflicker/scripts/trim-fixture.mjs` (it refuses to lose a key path); record any counts from the FULL body in `ENDPOINTS.yaml` first.
3. Fixture + `ENDPOINTS.yaml` + this file, **in one commit**.
4. A 403 is recorded here and work stops. No spoofed headers.

## MLB fantasy import, 2026-10-03

- RESOLVED: new fantasy-league/MLB endpoint captured via probe.sh, public league 13262, 2026; see ENDPOINTS.yaml. Do not re-probe.
- AUTH_LEAGUE_NOT_VISIBLE: initial candidate 1189924578 returned HTTP 401 without cookies. No authorization bypass attempted.
- UNVERIFIED: private connected-account league response. Synthetic cookie tests are not a live private-provider verification.
- UNVERIFIED: MLB communication/activity endpoint and earlier-season response variants. Import reports unavailable coverage and never uses the NFL endpoint for MLB.
- OPEN: custom category and roster pitching-limit fidelity. Native conversion must reject unrepresentable rules while retaining the source archive.

## NFL game summary, 2026-10-25

- RESOLVED: `summary?event=401873011` (PIT at NO, final) captured via probe.sh, committed untrimmed; counts in ENDPOINTS.yaml. Do not re-probe for shape.
- `S-01` FOUND BY THE FIXTURE: a play erased by a penalty keeps its original wording ("field goal is GOOD, NULLIFIED by Penalty … - No Play") under type `Penalty`. `footballPlayKind` read it as a made field goal and sent a scoring alert; fixed in the same commit, pinned by `__tests__/engagement-alerts/espn-nfl-summary-fixture.test.ts`.
- UNVERIFIED: an IN-PROGRESS summary (`drives.current`, `situation`, live `winprobability`). This capture is a final. Capture one live game, once, the next time a probe is justified.
- UNVERIFIED: college football (`football/college-football`) summaries — not probed.

## NFL postseason scoreboard, 2026-11-01

- RESOLVED: `scoreboard?dates=` for 20260110, 20260117, 20260125 and 20260208 (one day each of the 2025 Wild Card, Divisional, Conference and Super Bowl rounds), captured via probe.sh for NFL playoff bracket pools. Do not re-probe for shape.
- `P-01` FOUND BY THE FIXTURES: **the scoreboard carries no playoff seed.** `curatedRank.current` is 99 for every team. Seeds are read from the standings cache (`NFL:standings:<season>:*`, `position`) by `resolvePlayoffSeedField`; a scoreboard game is only accepted into a bracket slot when its two teams are the two the seeded field puts there.
- `P-02` UNVERIFIED: whether `/apis/v2/sports/football/nfl/standings` reports `playoffSeed` per CONFERENCE (1-16) and which group name it files teams under. `lib/standings/espnStandings.ts` writes `position = playoffSeed ?? rank`, so a missing `playoffSeed` would silently become a rank. The NFL seed reader accepts a field only when each conference has exactly seeds 1-7 with no duplicate, and the scoreboard cross-check above refuses any Wild Card game the field does not predict. Settle with one standings capture after week 18, before the first pool seeds.
- `P-03` UNVERIFIED: `seasontype=3&week=N` as a query instead of `dates`. Not needed; the writer scans dates.

## Fantasy activity (trades), 2026-10-27 — recorded without probing

- `T-01` UNVERIFIED: the shape of `view=kona_league_communication`, the feed
  `EspnLeagueFetchService` reads for transactions. It is not in `ENDPOINTS.yaml` and has no
  fixture. Production code already parses it (`parseEspnTransactions`).
- `T-02` SUSPECTED DEFECT, from reading the code: each trade message becomes its own
  transaction, keyed on that message's id. A multi-player ESPN trade is therefore stored as
  several one-player "trades" in `LeagueTrade`, not as one trade with two sides. The messages
  appear to share a topic id, which is probably the key to group them on. Confirm it against a
  capture before changing the parser.
- Blocks the collusion check for imported ESPN leagues
  (docs/integrity/IMPORTED_LEAGUE_INTEGRITY.md). **Needed:** one capture of a league with a
  completed multi-player trade, via `scripts/probe.sh`, from a league the owner chooses (cookies
  if private), committed with the grouping fix.

## NFL fantasy lineup slots, 2026-10-30 — recorded without probing

- `L-01` UNVERIFIED: ESPN lineup slot `24` (`EDR`, `ESPN_SLOT_LABELS` in
  `lib/league-import/espn/EspnLeagueFetchService.ts`) — which positions it accepts, and whether it is
  an IDP slot at all. No NFL fantasy-league fixture is committed, so nothing in the repo shows a
  league that uses it. It is therefore NOT counted as an IDP signal (`lib/league-import/idpRosterSlots.ts`)
  and not mapped in `lib/league/importedLineupTemplate.ts`. **Needed:** one capture of an NFL league
  with an EDR slot (its `rosterSettings.lineupSlotCounts`, as `EspnLeagueFetchService` reads it, plus a roster using it), via `scripts/probe.sh`.
- `L-02` INFERRED, not captured: slot `15` (`DP`) is the defensive-player flex — it is the last slot of
  ESPN's defensive block (8 DT · 9 DE · 10 LB · 11 DL · 12 CB · 13 S · 14 DB · 15 DP) and
  `lib/lineup-actions/sleeperSlotUtils.ts` already treats `DP` as IDP. It now counts as an IDP signal on
  import. A capture of a league using it would confirm which positions it accepts.
# NBA Cup scoreboard verification — 2026-10-31

Resolved: the four `scoreboard.NBA.*.json` fixtures capture Group Play (9 games),
quarterfinals (2), semifinals (2), and championship (1). The final's label is
`NBA Cup Championship`, without the hyphen used by the other stages. Results,
real teams, dates and venue fields are verified; tournament seeds are not.
The six-week date-range request returned HTTP 400. Runtime uses individual days.
The alternate NBA CDN `scheduleLeagueV2.json` returned HTTP 403 through its probe;
no spoofed headers or bypass retry was attempted. It is not a runtime source.
