# Fantrax — open questions

Append to this file rather than probing. The rule from `CLAUDE.md` applies here as
it does to the other contracts: read `ENDPOINTS.yaml`, and where it does not
answer, add the question here and ask.

## Not yet probed

Everything below `getAdp` and `getPlayerIds` in `ENDPOINTS.yaml` is documented from
the vendor page but **not verified against a live response**. Endpoint names and
parameters are high confidence; **field-level shapes are not**, because the vendor
describes its own page as "a draft document".

`getLeagues` cannot be probed without a real account's `userSecretId`, and that is a
live user credential — it must not be captured, committed, or pasted into a chat.
The correct way to close this is a real account exercising it through the app.

## Open questions

1. **Does `userSecretId` rotate or expire?** Nothing is documented. This decides
   whether a stored secret needs re-entry handling like the ESPN cookies do, or is
   set-once. Until known, treat a `getLeagues` auth failure as "ask the user to
   re-enter", not as a hard error.

2. **Is there a rate limit?** Undocumented. `getPlayerIds` alone is ~1.3 MB for NFL,
   so a naive per-request fetch would be both slow and rude. Assume there is one,
   cache the id map, and do not call it on a user path.

3. **What is `period` numbered against?** Both `getTeamRosters` and
   `getMatchupScores` take a `period`, described only as "lineup period" and
   "scoring period". Whether that is an NFL week, a league-defined scoring period,
   or a 1-based index is unresolved — and it differs by sport in most such APIs.

4. **What are the full `scoringSystem.type` values?** Only `ROTISSERIE` is named on
   the vendor page. A points-league value is implied by `getMatchupScores` but not
   stated. Do not switch on this field until the value set is known.

5. **Do `getDraftPicks` results include TRADED picks?** If they do, Fantrax can show
   a true pick inventory — something the Sleeper path explicitly cannot, which is
   why Draft HQ labels its slots "original". Worth confirming before promising it.

6. **Are league-scoped endpoints really unauthenticated?** The vendor page lists no
   parameters beyond `leagueId` for `getLeagueInfo`, `getStandings`, `getTeamRosters`
   and friends. If that is literally true, any league's data is readable by anyone
   holding its id. That has a privacy consequence for what we expose and log, and it
   should be verified rather than assumed in either direction.

7. **Does NCAAF actually return current players?** `getAdp` accepts `NCAAF`, and an
   NFL probe already returned a college prospect. If NCAAF is genuinely populated it
   matters a lot here: TheSportsDB has zero current NCAAF players and there are zero
   NCAAF trade values in this system today.

## Security note, restated

`userSecretId` is a long-lived user credential accepted as a **query parameter**.
Same hazard class as the Rolling Insights `RSC_token`. Prefer the POST body; never
log a full request URL; never place it in a client response or a fixture.
