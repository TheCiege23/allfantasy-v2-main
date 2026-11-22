# CollegeBasketballData (CBBD) — open questions

CBBD is CollegeFootballData's sister API. One key and one monthly call quota cover both
(<https://collegefootballdata.com/api-tiers>). Commercial use is permitted
(<https://collegefootballdata.com/terms>).

**Nothing in this repo calls CBBD yet.** No `ENDPOINTS.yaml` and no fixtures exist. Every field
name below comes from the Python client's model docs (<https://github.com/CFBD/cbbd-python>), which
give snake_case names with no descriptions and no JSON wire names. Do not code against them until a
response has been captured with this contract's own probe and committed as a fixture (CLAUDE.md:
probing is allowed only to add a new endpoint, and the fixture lands in the same change).

## B-01 — Can an NBA draft pick be linked to our college basketball player without names? (recorded 2026-11-21, no probe)

**Why it matters.** The C2C / Devy pipeline for basketball needs to know which college players were
drafted to the NBA: they move up to the manager's NBA roster, and the rookies nobody held make up
the shortened rookie draft. The football version links a CFBD draft pick to our player by
`collegeAthleteId` == `PlayerIdentityMap.cfbdId` (lib/devy/cfbdDraftPicksStore.ts). Basketball has
no such link today:

- `PlayerIdentityMap` (sport `NCAAB`) holds 3,288 rows with an `espnId`, and no CBBD id at all.
- NBA identity rows hold no `espnId` (0, measured 2026-11-21), so ESPN's shared athlete id cannot
  link college to pro from our side.
- Matching by name is ruled out (lib/core-app/connectedRoster.ts: "Never match a college player by name").

**What the docs suggest (unverified):**

| model | id fields (Python names) |
|---|---|
| `DraftPick` (`/draft/picks`) | `athlete_id` (int) only. `source_team_*` fields describe the college team, not the player. |
| `TeamRosterPlayer` (`/teams/roster`) | `id` (int, CBBD) and `source_id` (str, system not stated) |
| `GameBoxScorePlayersPlayersInner` (`/games/players`) | `athlete_id` (int) and `athlete_source_id` (str, system not stated) |

**Hypothesis:** `athlete_source_id` / `source_id` is the ESPN athlete id. If it is, the chain is
`DraftPick.athlete_id` → `TeamRosterPlayer.id` → `source_id` (ESPN) → `PlayerIdentityMap.espnId`
(NCAAB), with no names anywhere.

**To settle it, once the CFBD/CBBD key has quota again:** capture one `/draft/picks?year=<last
draft>` and one `/teams/roster` for a school with a recent first-rounder, then commit both as
fixtures here. Confirm that:
1. the JSON wire names (camelCase or not);
2. the roster `sourceId` of a known player equals his ESPN athlete id;
3. the pick's athlete id equals that roster player's CBBD id.

Until then the basketball pipeline is not built. The page shows the drafts card without a
"Moving up" section, as football does before its draft results arrive.
