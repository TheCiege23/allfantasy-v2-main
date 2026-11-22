# CollegeBasketballData (CBBD) — open questions

CBBD is CollegeFootballData's sister API. One key and one monthly call quota cover both
(<https://collegefootballdata.com/api-tiers>; the CBBD tier page says "one Patreon membership unlocks
both sites"). Commercial use is permitted (<https://collegefootballdata.com/terms>).

Captured endpoints and their shapes are in `ENDPOINTS.yaml`, from the fixtures in `fixtures/`
(`scripts/probe.sh`). **Nothing in the app calls CBBD yet.** The Python client's snake_case model
names (<https://github.com/CFBD/cbbd-python>) are NOT the wire names: the API is camelCase.

## B-01 — Can an NBA draft pick be linked to our college basketball player without names? — **ANSWERED 2026-11-22: yes, by id**

**Why it matters.** The C2C / Devy pipeline for basketball needs to know which college players were
drafted to the NBA: they move up to the manager's NBA roster, and the rookies nobody held make up
the shortened rookie draft. The football version links a CFBD draft pick to our player by
`collegeAthleteId` == `PlayerIdentityMap.cfbdId` (lib/devy/cfbdDraftPicksStore.ts).

**The chain, every link measured on committed fixtures (3 calls, 2026-11-22):**

```
/draft/picks?year=Y      athleteId
        ==  /teams/roster?season=Y&team=<sourceTeamLocation>   players[].id
/teams/roster            players[].sourceId   (ESPN athlete id, a string)
        ==  PlayerIdentityMap.espnId   (sport NCAAB)
```

1. **Wire names are camelCase:** `athleteId`, `sourceTeamLocation`, `sourceId`, `teamSourceId`.
2. **A pick's `athleteId` is the roster player's CBBD `id`.** The 2025 draft's three Duke picks
   (`draft-picks-2025.json`) are 205 Cooper Flagg, 206 Kon Knueppel and 204 Khaman Maluach; Duke's
   2024-25 roster (`roster-2025-duke.json`) has the same three ids on the same three players.
   The roster to read is the season ending in the draft year (2025 draft → `season=2025`).
3. **`sourceId` is the ESPN athlete id.** Duke's current roster (`roster-2026-duke.json`) has 13
   players. 5 of their `sourceId`s are stored as `espnId` in our NCAAB identity rows, and all 5 are the
   same person (Caleb Foster, Cayden Boozer, Dame Sarr, Sebastian Wilkins, Patrick Ngongba II). None of
   the 13 is held by a different player. The other 8 are in our data with `espnId` NULL, so they
   cannot be compared yet — not a disagreement. `teamSourceId` is 150, Duke's ESPN team id.

**Limits, so nobody overreads it:**

- **Coverage is our `espnId` coverage.** A pick links only if the player's NCAAB identity row has an
  `espnId`. 5 of 13 Duke players did. The ESPN NCAAB roster ingest (`lib/espn/ncaabEspnIngest.ts`)
  is what fills it; check its coverage on rostered players before relying on the pipeline.
- **Non-college picks carry no `athleteId`** (13 of 59 in 2025: France, China, Serbia...). Correct to
  skip — they were never on a college roster.
- **A college pick can lack `athleteId` too:** Egor Demin (BYU, 8th overall, 2025), 1 of 46. That pick
  cannot be linked by id and must not be linked by name; report it as unlinked.
- One school roster per draftee school is one call each (about 20–30 a draft). Fine once a year.

**Next:** build the basketball pipeline on this chain — store the picks once after each June draft,
resolve each to `PlayerIdentityMap.espnId` through the draft-year roster, and feed the drafts card's
"Moving up" section the way football does.
