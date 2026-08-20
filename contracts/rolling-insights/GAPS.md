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
| `G-08` | In `game_id` = `YYYYMMDD-{n}-{n}`, is the first number **home or away**? | UNVERIFIED | One weak sample suggests `{home}-{away}`. **Do not codify on one sample.** Cross-check 3+ games against a known schedule. |
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
