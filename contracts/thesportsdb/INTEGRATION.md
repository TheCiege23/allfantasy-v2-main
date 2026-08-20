# TheSportsDB Integration Map

**Companion to:** `ENDPOINTS.yaml` (normative) · `schema.sql` (DDL) · `README.md` (role + no-probe rule) · `GAPS.md`

---

## 1. Where this fits

You now have four data sources with clean, non-overlapping jobs. Keeping them separated is what
prevents the "which source do I call for X" question that drives re-probing.

```
┌─ ROLLING INSIGHTS ────────────────────────────────────────┐
│  Live player box stats · PBP (MLB/NBA/NFL) · injuries      │
│  35s game-day cadence.  THE scoring source.               │
└───────────────────────────────────────────────────────────┘
┌─ COLLEGEFOOTBALLDATA ─────────────────────────────────────┐
│  NCAAF play-by-play. Fills the Rolling Insights CFB gap.  │
└───────────────────────────────────────────────────────────┘
┌─ NFLVERSE ────────────────────────────────────────────────┐
│  Historical stats 1999+ · schedules · coaches. Free.      │
└───────────────────────────────────────────────────────────┘
┌─ THESPORTSDB  ← this contract ────────────────────────────┐
│  Badges · headshots · logos · venue art                   │
│  TV broadcast listings          ← unique                  │
│  YouTube highlight links        ← unique                  │
│  Season-level player stats      ← convenience             │
│  Livescore                      ← 2-min batch, fallback   │
│  Slow cadence. Enrichment only. NEVER scores.             │
└───────────────────────────────────────────────────────────┘
```

**The rule that keeps this clean:** nothing in schema `tsdb` may ever feed a fantasy point total.
`tsdb.livescore` exists as a cross-check and a degraded fallback, not as a scoring input.

---

## 2. Why I'm scoping it this narrowly

I tested rather than assumed. On a working free key, against two real NFL events:

```
lookupeventstats.php?id=2261187   →  {"eventstats":null}    (Eagles/Cowboys, 2025 Wk 1)
lookuptimeline.php?id=2261187     →  {"timeline":null}
lookuplineup.php?id=2261187       →  {"lineup":null}

lookupeventstats.php?id=1032723   →  5 rows of real data     (soccer control)
```

The control proves the key and endpoint work. The American-football data simply isn't there. Their
event-statistics vocabulary is entirely soccer — *Shots on Goal, Corner Kicks, Ball Possession,
expected_goals* — and the timeline vocabulary is *Goal* and *subst*. There is no touchdown, field
goal, safety, or two-point-conversion event type, and no down/drive/quarter structure.

**What does work for NFL:** schedules, event objects with final scores, team and player metadata,
artwork, TV listings, YouTube highlight links, and `lookupplayerstats` — which returns real numbers
(verified: Jalen Hurts 2024 — 2,903 passing yards, 18 passing TDs, 630 rushing yards) but **only as
season aggregates.** No weekly lines. That's a useful player-profile feature, not a scoring feed.

---

## 3. Request construction — five things that will bite you

```python
V1 = "https://www.thesportsdb.com/api/v1/json"
V2 = "https://www.thesportsdb.com/api/v2/json"

# ── 1. v1 puts the API KEY IN THE URL PATH. Redact it everywhere. ──────────
def v1(endpoint: str, **params):
    key = os.environ["THESPORTSDB_API_KEY"]
    url = f"{V1}/{key}/{endpoint}"
    redacted = f"{V1}/***REDACTED***/{endpoint}"   # log THIS, never url
    return url, params, redacted

# ── 2. Prefer v2 — header auth, and the only version still being developed. ─
def v2(path: str):
    return f"{V2}{path}", {"X-API-KEY": os.environ["THESPORTSDB_API_KEY"]}

# ── 3. v1 RETURNS HTTP 200 ON ERRORS. Never trust the status code alone. ────
def parse_v1(resp) -> tuple[list, str | None]:
    body = resp.json()
    if msg := body.get("Message"):        # note the CAPITAL M
        return [], msg                     # e.g. "Invalid League ID passed"
    # ── 4. Empty results are `null`, not `[]`. Except errors, which use `[]`. ──
    for key in ("events", "teams", "player", "players", "eventstats",
                "timeline", "lineup", "livescore"):
        if key in body:
            return (body[key] or []), None
    return [], "unrecognized envelope"
```

**5. The free tier lies by omission.** `search_all_leagues.php?c=United_States&s=American Football`
on the free key returned five alphabetically-first leagues and *silently omitted both NFL and NCAA
Division 1*. No truncation indicator, no warning. That is precisely how you'd conclude this source
doesn't cover NFL when it does.

**Corollary:** never use the free tier for *discovery*. Hard-code the league IDs you need
(`ENDPOINTS.yaml → league_ids`) and verify on a paid key.

### The NCAA naming trap

```python
# ❌ returns {"teams": null}
search_all_teams.php?l=NCAA Football

# ✅
search_all_teams.php?l=NCAA Division 1     # or better: id_league = 4479
```

`strLeague` for NCAA football is **`"NCAA Division 1"`**. The `strFilename` prefix is
`"NCAA Division 1 Football"`. Always key off `idLeague = 4479`.

---

## 4. ⚠️ Artwork — the one thing here that carries real risk

This is the highest-risk item in this integration, and it's worth being precise about why.

TheSportsDB grants you permission to *use their CDN*. It cannot grant rights it doesn't hold. Their
own terms concede the point:

> "Most of our artwork is custom and is created by our users... **Any trademarked sports logos must
> be used 'As is' and should not be modifed in any way.** You can check the `strCreativeCommons` tag
> on player artwork to make sure its CC licensed."

Read carefully, that's a *use restriction*, not a license. And their remedy model is reactive —
DMCA compliance within 24 hours — which means takedown after a claim, with the downstream
consequences landing on you.

**The policy is enforced in the database, not in UI code.** `media_asset` has a trigger that sets
`display_allowed` at ingestion:

| Asset | Rights | Displayable | Modifiable |
|---|---|---|---|
| Team badge / logo | `TRADEMARK_ASIS` | ✅ unmodified only | ❌ never |
| League badge / logo | `TRADEMARK_ASIS` | ✅ unmodified only | ❌ never |
| Player art, `strCreativeCommons == "Yes"` | `CC_LICENSED` | ✅ | ⚠️ per CC terms |
| Player art, otherwise | `UNKNOWN` | ❌ | ❌ |
| Event / venue art | `UNKNOWN` | ❌ | ❌ |

**UI code reads `v_team_media` and `v_player_media` — never `media_asset` directly.** One decision
point, made at ingestion, impossible to bypass by accident.

Note the asymmetry that makes this awkward: `strCreativeCommons` exists **only on player objects**.
There is no license signal at all for badges, logos, event art, or venue art. That's why everything
without a signal defaults to `false`.

Badges displayed unmodified, without implying endorsement, are a defensible nominative-fair-use
posture. **Non-CC player headshots are the actual exposure.** I'm not a lawyer — this is a flag to
take to one, not clearance.

---

## 5. Livescore — useful as a fallback, not a feed

Documented for NFL (their `docs_api_data` uses NFL as the worked example, with `idLeague: 4391`),
and both paid tiers advertise "2 min livescore (Soccer, NFL, NBA, MLB, NHL)".

**But it's a 2-minute batch snapshot, not a push.** In their static sample, *every row shared an
identical `updated` timestamp* — the whole feed is regenerated on a timer. Consequences:

- Poll `/livescore/4391` (by league ID, not sport slug) every **120s**. Faster is wasted work.
- Poll the `updated` field to detect staleness rather than trusting the interval.
- No webhooks, no streaming, and **no player stats** — team scores and game progress only.
- Cannot support play-level or drive-level alerts. Rolling Insights is the source for those.

**Use `/livescore/{idLeague}` rather than `/livescore/{sport}`.** The sport slug for American
football is unverified (probably `American_Football`, following their `Ice_Hockey` convention), and
the league-ID form is documented and unambiguous.

One counter-signal worth knowing: their static `livescore_all.json` sample contains Ice Hockey,
Basketball, Baseball, and Soccer rows — **zero American Football.** It's a May 2025 offseason
snapshot, so weak evidence, but confirm during an actual NFL game before relying on it. Logged as
`G-02` in `GAPS.md`.

---

## 6. The two things here you can't get anywhere else

**TV broadcast listings.** `eventstv.php` / `/filter/tv/*` — filterable by date, country, sport,
channel. Genuinely useful ("your WR1 is on CBS at 4:25") and no other source in this stack has it.

**YouTube highlight links.** `eventshighlights.php` returns YouTube URLs per event, and every event
object carries `strVideo`.

This connects directly to the highlights problem from the live-gameday spec. The conclusion there
was that **YouTube embeds of official channels are the only route with an appellate license
holding** — YouTube's terms grant each user a license covering embeds, and the 2d Circuit relied on
exactly that in *Richardson v. Townsquare Media* (April 2026) to dismiss an embedded-YouTube claim
while reviving an embedded-X-post claim in the same opinion.

So this endpoint is a legitimate discovery mechanism for that path. Constraints still apply in full:

- ✅ Game-level highlights only — **not per-play.** Your "20+ yard play" feature can't be served by this.
- Verify `status.embeddable` via the YouTube Data API before rendering a player.
- YouTube Developer Policies: no paywalling the embedded player, no overlays in front of it, no
  clipping or trimming, no ads on the player, minimum 200×200px.
- Vendor warns some videos are geo-locked and they have no control over that.

---

## 7. Cadence

Almost none of this is game-day work, which is the point.

| Job | Interval |
|---|---|
| `livescore/{idLeague}` | 120s (game days only) |
| `eventsday` | hourly on game days, else daily |
| `eventshighlights` | hourly for ~6h post-game, then stop |
| `eventsseason` | daily |
| `eventstv` | daily |
| `lookupplayerstats` | weekly |
| `lookup_all_players`, `search_all_teams` | weekly |
| `lookupteam`, `lookupleague`, `lookupvenue` | monthly |

At 100 rpm (Single Developer, $9/mo) this is nowhere near the cap. **Rate limiting is not a
constraint for this source** — its value is breadth of metadata, not freshness. $9/mo is likely
sufficient; $20/mo buys a private key and unlimited returned rows, which matters mainly for bulk
player/team backfills.

---

## 8. Build order

| Phase | Scope |
|---|---|
| 0 | Paid tier (**required for commercial** — free forbids app-store publishing). Add attribution to the UI. |
| 1 | `schema.sql`. API-key redaction in logging. `parse_v1` error handling (200-on-error, null-vs-empty). |
| 2 | Reference backfill: leagues → teams → players → venues for NFL (4391) + NCAAF (4479). |
| 3 | `media_asset` ingestion with the rights trigger. Wire UI to `v_team_media` / `v_player_media` only. |
| 4 | Schedule + event ingestion. TV listings. |
| 5 | Highlight-link ingestion + `status.embeddable` check before rendering. |
| 6 | Season player stats (player-profile pages, clearly labeled season totals). |
| 7 | `livescore` as a cross-check against Rolling Insights + degraded fallback. |

**Phase 3 before any UI work.** If media rights aren't gated at ingestion, they'll leak into the app
and you'll be auditing image URLs across the codebase later.

---

## 9. Open items

1. **Paid tier is required before any commercial use.** Free tier verbatim: *"You cannot publish
   apps to an appstore unless you are a paid subscriber."*
2. **Attribution is mandatory** on paid tiers: *"must mention us as the source of the data."* Put it
   in the UI, not just a credits page.
3. **NFL livescore population unverified** — documented, but the sample snapshot had zero American
   football rows. Confirm during a live NFL game (`G-02`).
4. **Player-stat position coverage unverified** — a QB returned passing and rushing lines; whether
   receiving and defensive stats are populated is untested (`G-04`).
5. **Artwork licensing needs counsel** before shipping non-CC player headshots.
6. OpenAPI YAMLs are incomplete and partly stale — **do not codegen from them.** Use
   `ENDPOINTS.yaml`.
7. The published MCP "spec" is a broken Postman scaffold. Generate your own from their Postman
   collections if you want MCP access.

I'm not a lawyer; items 1, 2, and 5 are flags for counsel, not advice.
