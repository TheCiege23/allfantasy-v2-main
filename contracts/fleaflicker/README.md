# Fleaflicker API Contract — READ THIS FIRST

## Purpose: stop re-probing the API

This directory is the **single source of truth** for the Fleaflicker public JSON API, as used
by this codebase's import path (`lib/league-import/fleaflicker/`).

> ### 🛑 Rule for all agents and developers
>
> **Never call the Fleaflicker API to find out what an endpoint returns.**
>
> The endpoint surface is in `ENDPOINTS.yaml`. Real captured response bodies are in `fixtures/`.
> If the answer isn't in those two places, it is a **gap to be recorded** in `GAPS.md`, not a
> reason to probe live.
>
> Probing is allowed **only** via `scripts/probe.sh`, and only when adding a *new*
> endpoint/sport combination — and the result must be committed to `fixtures/` in the same
> change. An uncommitted probe gets repeated.

### Why this exists, and how this contract differs from the sports-data ones

`contracts/rolling-insights/` and `contracts/thesportsdb/` are **sports-data vendors** — they
answer "what happened in the NFL." Fleaflicker is a **fantasy platform** — one of the six
import providers (`contracts/rolling-insights/`, `contracts/thesportsdb/` cover the former;
Fleaflicker, and eventually MFL/Fantrax/ESPN/Yahoo, cover the latter). Its API answers "what did
this specific fantasy league's teams do." Same discipline applies for the same reason: probing
live to rediscover a shape is slow, and — because a scoreboard's content depends on whether the
league's games have started — produces genuinely different answers depending on when you probe,
which is exactly the ambiguity a committed fixture removes permanently.

**Unlike the two sports-data contracts, Fleaflicker's API requires no credential at all** — it
is public, unauthenticated JSON, confirmed by the existing code
(`lib/league-import/fleaflicker/FleaflickerLeagueFetchService.ts`) and by Fleaflicker's own
Swagger docs at `https://www.fleaflicker.com/api-docs/index.html`. There is no token to redact,
no rate-limit header to respect beyond ordinary politeness, and no auth failure mode to model.
That makes this the simplest of the three contracts, and this file is sized to match — it does
not need `INTEGRATION.md` or `schema.sql` yet, because nothing here is wired into a durable sync
loop. Add them when (if) that changes.

⚠ **A committed fixture is real third-party data.** Fleaflicker leagues are public by the
platform's own design — no login is needed to read one — but the fixture still names real
people's real fantasy teams. Probe against a league your own account can see, and prefer one
with placeholder/generic team names over a random public one, the same caution this repo
already applies to the Neon sandbox's copy of production data.

---

## Files

| File | What it is | Authority |
|---|---|---|
| `ENDPOINTS.yaml` | Endpoint × sport registry, params, envelope shape | **Normative** |
| `fixtures/` | Real captured responses, one per endpoint | **Normative for shape** |
| `scripts/probe.sh` | One-time fixture capture. Not for runtime. | Tooling |
| `GAPS.md` | Known-unknowns. Append here instead of probing. | Living |

---

## Add this to your root `CLAUDE.md`

```markdown
## Fleaflicker API

The API contract is committed at `contracts/fleaflicker/`.

- **Do not call the Fleaflicker API to determine response shape.**
  Read `contracts/fleaflicker/ENDPOINTS.yaml` and `contracts/fleaflicker/fixtures/`.
- Unknowns are listed in `contracts/fleaflicker/GAPS.md`. If you need something not
  covered, append to GAPS.md and ask — do not probe.
- Public, unauthenticated JSON — no token to manage or redact, unlike Rolling Insights.
```

---

## What is already known, without probing

Everything below is read directly from this codebase's own working import code
(`lib/league-import/fleaflicker/`), not from a probe — it is already load-bearing and correct,
just not previously written down as a contract.

- **Base URL:** `https://www.fleaflicker.com/api` (no env var override exists today).
- **No auth.** No header, no query-param token, no cookie.
- **`sport`** is a required query param: `NFL` | `MLB` | `NBA` | `NHL`.
- **`league_id`** is a positive integer, platform-assigned, stable across seasons.
- **`season`** is a four-digit year; the platform accepts a request for a season with no data
  and returns an otherwise-normal envelope (confirmed by
  `fetchFleaflickerLeagueForImport`'s existing null-safety around `standings.season`).
- **404** means "no such league" (`FleaflickerImportLeagueNotFoundError`); this code already
  distinguishes it from other error statuses.
- Two endpoints are already integrated and working: `FetchLeagueStandings`,
  `FetchLeagueRosters`. Their shapes are in `lib/league-import/fleaflicker/types.ts` and are
  reproduced in `ENDPOINTS.yaml` for completeness, not because they were re-probed here.

## What this contract adds: the matchup/scoreboard endpoint

Neither integrated endpoint carries **matchups** — `FetchLeagueStandings` has season totals
(`pointsFor`/`pointsAgainst`) but no per-week pairing, and `FetchLeagueRosters` has no scores at
all. That absence is why Fleaflicker has no `WeeklyMatchup` writer today (see
`lib/fantasy-os/sync/collector/index.ts`'s note on the subject) — there was nothing to read
matchups FROM, committed or otherwise. This contract exists to close exactly that gap, following
the same `FetchLeagueXxx` naming Fleaflicker's own API already uses for the two endpoints this
codebase integrates.

See `GAPS.md` for the endpoint's exact status.
