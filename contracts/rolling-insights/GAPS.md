# Known Gaps — append here instead of probing

**Purpose:** record what we don't know so nobody re-probes the API to rediscover it.

**Status values:** `UNVERIFIED` (never probed) · `PROBE_PENDING` (queued for next capture) · `RESOLVED` (fixture committed) · `WONTFIX` (vendor doesn't have it)

> **Updated 2026-08-16** after (a) vendor Q&A on Discord and (b) extraction of the new
> pre-release OpenAPI spec at `docs.datafeeds.rolling-insights.com`.
> See `VENDOR-QA.md` for the full exchange. Several gaps below are now RESOLVED.

---

## ✅ RESOLVED 2026-08-16 — do not re-probe or re-ask

| ID | Was | Resolution | Source |
|---|---|---|---|
| `G-01`..`G-04` | Field names for NHL / NCAAFB / NCAABB / SOCCER live | **Available in the new OpenAPI spec.** 84 paths fully typed. Extract per sport as needed rather than probing. | new spec |
| `G-06` | `/injuries` field list | **RESOLVED — five flat fields only:** `player`, `player_id`, `injury`, `date_injured`, `returns`. Envelope `data.NFL[] → {team, team_id, injuries[]}`. | new spec |
| `G-09` | Does `RS-DATA-TYPE` header exist? | **Not in the new spec.** No custom response headers documented anywhere. **Do not depend on it.** | new spec |
| `G-11` | Does `/play-by-play` 404 for NHL/NCAAFB? | **Confirmed: PBP is MLB/NBA/NFL only** in the new docs. Not a client-side guard — the endpoints don't exist. `WONTFIX`. | new spec |
| `G-12` | Live latency quantified? | Still unquantified, but **webhooks exist** (see `N-01`) which makes polling latency moot. | vendor |
| — | Is `full_box.current` populated live? | **YES.** Vendor: populated while live, `null` once complete. **The all-null payload observed was a final-state payload — expected behaviour, not a bug.** | vendor |
| — | Is PBP a separate paid package? | **NO — included with the Live Feed tier.** Removes a cost line. | vendor |
| — | Practice participation (DNP/Limited/Full)? | **❌ DOES NOT EXIST.** Spec search: `practice` = 41 hits, all "Best practices" prose. `participation`/`DNP`/`Limited` = 0. No day-of-week fields. Parse NFL.com reports instead. `WONTFIX`. | new spec |
| — | Injury update speed vs beat reporters? | **Much slower — twice a day.** Daily each morning + ~T-1h per game. Official team reports only, explicitly no reporter tweets. **Revise polling from 35s down.** | vendor |
| — | Projections / rest-of-season? | **❌ NO.** On roadmap only. `WONTFIX` for planning. | vendor |
| — | ADP / trade / dynasty values? | **❌ NO.** Vendor leaves calculated values to customers. `WONTFIX`. | vendor |

---

## 🆕 NEW gaps opened 2026-08-16

| ID | Gap | Status | Blocks | Notes |
|---|---|---|---|---|
| `N-01` | **Webhook contract is entirely undocumented** | BLOCKING | webhook implementation | Vendor confirmed webhooks exist (support-ticket provisioned), but the new spec's `webhooks:` key is literally `{}` and "webhook" appears exactly once in 84 paths — that empty key. Need: payload schema, event types, **whether corrections fire webhooks**, HMAC scheme, retry policy, delivery guarantee, subscription granularity. **Do not build until this is in writing.** |
| `N-02` | **The 304 contradiction** | UNRESOLVED | nothing (we're safe either way) | Skill repo: *"Treat 304 as a cache problem, not a success."* New spec `NotModified` component: *"valid request with no new data to return (empty result set)"* — **opposite readings.** Also 304 is declared on only 14/84 operations, **all DARTS and PGA**; `/live/NFL` declares just `[200,401,403]`. Our cache-bust + hash-diff approach is correct under both readings, so this is a documentation question, not a blocker. |
| `N-03` | `/live` rate limit, and whether 304 counts against it | ASKED, NOT ANSWERED | nothing currently | New spec has zero occurrences of rate limit / 429 / throttle / quota, and declares no 429 on any operation. Follow up via support ticket. |
| `N-04` | `details.distance` semantics (play-by-play) | UNVERIFIED | nothing | Sample showed `0` on a play where `yardsToGo` was `10`. **Do not assume it equals yards-to-go.** |
| `N-05` | `players[].metadata.context` / `.eventType` / `.hasTeamPrefix` semantics | UNVERIFIED | nothing | Fields exist and are typed; prose descriptions not extracted. |
| `N-06` | Is `players[].role == 'fumbler'` the player who fumbled, or who forced it? | UNVERIFIED | IDP forced-fumble alerts | Ambiguous naming. Cross-check against `description` on a real play. |
| `N-07` | Is `sequence` safe as an incremental cursor? | UNVERIFIED | PBP delta fetching | **Non-contiguous** in samples (NFL 2, MLB 41, NBA 6). Spec doesn't state contiguity. Treat as high-water mark; re-read the full plays array each poll. |
| `N-08` | DK fantasy-points calculation breakdown | NOT EXTRACTED | nothing | Documented in the new docs under Player Stats / Team Stats. Moot — we score from raw stats. |
| `N-09` | `returns` field normalization | OPEN (our work) | injury display | Free-form prose, no enum: "Probable", "60-Day IL", "Questionable For Start Of Training Camp", "TBA". Needs our own normalization layer. |
| `N-10` | `date_injured` format varies by sport | OPEN (our work) | injury parsing | Not ISO and inconsistent: `"2026-1-29"` (NFL, unpadded), `"2026-04-15"` (MLB), `"Jul 20, 2026"` (SOCCER). |
| `N-11` | `player_id` type varies by sport | OPEN (our work) | joins | **STRING** for NFL/MLB/NBA/NHL, **INTEGER** for SOCCER. PBP `players[].id` is an **INTEGER** for NFL. Cast explicitly on every join. |
| `N-12` | GraphQL API | NOT MODELLED | nothing | New docs mention a separate GraphQL API — OAuth2 client-credentials, `Authorization: Bearer`, Apollo Sandbox at `datafeeds.rolling-insights.com/graphql`. Deliberately excluded from the OpenAPI spec. Only NFL and MLB per the older skill repo. Ignore unless REST becomes limiting. |

---

## Blocking — resolve before shipping that sport

| ID | Gap | Status | Blocks | How to resolve |
|---|---|---|---|---|
| `G-01` | Field names in `/live` for **NHL** | UNVERIFIED | NHL scoring | One probe during an NHL game → commit fixture |
| `G-02` | Field names in `/live` for **NCAAFB** | UNVERIFIED | CFB scoring | Probe on a Saturday → commit fixture |
| `G-03` | Field names in `/live` for **NCAABB** | UNVERIFIED | CBB scoring | Probe during a game → commit fixture |
| `G-04` | Field names in `/live` for **SOCCER** (all 3 leagues) | UNVERIFIED | Soccer scoring | Probe with `?league=EPL` during a match |
| `G-05` | `game_id` format for NHL / NCAAFB / NCAABB / SOCCER | UNVERIFIED | Per-game polling | Read `game_ID` off any `/schedule` response |
| `G-06` | **`/injuries` field list** for NFL beyond the 5 known keys | PARTIAL | Injury detail | Known: `player`, `player_id`, `injury`, `date_injured`, `returns`. Probe for more. |
| `G-07` | `/depth-charts` field list — **all sports** | UNVERIFIED | Depth-chart features | Probe NFL first |

## Non-blocking but worth resolving

| ID | Gap | Status | Notes |
|---|---|---|---|
| `G-08` | In `game_id` = `YYYYMMDD-{n}-{n}`, is the first number **home or away**? | ✅ **RESOLVED 2026-08-26 — it is `{away}-{home}`** | **The earlier guess was BACKWARDS.** 15 of 15 MLB games in `fixtures/live.MLB.json` are `{away_team_id}-{home_team_id}`, cross-checked against `full_box.home_team.team_id` / `full_box.away_team.team_id` in the same payload; ZERO matched `{home}-{away}`. Anything codified on the old "weak sample" renders every matchup reversed. Confirmed for MLB only — re-check per sport. |
| `G-09` | Does `RS-DATA-TYPE` response header actually exist? | CONTRADICTED | Notion docs mention it (`LIVE-DATA`, `INJURY-REPORTS`). The vendor's own skill repo documents **no** custom response headers. **Do not depend on it either way.** |
| `G-10` | Are NCAAFB/NCAABB injuries genuinely absent, or just undocumented? | UNVERIFIED | Vendor instructs agents not to call them — that's **policy, not a 404 guarantee**. Worth one probe before hard-coding unavailability. |
| `G-11` | Does `/play-by-play` really 404 for NHL/NCAAFB? | UNVERIFIED | Same reasoning as G-10. Vendor scripts hard-block it client-side, which tells us nothing about the server. |
| `G-12` | Actual observed live latency vs broadcast | UNVERIFIED | Vendor says "medium-latency", never quantified. **Measure during the 30-day trial.** Drives UX promises. |
| `G-13` | Payload size of a league-wide `/live` call on a full slate | UNVERIFIED | Determines whether league-wide polling beats per-game (see INTEGRATION.md §4). |
| `G-14` | 304 frequency under 35s cache-busted polling | UNVERIFIED | If busting works, should be ~0. Track via `v_feed_health.cache_304_last_hour`. |
| `G-15` | `season_type` / `status` enum values for non-NFL sports | UNVERIFIED | NFL enums are documented. Others assumed similar — verify. |
| `G-16` | Whether `/team-stats/{SPORT}` (season-less) works per sport | PARTIAL | Documented default only for PGA and DARTS. |

## Vendor doesn't have it — `WONTFIX`, do not probe

| Gap | Confirmed by |
|---|---|
| Play-by-play for NHL, NCAAFB, NCAABB, SOCCER, DARTS, PGA | Support matrix, 4 independent statements in skill repo |
| Injuries / depth charts for NCAAFB, NCAABB, SOCCER, DARTS, PGA | Support matrix |
| Player season stats for SOCCER | Support matrix |
| Team info / team stats for DARTS, PGA | Support matrix |
| Odds endpoints — any sport | Vendor FAQ: "Do you have Odds data? No" |
| Projection endpoints — any sport | Vendor FAQ: "We do not offer projection stats" |
| Bundesliga, Ligue 1, Champions League, MLS | 0 hits in Euro Soccer doc; pricing lists only EPL/LALIGA/SERIEA |
| Practice-participation grid (DNP/Limited/Full) | Injury payload has `returns` status only |
| A fantasy endpoint | Fantasy values are fields inside football payloads only |
| GraphQL for anything except NFL and MLB | Skill repo excludes GraphQL entirely |

---

## Probe protocol

When you genuinely need to resolve a gap:

1. Run `scripts/probe.sh <endpoint> <SPORT> [league]`
2. Commit the response to `fixtures/<endpoint>.<SPORT>[.<LEAGUE>].json`
3. Insert/update the row in `ri.contract_probe_log`
4. Update `ENDPOINTS.yaml` `fields:` with the discovered field list and raise its `confidence`
5. Move the row above to `RESOLVED` with the fixture path
6. **Commit all of it in one change.** A probe whose result isn't committed will be repeated.

**Probe on a game day.** Off-day probes return empty arrays and teach you nothing about payload shape — that ambiguity is the original source of the re-probing loop.


---

## ✅ ANSWERED 2026-08-18 — `N-03` rate limit

**Vendor answer, relayed by the account owner: as many calls as necessary.** No
quota, no throttle.

⚠ PROVENANCE. This is a verbal answer from Rolling Insights relayed through the
account owner, NOT a line in the OpenAPI spec — that spec still declares no 429 on
any operation and contains zero occurrences of "rate limit". Authoritative for
planning; UNVERIFIED in writing. If a 429 ever appears in production this note is
why nobody expected it, and it should go back to the vendor rather than being
silently backed off.

**What it unblocks:** the §4 polling plan in INTEGRATION.md at full rate — `/live`
and `/play-by-play` both at 35s while a game is in progress. That plan's
call-volume estimate (~14,000 on a 13-game Sunday, ~85% of it per-game
play-by-play) carried "confirm during the trial". Confirmed.

**What it does NOT change:** `/injuries` still moves to hourly. That was never a
quota decision — the feed is collected twice a day, so polling it faster buys
nothing no matter how many calls are permitted.

---

## 📏 MEASURED 2026-08-27 — `N-02` RESOLVED IN PRACTICE: **304 can mean NOT SUBSCRIBED**

### The controlled result

**This deployment holds TWO Rolling Insights accounts with DISJOINT sport coverage.** Same URL,
same headers, same millisecond buster, retried once — the ONLY variable is which `RSC_token` is
sent. `team-info/{SPORT}`, measured directly:

| credential | NFL | MLB | NBA | NHL | NCAABB | NCAAFB | SOCCER (EPL·LALIGA·SERIEA) |
|---|---|---|---|---|---|---|---|
| `ROLLING_INSIGHTS_RSC_TOKEN`  | **200** | 304 | 304 | 304 | 304 | 304 | 304 |
| `ROLLING_INSIGHTS_RSC_TOKEN2` | 304 | **200** | **200** | **200** | **200** | **200** | **200** |

That is a proper control, not an inference. **A 304 from this vendor can mean "this account is not
subscribed to this sport"** — a third reading neither the skill repo ("cache artifact to defeat")
nor the OpenAPI spec ("valid request, empty result set") documents.

### There is also a LEGITIMATE 304, and it looks identical

On the entitled account, `player-stats/{season}/{SPORT}`:

| | 2026 | 2025 |
|---|---|---|
| MLB | 200 | 200 |
| NBA | **304** | 200 |
| NHL | **304** | 200 |

NBA and NHL 2026 had not tipped off in August. So 304 there means *not yet started*. **Three
distinct causes, one status code, no way to tell them apart from the response alone.**

### The rule that survives all three

1. Send no-cache headers + a fresh millisecond buster. Retry once. (kills the cache reading)
2. Still 304 → **try the other credential**. (kills the entitlement reading)
3. Still 304 → treat as UNCHANGED and fall back to the prior season. (handles not-yet-started)
4. **Never** write an emptiness on a 304, at any stage.

Implemented in `lib/workers/providers/rollingInsightsRest.ts` (`riCredentialsFor` + the two nested
escalations in `riFetch`). Normal cost is one request — the sport's own account is tried first.

### ⚠ The trap that cost real time here

The first reader took **the first token present and stopped**. `ROLLING_INSIGHTS_RSC_TOKEN` is
set, so `..._TOKEN2` was NEVER tried and all six sports on the second account 304'd forever — while
the pipeline reported itself healthy, because refusing to write on a 304 is correct behaviour. It
was honest about the wrong cause.

Compounding it: the non-NFL rows already in `SportsPlayer` are real, carry real RI player ids, and
are 15 hours to 119 days old. They read as proof of entitlement and are not.

### Still worth asking the vendor (do not probe)

*Should an unentitled sport return 401/403 rather than 304?* A 403 would be unambiguous and would
let a client report "not subscribed" instead of "unchanged". Until then, credential fallback is the
only way to tell them apart.

---

## ✅ CAPTURED 2026-08-26 — `/live` for **MLB** (`fixtures/live.MLB.json`)

15 completed games, via `scripts/probe.sh live MLB "" 2026-08-26`. Envelope `data.MLB`.

### The one thing worth reading twice

**The player box hangs off the GAME ROOT, not the team shell.**

```
game.player_box.{away_team|home_team}.{batting|pitching}.<PLAYER_ID> = { player, POS, AB, H, … }
```

Our first parser was written from the NBA hint in `rollingInsightsFieldMaps`
(`playerBox: 'player_box'`, listed under the team shell) and looked for
`full_box.<side>_team.player_box`. It found **zero games on a slate of fifteen**, while the
provider returned HTTP 200 with no error — so nothing failed, the pipeline just wrote nothing.

Three separate mistakes, all invisible:
1. `player_box` is a SIBLING of `full_box`, not a child of the team node.
2. The innermost level is an OBJECT KEYED BY PLAYER ID, not an array.
3. The entry carries **no `player_id` field at all** — the key IS the identifier. A parser
   requiring `player_id` drops every line even after it finds them.

⚠ **The batting/pitching FIELD names were already correct** in
`ROLLING_INSIGHTS_FIELD_MAPS.MLB`. What was missing was the SHELL PATH. A field map without a
shell path cannot parse a payload, and having one is easy to mistake for having both.

### Now pinned

`__tests__/sports-data/rolling-insights-game-logs.test.ts` asserts the parser against this
fixture, including "finds a game at all" — the exact silent failure above.

### Still unverified: `/live` for NBA, NHL, NCAABB, NCAAFB, SOCCER

`G-01`..`G-04` stay open. Those seasons were out of session on 2026-08-26, so probing then would
have captured an empty slate and taught nothing — which is the re-probing trap this file exists to
prevent. **Probe each on a game day for that sport.** The parser accepts both the id-keyed object
form and an array form until each has its own fixture; do not narrow it to the MLB shape.

---

## 📏 MEASURED 2026-08-28 — `/live/{date}` is keyed on the **US EASTERN** date

**A UTC date blinds the live feed every game night.** `buildRestPathCandidates` in
`lib/workers/providers/rolling-insights.ts` built the path from
`new Date().toISOString()`. Between **00:00Z and 04:00Z** — 8pm to midnight Eastern — that is
TOMORROW in the vendor's terms, and it answers:

    404 {"error":"Bad Request",
         "message":"You cannot request live data for future dates as there are no live games yet."}

That window is NFL primetime and the entire evening college slate. The endpoint this contract
calls PRIMARY for game day was dark exactly when games are played, every night, and the failure
was indistinguishable from a vendor outage.

Controlled, one variable, same token, same headers, same buster:

| path | result |
|---|---|
| `/live/2026-08-28/NFL` (UTC today) | 404 future-dates |
| `/live/2026-08-27/NFL` (Eastern today) | **200** — Steelers at Bills, `game_status: "1:50 2nd 4th & 10"` |

Fixed by formatting the date in `America/New_York`, with the previous Eastern day kept as a
fallback CANDIDATE — a late west-coast game runs past Eastern midnight and after the rollover
belongs to yesterday's date.

⚠ **The cache-buster was ruled out before the date was blamed.** Removing `_` left the 404
unchanged, so this is not the buster and not `304_conflict`.

## ✅ ANSWERS the open vendor question above — **`/live` DOES disambiguate entitlement**

The `N-02` section asks: *"Should an unentitled sport return 401/403 rather than 304?"* On
`team-info` it does not. **On `/live/{date}/{SPORT}` it does**, with an explicit message:

    404 "You are not signed up for the sport you are requesting."

Measured 2026-08-28 on a PAST date, both credentials, disjoint exactly as the `N-02` table says:

| | `RSC_TOKEN` | `RSC_TOKEN2` |
|---|---|---|
| `/live/2026-08-27/NFL` | **200** (live game) | 404 not-signed-up |
| `/live/2026-08-27/NCAAFB` | 404 not-signed-up | **304** (entitled; empty) |

**So `/live` is the cheapest unambiguous entitlement probe this vendor offers** — a 404 with that
message is a definite "no", where a 304 anywhere else could be cache, entitlement, or no-data.

⚠ **ORDER OF CHECKS: the future-date check fires BEFORE the entitlement check.** Probing a FUTURE
date returns the date message and hides entitlement entirely. Always probe a PAST date when the
question is "are we subscribed".

🛑 **A CORRECTION, RECORDED SO NOBODY REPEATS IT.** This session first concluded "the RI
subscription does not include college football" — from a probe that hard-coded
`ROLLING_INSIGHTS_RSC_TOKEN` and stopped. That is exactly the trap `N-02` already documents
("the first reader took the first token present and stopped"). **NCAAFB IS entitled, on
`RSC_TOKEN2`.** A single-credential probe cannot answer an entitlement question on this
deployment — `riCredentialsFor` exists for this reason, and any ad-hoc probe must iterate
credentials the same way.

---

## `age` on the player payload is a DATE, not an age — inferred, not documented

**Status: UNRESOLVED in the contract. Inferred from production data, never probed.**
`ENDPOINTS.yaml` does not describe the player object's `age` field.

`lib/sports-data/rollingInsightsTeamsPlayers` stored it with a generic `intOf`, which does
`parseInt(s.replace(/[^0-9-]/g, ''))` — it strips every separator and keeps the digits. Measured
on production 2026-08-28, **all 13,763 RI rows carrying an age held an impossible value** (9,550
NFL, 4,213 SOCCER; 0.0% impossible for Sleeper, 0.6% for TheSportsDB). Nothing rejected them
because `291996` is a perfectly good integer.

The shape is unmistakable once seen:

| stored | reads as |
|---|---|
| `291996` | `2/9/1996` |
| `41988` | `4/…/1988` |
| `312001` | `3/1/2001` |

**The year is recoverable; the day and month are not.** Separator positions are gone and the
components are variable-width, so `41988` is `4/19/88` or `4/1/988` or `4/1988` with no way to
choose. Validated by taking the last four digits as a birth year and comparing against Sleeper's
own age across 3,091 known-good pairs: **93.9% land within one year**, in a bimodal 0/1 split,
which is exactly what a correct birth year looks like depending on whether the birthday has passed.

⚠ **`dob` was arriving and being thrown away.** The ingest writes `dob` from
`p.dob ?? p.birth_date ?? p.date_of_birth`; those keys are populated on **5 of 9,563** NFL rows.
The vendor puts the date in `age`, so the full date reached us every sync and `intOf` destroyed it
before anything could store it. The ingest now salvages `dob` from `age` when it parses as a date,
so rows ingested from now on carry an exact birth date and a later backfill can compute an exact
age. Rows already in the table can only ever be ±1 year.

**What is still unknown, and what would settle it:** whether the field is documented anywhere,
whether the format is stable across sports (NFL and SOCCER both show it; the other sports have no
ages at all), and whether the vendor also exposes a real `birth_date` on an endpoint we do not
call. Per the repo rule this was NOT probed — resolving it needs `scripts/probe.sh` on a new
endpoint/sport pair with the fixture committed in the same change, or an answer from the vendor.
