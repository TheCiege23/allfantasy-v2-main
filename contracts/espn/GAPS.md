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

## Resolved by probe, 2026-11-19 — NBA, NHL and MLB team lists, do NOT re-test

| ID | Finding | Evidence |
|---|---|---|
| `R-07` | `teams?limit=1000` returns every club: NBA **30**, NHL **32**, MLB **30**, all `isActive`, none `isAllStar` | `fixtures/teams.{NBA,NHL,MLB}.json`, committed untrimmed; counts in `ENDPOINTS.yaml` `teams.measured_2026_11_19` |
| `R-08` | The list is current: NHL has **Utah Mammoth** (`UTAH`) and no Arizona; MLB has **Athletics** (`ATH`, no city) and no Oakland | Same fixtures. `lib/sport-teams/SportTeamMetadataRegistry.ts` listed NHL `ARI` and MLB `OAK` until 2026-11-19; it now builds its NBA, MLB and NHL lists from these captures (via `lib/league/copyLeagueTeamTables.ts`), keeping the codes providers send (`CWS`), and `__tests__/sport-teams/team-registry-current.test.ts` pins it |
| `R-09` | Each team's default 500px crest is `teamlogos/<sport>/500/<abbreviation lower-case>.png`; the White Sox are `CHW`/`chw.png` (Rolling Insights and the registry say `CWS`) | `logos[]` with `rel` `default`, for all 92 teams. Crests from this CDN were already in use for every sport's team logo; no new image-rights question (compare `E-05`, which is about player headshots) |
| `R-10` | NFL `teams?limit=1000` returns all **32** clubs; Washington is `WSH`/`wsh.png`, and `lib/sport-teams/SportTeamMetadataRegistry.ts` built `was.png`. Both files load from the CDN (checked 2026-11-19), so nothing was broken; the key is now `wsh` to match the capture | `fixtures/teams.NFL.json`, committed untrimmed; `__tests__/league/copy-league-team-tables.test.ts` checks every NFL crest the app builds against it |
| `R-11` | Every team in the four captures has a dark-background crest, `rel` `["full","dark"]`, at the default crest's path with `/500/` → `/500-dark/` | `fixtures/teams.{NFL,NBA,NHL,MLB}.json`; `darkCrestUrl` in `lib/league/copyLeague.ts` |

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
| `E-08` | Current-team player headshots for NBA, NHL and MLB. TheSportsDB's cutouts are not updated after a trade (Darius Garland, traded CLE → LAC, still shows a Cavaliers jersey), and no fresher source is stored: `sports_core_player_images` for NBA is 100% TheSportsDB, and `PlayerIdentityMap` has 0 ESPN ids for NBA/NHL/MLB (measured 2026-11-27). | **RESOLVED 2026-11-27 — owner decision** ("Add ESPN photos"): use ESPN roster headshots for NBA, NHL and MLB on the same basis as `E-05`, TheSportsDB kept as the fallback. Rosters captured: `fixtures/roster.{NBA.team12,NHL.team13,MLB.team10}.json`. |
| `E-07` | College basketball game and player box scores for fantasy scoring. | **Updated 2026-10-30:** owner confirmed permission to use ESPN box scores. One final-game summary and its daily scoreboard returned HTTP 200; a 403 must still stop the ingest pass. Scoring integration, schedule coverage, rate limits, and historical transfer handling remain to be verified. |

**NCAAB contract captures, 2026-10-31:** `summary.NCAAB.event401825532.json` and
`scoreboard.NCAAB.20260221.json` were captured using `scripts/probe.sh` and trimmed with the
standard key-union tool. Their original counts are in `ENDPOINTS.yaml`. The trim retained all
key paths but dropped array values needed to prove both teams, all stat labels, and complete
box-score parsing. The scoreboard capture does not prove daily-slate completeness either.
E-07 remains open for those semantic checks; do not infer that a zero-event day is complete.

**Owner-authorized recapture, 2026-11-03:** the same scoreboard and summary were captured again via
`probe.sh` after the owner explicitly approved the exception to the no-repeat rule. Full arrays are
retained. The scoreboard contains 148 events and the target game; the final summary has two teams
and 29 player rows. Parsed playing-player points sum to 94 and 95, matching the official team
scores. This resolves the missing-array evidence for this historical game, not provider-wide or
future/postseason schedule completeness. `__tests__/c2c/espn-captured-campus-scoring.test.ts`
checks both production parsers and the current campus points scorer against the retained responses.
The NCAAB engine's seven default categories omit double-double/triple-double bonuses even though
a separate scoring-preset catalog lists them; any rule change requires reconciling those settings
and historical scoring rather than assuming a bonus in this verification.

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

## NFL fantasy league capture, 2026-11-08

Owner-chosen public league, 10 teams, week 9 of 14, read without cookies; redacted and trimmed into
`fixtures/fantasy-league.NFL.2026.json` (see `fantasy_nfl` in ENDPOINTS.yaml). Do not re-probe for shape.

- `R-01` FOUND BY THE FIXTURE, FIXED: every team imported with rank 0. `rankCalculatedFinal` is 0
  until the season ends and `??` took it; the next fallback was `currentProjectedRank`, a projection.
  Rank now reads a positive final rank, else `playoffSeed`. Pinned by `__tests__/league-import/espn-nfl-fixture.test.ts`.
- `U-01` FOUND BY THE FIXTURE, FIXED: every unplayed week imported as a 0–0 TIE (`winner: UNDECIDED`
  carries `totalPoints: 0`; the bootstrap derives 'T' from equal points). Undecided matchups now import
  their pairing with no points. The live-scoring path is unchanged. Pinned by the same test.
- `M-01` RECORDED: without cookies `members[]` carries no names, so owner names fall back to team names.
- `D-01` FIXED WITHOUT A PROBE: a draft pick carries only `playerId`; the 17 of 160 drafted players since
  dropped have no name or position in this response. The importer now fills them without calling ESPN
  (`lib/league-import/espn/espnPlayerDirectoryFill.ts`): the 4 team defenses from the id itself
  (`-16000 - proTeamId`), the rest from `PlayerIdentityMap.espnId` (NFL, unambiguous ids only). Measured
  2026-11-08 on production: 13 of those 13 ids resolve, but only 928 of 9,567 NFL identity rows carry an
  `espnId`, so a league drafting deeper players can still leave some unnamed.
- `T-01` UPDATED: `kona_league_communication` answers **401 `AUTH_COMMUNICATION_NOT_VISIBLE` without
  cookies even for a public league**. Its shape is still uncaptured.
- `T-02` STILL OPEN: this league has no trade (`transactionCounter.trades` 0 for every team, and
  `mTransactions2` returned 8 recent roster moves only). Needs a league with a completed multi-player trade,
  read with cookies.
- `K-01` OPEN: keepers — `keeperCount` is 0 here, so keeper fields are unverified.
- `L-01` STILL OPEN: slot 24 (EDR) has count 0 here.
- `L-03` OPEN: IDP `defaultPositionId`s have never been seen. Unknown ids now import as N/A and are
  logged once per import with counts and no names (`[espn-import] unmapped defaultPositionId(s): …`),
  so the first real IDP import names the ids to add to `ESPN_POSITION_LABELS`.

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

## Weekly starters for Lineup Integrity, 2026-11-09 — recorded without probing

- `S-01` OPEN, AND WORKED AROUND RATHER THAN PROBED: no request in this repo asks ESPN for a PAST week's
  lineup. `fetchEspnLeagueJson` sends no query, so neither `scoringPeriodId` nor `matchupPeriodId` is ever
  set, and `rosterForMatchupPeriod` appears in `fixtures/fantasy-league.NFL.2026.json` only on the CURRENT
  week's schedule sides. Whether `view=mMatchupScore&scoringPeriodId=N` returns week N's lineup for a past
  N is unverified. The owner declined the probe on 2026-11-09, so nothing calls it.
- What runs instead (`lib/integrity/espnLineupSnapshots.ts`, rules in `espnStartersCapture.ts`): ESPN locks a
  player's slot at his kickoff, so the synced `Roster.playerData.starters` from any fetch AFTER that kickoff,
  inside the week, is the slot he was played in. Each player is frozen from the first such fetch. No ESPN call.
  The fetch time is the earlier of `Roster.updatedAt` (advanced on every successful read, changed or not)
  and `League.lastSyncedAt`.
  - Measured on production 2026-11-09, read-only: 10 ESPN NFL leagues, 120 rosters, median roster age
    8 minutes, and 114 of 120 rosters re-read inside the week-9 game window. So the capture has data to work from.
  - It records nothing while the ESPN sync is off (`FANTASY_OS_EXEC_SYNC_LIVE`). A week with a player who
    had a game but was never read after kickoff is reported incomplete and must not be scored.
  - A player on bye has no lock; he keeps the last in-week read.
  - It cannot recover weeks played before it ran. That needs `S-01` resolved.
- `S-02` FOUND WHILE BUILDING IT, NOT FIXED HERE: several `SportsGame` sources store NFL preseason games with
  `seasonType` null and reused week numbers. In 2026 those are `espn` week 2 (Aug 13–16) and `espn_live`
  weeks 3–4 (Aug 21–29). `buildWeekKickoffMap` (lib/redraft/lineupLock.ts) does not filter on season type,
  so for those regular-season week numbers a team's "earliest kickoff that week" is an August preseason
  game. The ESPN writer reads `seasonType: 'regular'` rows only for this reason.


## Team-defense (D/ST) scoring, 2026-11-17 — resolved from committed fixtures and season stats, no probe

- `D-02` RESOLVED, FIXTURE ONLY: every NFL team-defense scoring rule is `points: 0` with its real weight in
  `pointsOverrides["16"]` (lineup slot 16 = D/ST). Measured in `fixtures/fantasy-league.NFL.2026.json`: 27 of
  46 `scoringItems` carry an override, every override is keyed `"16"`, and wherever an item has both a non-zero
  `points` and an override (93, 101–104, 206, 209) the two are equal. The importer read `points` only, so every
  imported ESPN league stored its D/ST rules as 0. It now reads the slot-16 override when `points` is 0.
- `D-03` RESOLVED, NO ESPN PROBE: ESPN D/ST stat ids → Sleeper keys, derived by the hand-run
  `scripts/compare-espn-sleeper-stat-ids.mjs` (its season-total ESPN read predates this note; Sleeper's
  public weekly DEF stats supplied per-game points allowed). Proof is the `teamDefense` section of
  `lib/scoring-defaults/espn-stat-id-evidence.json`; the mapping is in `ScoringKeyAliasResolver.ts`.
  `S-01` (past-week ESPN lineups) is NOT touched by this and stays declined.
  - Points-allowed bucket edges were SEARCHED against Sleeper's per-game points allowed, not recalled:
    0 | 1–6 | 7–13 | 14–17 | 18–21 | 22–27 | 28–34 | 35–45 | 46+.
  - Fumble recoveries (96) = Sleeper `fum_rec` + `def_st_fum_rec`; return TDs score as sums at equal weight.
  - ⚠ A shutout has NO `pts_allow` key in Sleeper's weekly rows (zeros are omitted). Reading only rows that
    carry the key dropped exactly the 10 shutouts of 2024–25 and failed the 0-points bucket for no real reason.


## Knockout / total-points league with no schedule, 2026-11-20 — recorded without probing

- `KO-01` OPEN, ASK BEFORE PROBING: an ESPN NFL league in a knockout (guillotine) format has no weekly
  scores stored, so its Guilly tab has nothing to show. Measured on production, read-only: the league
  syncs daily (`syncStatus: synced`, 18 rosters of 15 players), and its matchup sync state
  (`SportsDataCache` key `external_matchup_sync:espn:<leagueId>:2026`) reads `status: synced,
  weeksWritten: 0, weeksUnchanged: 0, soloRowsWritten: 0` in NFL week 11. Per the note on that counter in
  `lib/import-os/collector/externalMatchupParity.ts`, all three at zero means ESPN served NO schedule
  entries for this league, paired or solo; unpaired entries would have landed as solo rows. It is the
  only one of 10 in-season ESPN leagues with no `WeeklyMatchup` rows.
  - What is not known: where ESPN carries each team's points per week for a league with no schedule
    (a standings or team view, or per-period team totals), and that view's shape.
    `fixtures/fantasy-league.NFL.2026.json` is a head-to-head league and cannot answer it.
  - Not probed. Resolving it needs a capture of this league format through `scripts/probe.sh`, committed
    as a fixture in the same change, and the owner's go-ahead.

## Pending trade offers, 2026-11-23 — recorded without probing

- `T-03` WAS OPEN (captured 2026-11-27, below): no committed endpoint or fixture lists ESPN trade offers that are PROPOSED and not yet
  accepted, so the provider-offer ledger (`lib/provider-trades/providerTradeOfferLedger.ts`) and Chimmy's
  pending-trade block stay Sleeper-only for ESPN. `fantasy-league.NFL.2026.json`'s `mTransactions2` held 8
  executed roster moves and no trade. `kona_league_communication` answers 401 without cookies even for a
  public league (`T-01`). A pending offer is most likely visible only to the teams involved, which would
  mean the reading member's `espn_s2`/`SWID` cookies and one read per user, not one per league. That is
  unconfirmed.
- **Needed:** which view (or `mTransactions2` filter) returns pending offers and with whose cookies; then one
  capture via `scripts/probe.sh` from a league the owner chooses, with an offer open, redacted with
  `scripts/redact-fantasy.mjs`, committed with the ledger mapping. Not probed.
- `T-03` DECISION (owner, 2026-11-25) — **whose offers:** AllFantasy may read pending trade offers but
  must keep and show ONLY offers the signed-in user sent or received. An offer between two other teams
  is never shown to or kept for anyone else. The same ruling answers Yahoo (`contracts/yahoo/GAPS.md`)
  and Fleaflicker `G-07`'s "whose" question.
- `T-03` CAPTURE PATH BUILT 2026-11-25, AWAITING OWNER CAPTURE: the owner-only admin button
  (Admin → Data & reliability → Provider contract capture; `lib/league-import/espn/espnContractCapture.ts`)
  reads the owner's own league with his own stored cookies: `mTeam`+`mTransactions2` (contract-named) and
  ONE labelled candidate, `mPendingTransactions`, recording each request's HTTP status. The body is
  redacted server-side (`lib/admin/contractCapture/redactContractCapture.ts`, the TS sibling of
  `scripts/redact-fantasy.mjs`, same refuse-if-anything-survives rule) and downloaded; nothing is stored.
  Open until that file is reviewed and committed. ⚠ If it shows offers between two OTHER teams, that is a
  finding about ESPN's visibility — record it here and drop those entries before committing.
- `T-03` CAPTURED 2026-11-27 — `fixtures/fantasy-pending.NFL.2026.json` (owner's admin capture, redacted
  server-side, 29 synthetic values, 3 credential values verified absent; committed unmodified). Settled:
  - `view=mPendingTransactions` is a REAL view (no longer a candidate): HTTP 200 and a top-level
    `pendingTransactions` array, beside `draftDetail`/`status` only.
  - Request 1 (`mTeam`+`mTransactions2`) carries the same offer in `teams[].pendingTransactions` of BOTH
    teams involved (2 and 7, and no other team) and in the top-level `transactions` list as
    `type: 'TRADE_PROPOSAL', status: 'PENDING'`.
  - Offer: `{id (uuid), type, status, isPending, teamId (proposer team), memberId (proposer member),
    proposedDate ms, expirationDate ms, teamActions {"<teamId>": "ACCEPTED"}, scoringPeriodId, items[]}`;
    item `{type: 'TRADE' | 'DROP', playerId (ESPN id), fromTeamId, toTeamId, fromLineupSlotId,
    toLineupSlotId}`. A `DROP` has `toTeamId: 0`: the proposing side's conditional drop.
  - The real offer: team 7 gives 4360761 (Michael Wilson) to team 2, gets 4426515 (Puka Nacua), drops
    4432708 (Marvin Harrison Jr.); team 7 has accepted; expires 2026-11-28 22:43:50 UTC.
  - Wired: `lib/provider-trades/syncEspnTradeOffers.ts` (scheduled, cookies of the league's connected user
    only, writes `provider_trade_offers` with `provider: 'espn'`, a `drop` asset type and `expiresAt`).
- `T-03a` NOT OBSERVABLE: whether a member sees offers between two OTHER teams. The captured league had one
  pending offer (teams 7 and 2), and the capture records no owner team (`ownerTeam: null`), so it cannot say
  whether the reading account was a party to it. The owner rule stands regardless: the sweep keeps only
  offers the connected user's team sent or received, and its test plants a third-party offer to prove it.
- `T-03b` UNVERIFIED: whether ESPN omits `pendingTransactions` or sends `[]` when nothing is pending. Only a
  body that carries the array counts as a complete read (an absent offer is then retired as `vanished`);
  without it nothing is retired, and an offer still leaves "pending" at its stated `expirationDate`.
- `T-03c` UNVERIFIED: statuses other than `PENDING` (accepted, declined, cancelled, countered) and whether
  they ever appear in this list. Mapped to `unknown`, never guessed. A countered offer's shape is not known.
- `T-03d` NOT CAPTURED, READ-ONLY: accept, decline and counter. AllFantasy shows the offer and links to ESPN.

## Per-player weekly fantasy points, 2026-11-23 — recorded without probing

- `PS-01` WRITER BUILT 2026-11-24 (current week only). `lib/league-import/espn/espnPlayerWeekScores.ts` (pure
  parser + crosswalk step, tested against the week-11 fixture in `__tests__/league-import/espn-player-week-scores.test.ts`)
  and `espnPlayerWeekScoresWriter.ts` (crosswalk to the canonical Sleeper id via `crosswalkToSleeperIds` +
  `withTeamDefenseIds`, upsert, source `espn`). Hooked into `fetchEspnLeagueForImport` behind the opt-in
  `recordPlayerWeekScores`, which only the import pipeline passes — so the Fantasy OS collector's scheduled ESPN
  sync writes from the response it already reads; `mMatchupScore` was added to that request's view list (one view,
  no extra request). Fire and forget, count-only warnings; `ESPN_PLAYER_WEEK_SCORES=off` disables it.
  - Rows are keyed `espn:<platformLeagueId>`, NOT the bare id: they hold Sleeper ids, and readers that look a
    league's rows up by the ids its ESPN roster holds would otherwise match ESPN 12483 (Stafford) to Sleeper
    12483 (Bech). The bench ledger (`ledgerGrading.ts loadBenchRows`) joins the prefixed key; nothing else reads it.
  - My Team's bench check now records ESPN NFL calls (`benchLedgerWeek`).
  - STILL OPEN: past weeks (`S-01`, never requested) — a week is stored only if the sync read it while current,
    and only players whose game had started (`lineupLocked`) by the last in-week read; post-week stat
    corrections are not seen; a playoff matchup spanning two NFL weeks (`currentMatchupPeriod` !=
    `scoringPeriodId`) is skipped, because no capture shows which week its block describes. That the import's
    view list WITHOUT `scoringPeriodId` returns the block is shown by `fixtures/fantasy-league.NFL.2026.json`
    (same views plus more, no `scoringPeriodId`), not by a capture of the exact list.
- `PS-01` SHAPE RESOLVED 2026-11-24: `scripts/probe.sh fantasy-matchup NFL`
  captured week 11 of the owner-chosen public league, with his explicit approval, as
  `fixtures/fantasy-matchup.NFL.2026.week11.json` (see `fantasy_nfl_matchup` in ENDPOINTS.yaml). Do not
  re-probe for shape. Established from the full body: `rosterForCurrentScoringPeriod` carries EVERY
  rostered player with his real slot and own week points, bench included (36 of 70 bench entries scored);
  non-bench points sum exactly to the side's total on all 10 sides; `lineupLocked: false` means the game
  has not started (0 is not a score); `rosterForMatchupPeriod` reports slot 0 for everyone and must not
  be read for slots. Still open: a PAST week by `scoringPeriodId` (`S-01`), and post-week stat corrections.
  The text below is the original 2026-11-23 record.
- `PS-01` WAS OPEN: nothing in production reads an ESPN player's fantasy points for a week, so
  `league_player_weekly_scores` has no ESPN writer and the bench-check ledger
  (`lib/core-app/benchCheckLedger.ts`) does not record ESPN calls — they could never be graded.
  `EspnLeagueFetchService` requests `mMatchup`/`mScoreboard` but parses only team totals
  (`schedule[].home|away.totalPoints`); `parseEspnRosterEntries` reads ids, slots and names, no points.
  - What the committed fixture shows, and why it is not enough: `fixtures/fantasy-league.NFL.2026.json`
    carries `schedule[].home|away.rosterForMatchupPeriod` / `rosterForCurrentScoringPeriod`, each
    `{ appliedStatTotal, entries[] }` with a per-entry `playerPoolEntry.appliedStatTotal`, on the
    CURRENT week's sides only. In the trimmed capture (week 9, in progress, `winner: UNDECIDED`) one
    side keeps 3 entries, all in starting slots, and they sum to the side's `appliedStatTotal` (46.7).
    Not established: that a BENCH entry is present with its own week points (the bench check grades a
    benched player — no bench entry survived the trim); that the value is the league's own scoring for
    that matchup period rather than a single scoring period; and a PAST week's values (`S-01`, declined
    2026-11-09). `ENDPOINTS.yaml` documents none of these fields.
  - **Needed:** an untrimmed side of `rosterForMatchupPeriod` from a FINISHED week (bench included),
    captured via `scripts/probe.sh` from the owner-chosen public league, documented in `ENDPOINTS.yaml`,
    committed with the writer. A writer must store Sleeper ids (`crosswalkToSleeperIds` +
    `withTeamDefenseIds`), not ESPN ids: the ledger records the CANONICAL Sleeper id, and ESPN 12483
    (Matthew Stafford) is Sleeper 12483 (Jack Bech) — see `sleeperLookupId` — so an ESPN-keyed row could
    grade the wrong player. Not probed.
