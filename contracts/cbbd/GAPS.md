# CollegeBasketballData (CBBD) — open questions

CBBD is CollegeFootballData's sister API. One key and one monthly call quota cover both
(<https://collegefootballdata.com/api-tiers>; the CBBD tier page says "one Patreon membership unlocks
both sites"). Commercial use is permitted (<https://collegefootballdata.com/terms>).

Captured endpoints and their shapes are in `ENDPOINTS.yaml`, from the fixtures in `fixtures/`
(`scripts/probe.sh`). The app calls CBBD only from ingestion: `lib/cbbd/cbbdFetch.ts` (the adapter), imported by
`lib/devy/cbbdDraftPicksStore.ts` and `lib/devy/cbbdDraftHistoryIngest.ts`. The Python client's snake_case model
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

**Update 2026-11-28 — the plumbing for both items is built; no data is.** Item 2's writer exists (B-03), item 1's
capture mode exists (B-04), the measurement script and an EMPTY generated table exist, and the NBA grade has a
measured-cohort path that prices nobody until the table is filled. The owner's run order is B-05. No CBBD call was
made building any of it: the session had no key.

## B-03 — A multi-year NBA draft history — **BUILT 2026-11-28, NOT YET RUN**

B-02 item 2. `/draft/picks?year=Y` is captured (`fixtures/draft-picks-2025.json`), so this needed no new shape.

- **Store:** `cbbd:draft-history:v1:<year>` — every pick exactly as CBBD sends it (fields from the fixture only),
  keyed on CBBD's `athleteId`, one row per year, expiry 2100. Written by `lib/devy/cbbdDraftHistoryIngest.ts`.
  It is a SECOND key on purpose: the C2C pipeline's `cbbd:draft-picks:v1:<year>` links picks to our players by
  ESPN id at ~25 roster calls a year, and a past year written there with no linked picks would read as "nobody
  drafted". The measurement joins a pick to a recruit, so it needs one call a year, not 25.
- **Backfill:** `scripts/backfill-cbbd-draft-history.ts`. Default 2010 through the newest draft whose window has
  closed (2026 today: **17 calls**). Idempotent (a final row is never refetched, so a re-run makes 0 calls),
  bounded (range 2000+, at most 30 years, never a draft still in its window), paced (2 s between calls),
  stops at the shared CFBD background reserve and on the first failed call, keeping the rows already written.
  The key goes only in the Bearer header inside `cfbdGet`; the script prints counts and failure kinds.
- **The scheduled writer keeps history too.** `refreshCbbdDraftPicks` (import-players cron) still stores the
  current year's linked row; it now also writes that year's history row from the draft call it already makes
  (0 extra calls), before the roster reads, and both rows carry the 2100 expiry instead of two years. It writes
  only its own year's keys and deletes nothing.

## B-04 — Does CBBD serve basketball recruiting, and in what shape? — **OPEN 2026-11-28: endpoint unverified**

B-02 item 1, the denominator of P(drafted). `ENDPOINTS.yaml` `recruiting_players` records the belief:
`/recruiting/players?year=Y`, **confidence none**. The only evidence is that CFBD serves football recruits at that
path and CBBD mirrors CFBD's layout for the two endpoints captured so far. No CBBD document, client or response in
this repo names it. Its fields, whether a row carries the `athleteId` that `/draft/picks` uses, what `year` means,
and the position and rank vocabulary are all unknown.

**What exists:** the capture mode `scripts/probe.sh recruiting <YEAR>` (1 call, writes
`fixtures/recruiting-<YEAR>.json`, refuses to overwrite), and the STORED shape the measurement reads,
`lib/devy/cbbdRecruitsStore.ts` (`cbbd:recruits:v1:<classYear>`: `athleteId`, `name`, `position` G/F/C,
`nationalRank`). That shape is ours — what a writer must FILL, not a claim about CBBD — and **nothing writes it**.

**Next, in order, and nothing out of order:**
1. Run the probe for ONE class (B-05 step 1) and commit the fixture. A 404 means the path is wrong: record that
   here; do not try other paths blind.
2. From that fixture only, write the parser and an ingestion module that maps it into `StoredBasketballRecruit`,
   plus its backfill script (one call per class, same pacing and reserve rules as B-03). If the rows carry no id
   that equals a draft pick's `athleteId`, stop: the join has to be designed from the fixture, and a name join is
   not acceptable (B-01).
3. Fill `nbaProspectRecruiting` on the NBA dynasty context from those rows (by ESPN id, via the B-01 roster link),
   so the measured pricing path has prospects to price.

## B-05 — Owner run commands for the basketball devy measurement

The key is on Railway, not in this repo. Run from a checkout of `main`, with the Railway CLI linked to the project.
**`railway run` injects that service's `DATABASE_URL` — production.** The backfills WRITE `sportsDataCache` rows
there (new keys only; nothing is deleted); the probe and the measurement write no database rows. A local `.env`
works the same way (`node --env-file=.env …`) — check which database its `DATABASE_URL` names first.

```bash
# 0. Which service holds the key (names only — never print the values):
railway variables --service allfantasy-v2-worker --kv | cut -d= -f1 | grep -E '^(CFBD_API_KEY|CFBD_KEY|COLLEGE_FOOTBALL_DATA_API_KEY)$'
#    (the worker runs the CFBD/CBBD crons; if it shows nothing, try --service allfantasy-v2-main)
SVC=allfantasy-v2-worker
RUN="node --require ./scripts/_audit-preload.cjs --import tsx"

# 1. Capture ONE recruiting class (1 call), then commit it (B-04 step 1).
railway run --service $SVC bash contracts/cbbd/scripts/probe.sh recruiting 2019
git add contracts/cbbd/fixtures/recruiting-2019.json && git commit -m "contracts(cbbd): capture recruiting 2019"

# 2. NBA draft history 2010-2026 (17 calls; a re-run makes 0).
railway run --service $SVC $RUN scripts/backfill-cbbd-draft-history.ts --dry-run   # 0 calls: lists what it would fetch
railway run --service $SVC $RUN scripts/backfill-cbbd-draft-history.ts

# 3. (A session's work, not a command) write the recruiting parser + ingestion from the step-1 fixture (B-04
#    step 2) and run its backfill for classes 2009-2021: ~13 calls if a class is one response — unmeasured.

# 4. Measure (0 calls: reads stored rows only), then commit the generated table.
railway run --service $SVC $RUN scripts/basketball-devy-draft-rate-backfill.ts --dry-run
railway run --service $SVC $RUN scripts/basketball-devy-draft-rate-backfill.ts
git add lib/devy/basketballDraftRates.generated.ts && git commit -m "devy: measure basketball draft rates"
```

**Call budget, against the shared CFBD/CBBD month** (75,000 calls on the plan in use 2026-11-21; background jobs
stop at 15,000 left, `lib/cfbd-quota.ts`): probe 1 + draft history 17 + recruiting ~13 = **~31 calls**, about
0.04% of the month, once. The draft history then grows by one row each June at no extra cost (B-03).

**Until step 3 is done, step 4 prints `NOT MEASURED — no stored basketball recruiting classes` and exits 1**,
leaving the committed table EMPTY — the correct result, not a failure to chase. The measurement measures classes
whose five-draft window has closed (2009-2021 today: a class C is drafted in C+1..C+5), aborts if any of those
drafts is missing, and aborts if fewer than half the window's college picks match a stored recruit by id. A cell
prices only at ≥ 50 recruits and ≥ 10 drafted (`lib/devy/basketballDraftRates.ts`).
