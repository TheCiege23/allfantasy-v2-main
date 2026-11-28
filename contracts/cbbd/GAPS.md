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

## B-02 — Can NCAAB → NBA devy prospects be priced the way NCAAF → NFL ones are? — **OPEN 2026-11-28: no, two datasets are missing**

**Why it matters.** Football prices a devy prospect as `P(drafted | position, rating) × E[board value | drafted]
× horizon discount` (`lib/devy/devyOptionValue.ts`), both factors MEASURED and generated
(`lib/devy/draftRates.generated.ts`: 8 recruit classes × 10 draft years, 10,028 recruits;
`lib/devy/arrivalValues.generated.ts`: 3 draft classes on the FantasyCalc board). The owner asked for the same
for basketball devy and C2C. Checked the repo, the schema and its writers, and every contract — no provider was
called.

**What exists:**

- **NBA draft history — one class.** `fixtures/draft-picks-2025.json`: 59 picks, 46 from college (G 27, F 11,
  C 8), 45 with an `athleteId`. `overallRank` (58 of 59 set, values up to 98) is a pre-draft rank, but the
  endpoint lists DRAFTED players only, so it has no denominator: it cannot say how often a rank-N prospect goes
  undrafted. The stored copy (`cbbd:draft-picks:v1:<year>`, `lib/devy/cbbdDraftPicksStore.ts`) is written for
  the latest draft year only, so production holds at most a year or two, not a history.
- **A pre-draft NBA rank board.** `lib/adp/nbaProspectRanks.ts` (`trade:nba:prospect-ranks:<year>`), imported by
  hand from a licensed publisher, next draft class only, 30-day TTL.
- **An NBA value scale — but not a fixed one.** The NBA grade is points over replacement under each league's own
  scoring, summed over five aged seasons (`playerDynastyValue`, `lib/decision-os/trade/sportDynastyValue.ts`).
  There is no league-independent NBA dynasty board (FantasyCalc is NFL-only), so a generated
  E[value | drafted] table would be in no league's units.

**What is missing, and who would supply it:**

1. **NCAAB recruiting ratings.** Nothing stores them: `DevyPlayer.recruiting*` is written only by the CFBD
   (football) ingestion, and `seedCollegeBasketballPlayers` never sets it. No contract in `contracts/` captures a
   basketball recruiting endpoint. CBBD is the likely source (CFBD's sister API has one for football); it would
   need a new `/recruiting/players`-style capture via `scripts/probe.sh` and a committed fixture before anything
   reads it. **Unverified — do not assume the endpoint or its shape exists until it is captured.**
2. **A multi-year NBA draft history with a cohort denominator.** P(drafted) needs the recruit class (or every
   ranked prospect) AND who of them was drafted, over several classes. `/draft/picks` is captured and takes any
   `year`, so the drafted half is an ingestion backfill of ~8–10 years; the denominator is item 1.

**What prices today instead (2026-11-28).** An NBA devy league is graded as an NBA dynasty league, and a held
prospect is priced ONLY from a verified pre-draft rank for the next draft, as the pick that rank implies, on the
league's own rookie pick curve (`nbaProspectValue`). That is the same curve the league's picks use, so prospect
and pick values are one scale by construction. It carries **no P(drafted) discount** — the rank board is the
evidence, not a measured rate — and every unranked or later-class prospect withholds the deal. No NCAAB prospect
is ever priced on the NFL devy option (`devyOptionValue` refuses a non-NCAAF row).

**Next:** capture a CBBD recruiting endpoint (item 1), then backfill `/draft/picks` for the matching years
(item 2); only then can a `basketballDevyOptionValue` be generated the way football's was.
