# TheSportsDB API Contract — READ THIS FIRST

## What this source is for — and what it is NOT for

> ### 🎯 ROLE: metadata, media, schedules, and TV listings.
> ### 🚫 NOT a live-stat or box-score source.

TheSportsDB is genuinely good at things Rolling Insights doesn't give you — team badges, player
headshots, league logos, venue detail, TV broadcast listings, and YouTube highlight links. Use it
for **enrichment**.

It cannot drive fantasy scoring. This was tested empirically, not assumed:

| Endpoint | NFL result | Verdict |
|---|---|---|
| `lookupeventstats` | `{"eventstats":null}` on every NFL event probed | ❌ soccer-only |
| `lookuptimeline` | `{"timeline":null}` | ❌ soccer-only |
| `lookuplineup` | `{"lineup":null}` | ❌ returns null |
| `lookupplayerstats` | ✅ real data — but **season aggregates only** | ⚠️ no weekly/per-game |
| `livescore` | documented for NFL, **2-minute batch refresh** | ⚠️ scores only, no player stats |

A soccer control event returned 5 rows of real stats from the same endpoint on the same key — so the
endpoint and key work fine. The data simply isn't there for American football.

**Division of labour in this system:**

| Need | Source |
|---|---|
| Live player box stats, game-day scoring | **Rolling Insights** |
| Play-by-play (NFL/NBA/MLB) | **Rolling Insights** |
| NCAAF play-by-play | **CollegeFootballData** |
| Historical stats, 1999+ | **nflverse** |
| Badges, headshots, logos, venue art | **TheSportsDB** ← this contract |
| TV broadcast listings | **TheSportsDB** ← unique to this source |
| YouTube highlight links | **TheSportsDB** ← unique to this source |
| Schedules (redundant backup) | TheSportsDB |

---

## 🛑 Rule for all agents and developers

> **Never call TheSportsDB API to find out what an endpoint returns.**
>
> The endpoint surface is in `ENDPOINTS.yaml`. Real captured responses go in `fixtures/`.
> Unknowns go in `GAPS.md`. Probe only via `scripts/probe.sh`, only for a *new* endpoint,
> and commit the fixture in the same change.

### Add to root `CLAUDE.md`

```markdown
## TheSportsDB API

Contract: `contracts/thesportsdb/`. Do not probe to determine response shape.

- Role is METADATA + MEDIA + TV + HIGHLIGHT LINKS only. It is NOT a live-stat source.
  Never build fantasy scoring on it — `event_stats`, `timeline`, and `lineup` all
  return null for NFL. Use Rolling Insights for live stats.
- NFL idLeague = 4391. NCAA Football idLeague = 4479 (named "NCAA Division 1").
- v1 returns HTTP 200 on errors, with a `Message` key. Empty results are `null`, not `[]`.
- API key is a URL path segment in v1 — redact it in all logs.
- Free tier forbids publishing to an app store. Paid tier requires attribution.
```

---

## The eight facts that break naive implementations

1. **NCAA Football's `strLeague` is `"NCAA Division 1"`, not "NCAA Football."** Searching by the
   obvious name returns `{"teams":null}`. Use `idLeague = 4479`.
2. **v1 returns HTTP 200 on errors.** An invalid league gives
   `{"events":[],"Message":"Invalid League ID passed"}` — status 200, capital `M`. Never treat
   200 as success without inspecting the body.
3. **Empty results are `null`, not `[]`** — `{"eventstats":null}`, `{"teams":null}`. But the error
   case above uses `[]`. Your deserializer must tolerate both.
4. **The free tier silently truncates lists with no indicator.** A US American-football league
   search returned 5 alphabetically-first leagues and *silently omitted NFL and NCAA Division 1*.
   This is exactly how you'd conclude NFL isn't covered when it is.
5. **`searchteams.php` on the free key only works for "Arsenal."** Literally that one string.
6. **Two image CDN hosts appear in the same response** — `r2.thesportsdb.com` and
   `www.thesportsdb.com`. Normalize at ingestion.
7. **Quarter-by-quarter NFL scores exist only as an HTML string** inside `strResult`:
   `"...Quarter 1:<br>7 7 <br>Quarter 2<br>14 13 <br>..."`. No per-quarter integer fields.
   Parse defensively or skip.
8. **Field-name casing is inconsistent across objects** — `idAPIfootball` almost everywhere, but
   `idApiFootball` in the event-statistics object. Both spellings are live in the same API.

---

## ⚠️ The artwork licensing risk — the biggest issue with this source

TheSportsDB's terms, verbatim:

> "Most of our artwork is custom and is created by our users, you must not pass it off as your own
> and should link back to our website where appropriate... Any trademarked sports logos must be
> used 'As is' and should not be modifed in any way. You can check the 'strCreativeCommons' tag on
> player artwork to make sure its CC licensed."

**TheSportsDB cannot grant you rights it does not hold.** Their terms *acknowledge* that logos are
trademarked — that's a use restriction, not a license. Player headshots are user-uploaded with no
provenance guarantee. Their remedy model is reactive DMCA-within-24-hours, which pushes downstream
risk onto you.

**Practical policy encoded in this contract:**

- ✅ Team badges / league logos: display **unmodified**, no implication of endorsement.
- ⚠️ Player headshots: **only where `strCreativeCommons == "Yes"`.** That field exists on player
  objects only — there is no equivalent signal for badges, logos, or event art.
- ❌ Never modify, recolor, crop, or composite a trademarked logo.
- ❌ Never re-host without attribution and a link back.

`schema.sql` enforces this: `media_asset.cc_licensed` and a `display_allowed` column, so the
decision is made once at ingestion rather than scattered through UI code.

**I am not a lawyer. This is a flag, not clearance.** Get counsel before shipping player
headshots commercially.

---

## Commercial use

| Tier | Price | Commercial | Rate limit |
|---|---|---|---|
| Free | $0 | ❌ **"You cannot publish apps to an appstore unless you are a paid subscriber."** | 30/min |
| Single Developer | $9/mo | ✅ with attribution | 100/min |
| Small Business | $20/mo | ✅ with attribution, private API key | 120/min |

Attribution is mandatory on paid tiers: *"must mention us as the source of the data."*
Reselling the API is prohibited without permission. Caching and modifying **data** is explicitly
allowed; scraping the **website** (as opposed to the API) is prohibited.

$20/mo is the top self-serve tier — there is no enterprise tier. Premium is delivered via Patreon
or PayPal and requires both a TheSportsDB account and a linked Patreon supporter status.

---

## Provenance and caveats

Derived from `/documentation`, `/pricing`, `/docs_terms_of_use.php`, `/docs_api_data`,
`/docs_artwork`, `/free_sports_api`, the v1/v2 OpenAPI YAMLs, and **live API probes** on 2026-08-16.

⚠️ **`/documentation` is the authoritative source, not the OpenAPI YAML.** The YAMLs are
incomplete and partly stale:
- v1 YAML contains **no** rate-limit or free/premium tier data at all.
- v1 YAML omits `lookupplayerstats.php`, `playerresults.php`, `searchfilename.php`.
- v2 YAML declares tags for Filter/All/Schedule/Livescore but defines **no paths** for them.
- v2 YAML `info.description` claims "1000 requests per day for free users" — contradicts the
  documented per-minute limits and contradicts v2 being premium-only. Stale boilerplate.

**Do not codegen a client from the YAML alone.** Use `ENDPOINTS.yaml` in this directory.

⚠️ **The published MCP "spec" is not a usable MCP server.** `/api/spec/v1/MCP/index.js` and v2 are
a 7-line Postman-generated CLI scaffold — no server transport, no tool definitions, no
`package.json`, and the `tools/` directory it globs isn't published. If you want MCP access,
generate it yourself from their Postman collections.
