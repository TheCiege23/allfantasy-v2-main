# Known Gaps — TheSportsDB

**Append here instead of probing.** Status: `UNVERIFIED` · `PROBE_PENDING` · `RESOLVED` · `WONTFIX`

---

## Resolved by empirical probe — do NOT re-test these

Recorded so nobody rediscovers them. All probed 2026-08-16 on a working free key, against real NFL
events, with a soccer control proving the endpoint and key were functional.

| ID | Finding | Evidence |
|---|---|---|
| `R-01` | `lookupeventstats` returns **null for NFL** | Events 2475349, 2261187 → `{"eventstats":null}`. Soccer event 1032723 → 5 rows. |
| `R-02` | `lookuptimeline` returns **null for NFL** | Same two events → `{"timeline":null}`. Vocabulary is soccer-only (`Goal`, `subst`). |
| `R-03` | `lookuplineup` returns **null for NFL** | Same two events → `{"lineup":null}`. |
| `R-04` | `lookupplayerstats` **works for NFL** | Jalen Hurts (34201502): 2024 passing 2903 yd / 18 TD, rushing 630 yd / 14 TD. |
| `R-05` | NFL `idLeague` = **4391** | Verified live. |
| `R-06` | NCAAF `idLeague` = **4479**, `strLeague` = **"NCAA Division 1"** | `?l=NCAA Football` → `{"teams":null}`. |
| `R-07` | v1 returns **HTTP 200 on errors** | Invalid league → `200` + `{"events":[],"Message":"Invalid League ID passed"}`. |
| `R-08` | Free tier **silently truncates lists** | US American-football league search returned 5 leagues, omitting NFL and NCAA D1. No indicator. |
| `R-09` | `searchteams.php` free tier is **"Arsenal" only** | Vendor documents this explicitly. |
| `R-10` | Quarter scores exist only as an **HTML string** in `strResult` | `"Quarter 1:<br>7 7 <br>Quarter 2<br>14 13 <br>..."` |
| `R-11` | v1 livescore endpoints are **premium-gated** | Free key: `latestamericanfootball.php` → `[null]`; `latestncaafootball.php` → empty body. |
| `R-12` | Two CDN hosts in the **same response** | NFL event: `strHomeTeamBadge` on `www.`, `strAwayTeamBadge` on `r2.` |
| `R-13` | The published **MCP spec is unusable** | 7-line Postman CLI scaffold. No transport, no tool defs, no `package.json`, `tools/` not published. |
| `R-14` | 🛑 **`lookup_all_teams.php` DOES NOT EXIST** — it 404s with an HTML error page | Probed 2026-08-17 on a **paid** key: `?id=4391` → HTTP 404 + HTML. The working endpoint is **`search_all_teams.php?l=<strLeague>`** → NFL 32 teams, `NCAA Division 1` 260 teams. Note it keys off `strLeague`, **not** the numeric `idLeague`. Fixtures: `v1.search_all_teams.NFL.json`, `v1.search_all_teams.NCAAF.json`. This endpoint was listed in `ENDPOINTS.yaml` and called working by `G-08` — both were wrong. |
| `R-15` | `latestamericanfootball.php` / `latestncaafootball.php` **404 on a PAID key**, not just the free key | Probed 2026-08-17: both → HTTP 404 + HTML. `R-11` recorded free-key behaviour (`[null]` / empty body) and inferred premium gating; on a paid key they 404 outright, so these v1 paths look **retired**, not gated. Use `/livescore/4391` (v2) per `G-01`. |
| `R-16` | Paid key confirmed — **no list truncation** | `all_leagues.php` → 1527 leagues. `R-08` saw the free key silently truncate a league list to 5 rows. A full-length list is the cheap tell for which tier a key is on. Fixture: `v1.all_leagues.json`. |
| `R-17` | `lookupplayerstats.php` returns **multi-season** rows, not one aggregate | Jalen Hurts (34201502) → **34 rows** under `.playerstats`. `R-04` established it works; the row count shows it spans seasons, so a parser taking `[0]` silently reads one arbitrary season. Fixture: `v1.lookupplayerstats.NFL.json`. |

**Fixtures are now populated** (`fixtures/`, 14 captured 2026-08-17). Every fixture is
`{ "_probe": {...}, "response": <raw body> }` — `response` is the verbatim vendor payload and is
the shape authority; `_probe` carries `captured_at`, `season_phase`, `http_status`, `returned_null`
and the redacted URL, so a null can never again be mistaken for an off-season artifact.

⚠️ Captured during **preseason** (2026-08-17). `R-01`/`R-02`/`R-03` nulls were re-confirmed in this
window, which is consistent with the earlier in-season probes — they are real absences, not seasonal.
Event-level and livescore shapes should still be re-captured once the regular season starts.

⚠️ `probe.sh` requires `jq` and writes a **bare** body; `probe.mjs` (Node, no dependencies) writes the
`_probe`-wrapped form above. The two tools currently disagree on fixture format. `probe.mjs` is the
one that produced everything in `fixtures/`.

---

## Blocking — resolve before shipping the dependent feature

| ID | Gap | Status | Blocks | How to resolve |
|---|---|---|---|---|
| `G-01` | Exact slug for `/livescore/{sport}` for American football | UNVERIFIED | nothing | **Use `/livescore/4391` instead** — documented, unambiguous. Slug is probably `American_Football` per their `Ice_Hockey` convention. |
| `G-02` | Does NFL livescore actually populate during games? | UNVERIFIED | livescore fallback | Documented with NFL as the worked example, but the static `livescore_all.json` sample has **zero** American Football rows (May 2025 offseason snapshot — weak evidence). **Probe during a live NFL game with a paid key.** |
| `G-03` | Artwork licensing — is displaying non-CC player headshots commercially defensible? | **RESOLVED 2026-08-18** | nothing | **CLEARED BY THE OWNER'S COUNSEL.** Player headshots may be displayed. Do NOT re-raise this, and do NOT build a `display_allowed` gate — `schema.sql` is a design document, and no such column exists in Prisma or the database. See the note below. |
| `G-04` | `lookupplayerstats` position coverage | PARTIAL | player profiles | QB returned passing + rushing. Untested: receiving (WR/TE), defensive (IDP), kicking. Probe one player per position. |

## Non-blocking

| ID | Gap | Status | Notes |
|---|---|---|---|
| `G-05` | Annual / Lifetime pricing | UNVERIFIED | Behind a toggle on `/pricing`. Monthly is $0 / $9 / $20. |
| `G-06` | v2 error response shape | UNVERIFIED | Docs say "standard HTTP response codes" — untested. v1 definitely returns 200-on-error. |
| `G-07` | Are `/filter/events/*` and `/list/seasonposters/*` real? | UNVERIFIED | Appear on `/free_sports_api` but not `/documentation` or the YAML. |
| `G-08` | `eventsround.php`, `searchloves.php` limits | UNDOCUMENTED | No published free/premium limits. ~~`lookup_all_teams.php`~~ removed from this row: it does not exist at all — see `R-14`. This row previously asserted it "works", which was never verified. |
| `G-09` | `searchvenues.php` param name — `v` or `t`? | CONFLICTING | `/documentation` and YAML say `v`; `/free_sports_api` example uses `?t=Wembley`. Try `v` first. |
| `G-10` | Does `/preview` (200px) image suffix exist? | CONFLICTING | Only on `/free_sports_api`. `/documentation` lists medium/small/tiny only. **Use medium/small/tiny.** |
| `G-11` | Real rate limits | CONFLICTING | `/documentation`: 30/100/120 per minute. `/free_sports_api`: 100/min. v2 YAML: "1000 per day". Using `/documentation` — it matches `/pricing`. |
| `G-12` | `strStat` enum for non-soccer sports | UNVERIFIED | 18 observed values are all soccer. No enum in the spec — data-driven. Likely moot given `R-01`. |
| `G-13` | Whether `intScore` / `intScoreVotes` are user votes or match data | UNVERIFIED | Naming suggests a community rating, not scoring. Don't use for anything. |

---

## WONTFIX — vendor doesn't have it. Do not probe.

| Missing | Confirmed by |
|---|---|
| NFL/NCAAF box scores (first downs, total yards, possession) | `R-01` — empirical |
| NFL/NCAAF play-by-play | No such endpoint exists in v1 or v2 |
| NFL/NCAAF drive data | No such endpoint |
| NFL/NCAAF timelines (TD/FG/safety events) | `R-02` — empirical, soccer vocabulary only |
| NFL/NCAAF lineups / starters | `R-03` — empirical |
| **Weekly / per-game player stat lines** | `lookupplayerstats` is season aggregates only (`R-04`) |
| Injuries — any sport | No injury endpoint in v1 or v2 |
| Depth charts — any sport | No endpoint |
| Per-play highlight clips | `eventshighlights` is game-level only |
| Push / webhooks / streaming livescore | 2-minute batch snapshot only |
| League tables for non-soccer | `lookuptable.php`: "Limited to featured soccer leagues ONLY" |
| Projections / odds | Not a product they offer |
| A usable MCP server | `R-13` |

**The consolidated conclusion:** this source cannot score fantasy football. That is settled, tested,
and not worth re-checking. Rolling Insights `/live` is the scoring source; CollegeFootballData covers
NCAAF play-by-play; nflverse covers history.

---

## Probe protocol

1. Run `scripts/probe.sh <version> <endpoint> [args...]`
2. Commit the response to `fixtures/v<n>.<endpoint>[.<qualifier>].json`
3. Insert/update `tsdb.contract_probe_log` — **including nulls.** A recorded null is what stops the
   next agent from re-probing.
4. Update `ENDPOINTS.yaml` with discovered fields; raise `confidence`
5. Move the row here to `RESOLVED` or `WONTFIX` with the evidence
6. **Commit all of it together.** An uncommitted probe gets repeated.

**Probe NFL endpoints during the season.** Offseason probes return nulls that are indistinguishable
from unsupported endpoints — which is the exact ambiguity that causes the re-probing loop in the
first place. When you do probe off-season, record *that it was off-season* in `notes`.

---

## G-03 — artwork licensing, resolved

**2026-08-18: the owner's lawyer cleared displaying player headshots.** That is the
authority this gap was waiting on. Treat it as settled.

Two things a future session should not do:

- **Do not build a `display_allowed` gate.** The column appears in
  `contracts/thesportsdb/schema.sql`, which is a DESIGN DOCUMENT — there is no
  `tsdb` schema in Prisma, no migration, and `PlayerImage` carries no licence or
  display flag. Nothing in the running system has ever gated on it. Adding one
  now would block images the owner has been advised are fine to show.
- **Do not re-open this on reading the vendor's "most are fan created" line.**
  That wording is in `ENDPOINTS.yaml` and it is what prompted the original
  question. It has been considered and cleared.

### Still outstanding, and separate

⚠ **Attribution is a contractual term of the paid tier, not a licensing
question, and it is NOT satisfied by the legal clearance above.** The terms
require *"Data provided by TheSportsDB"* plus a link back wherever their data or
artwork appears. That obligation stands on its own and still needs a credit line
somewhere in the product.

⚠ **Modification of team badges and league logos remains forbidden** by the same
terms — display unmodified only. That is a trademark constraint on marks the
vendor does not own, and counsel clearing *player headshots* does not speak to
it.
