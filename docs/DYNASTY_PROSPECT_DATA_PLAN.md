# Dynasty prospect and rookie data: MLB, NBA, NHL

Status: **PLAN ONLY.** This changes no schema, adds no provider call, and adds no cron.
Written 2026-10-19 against `origin/main`. No provider API was called to write it. Shapes come
from `contracts/*/ENDPOINTS.yaml`, `fixtures/` and `GAPS.md`, and facts about the code come
from reading it. Vendor facts come from public documentation and search results, and each one
is marked **verified** (read on the vendor's own page or in a committed contract) or
**assumption / secondary** (third-party claim, or inferred).

---

## 0. Summary

- **None of our committed provider contracts gives us MLB minor leaguers, NHL draft rights, or
  NBA draft prospects.** The RI `player-info` field list is undocumented. TheSportsDB documents
  no draft field at all. Fantrax `getPlayerIds?sport=MLB` *may* include minor leaguers, but
  that is unverified and it only carries id, name, team and position.
- **NBA is the only sport that has a partial prospect pool today.** `DevyPlayer` already holds
  NCAAB rows (`sport: 'NCAAB'`, `lib/devy/CollegePlayerSeedService.ts`) and `nba_devy` is a
  devy adapter (`lib/devy/types.ts:18-25`). Two GAPS entries limit how far that data can be
  trusted: RI NCAABB `ACT` is not the current roster (`contracts/espn/GAPS.md` M-01), and
  2026-27 newcomers are missing (M-02).
- **Non-NFL rookie detection is a guess, and it misses the case that matters.**
  `extractRookieHint` (`lib/draft-room/sportsPlayerRecordDraftEnrichment.ts:99-121`) flags a
  non-NFL player as a rookie when a stored stats row says `gamesPlayed === 0`. That catches an
  injured veteran who logged a zero-game row. It never fires for a real first-year player, who
  has no stats row at all. `rookieFilterPredicate.ts` reads `draftYear`, `debutYear` and
  `rookieYear`, but nothing in our data writes them for these sports (§2.5).
- **Recommended sources, pending the owner's decisions in §7:**
  - **MLB:** a licensed vendor feed. Ask Sportradar and SportsDataIO first. MLB Stats API
    (`statsapi.mlb.com`) is the gold-standard *shape*, but its terms do not establish
    commercial rights.
  - **NHL:** Elite Prospects API (commercial licence, priced per region), plus a licensed
    vendor for draft-pick rights.
  - **NBA:** Sportradar NBA Draft API (`prospects`, `top prospects`, `draft summary`), which is
    documented and verified, with our existing NCAAB `DevyPlayer` pool as the college layer.
- **Data model:** add a sport-scoped `ProspectPlayer` table (and do not stretch `DevyPlayer`),
  add a `sport` column to `RookieRanking` and `RookieClass`, and add a
  `RookieEligibilityRecord` that holds a per-sport eligibility verdict with its source. All of
  these are **proposed** migrations, written out in §4 and not applied.
- **Ingestion:** copy the CFBD/devy shape (adapter → ingestion → DB-first read → scheduled
  writer), and run the writer as a weekly-gated phase inside the existing
  `/api/cron/import-players?intel=1` tick. `cron-schedule.json` is at 60 of 60
  (`node scripts/cron-budget-check.mjs --report` printed `crons declared: 60 (ceiling 60)`).

---

## 1. What "prospect" means per sport

| | MLB | NHL | NBA |
|---|---|---|---|
| Who is a prospect | Minor leaguers (Rookie/A/A+/AA/AAA, Complex & DSL), international amateurs signed (J2 period, opens Jan 15), First-Year Player Draft picks (July, All-Star break), NCAA/HS draft-eligible amateurs | Drafted players whose **rights** are held by an NHL club while they play in CHL (OHL/WHL/QMJHL), NCAA, USHL, Europe (SHL, Liiga, KHL…), or AHL; plus draft-eligible juniors before the June NHL Draft | Draft-eligible players: NCAA, G League (incl. Ignite-style pathways), international (EuroLeague, NBL Next Stars, ACB); after the June draft they become NBA rookies |
| Dynasty asset form | Rostered "minors"/prospect slots, often multi-year stashes; FYPD (first-year player draft) in leagues after the July draft | Prospect/"farm" slots holding rights for 2-5 years; the rookie draft follows the June NHL Draft | Rookie draft after the June NBA draft; prospects rarely stashed more than one season |
| What ends prospect status | MLB **rookie limits**: 130 AB, or 50 IP, or 45 days on the active roster (excluding September/injured list time). Many fantasy hosts use these or a simplified version | Typically NHL games played (common league rules use 25 or 82 GP), or age/season since draft. No single standard | Simple: first NBA season = rookie. Drafted-and-stashed internationals are the exception |
| How long it lasts | 1-6 years | 1-5 years | Usually less than 1 year |
| Our coverage today | None (§2) | None (§2) | Partial: NCAAB `DevyPlayer` (§2.3) |

*(The MLB rookie-limit thresholds are MLB's published rookie-eligibility rule, from domain
knowledge. They are not in any repo contract. Fantasy-host variants are an **assumption** to
confirm against each league's settings.)*

The existing repo calendar for this lives in `lib/dynasty-core/dynastySportConfig.ts`
(`rookieWindowYears`, `proDraftMonth`, `rookieDraftMonth` per sport). §4.3 reuses it rather
than inventing a second calendar.

---

## 2. What we already have

### 2.1 Rolling Insights (`contracts/rolling-insights/`)

`RSC_TOKEN2` covers MLB, NBA, NHL, NCAABB and NCAAFB (CLAUDE.md; `GAPS.md` line ~153).

| Question | Answer | Evidence | Confidence |
|---|---|---|---|
| Any minor-league (MiLB) endpoint or sport code? | **No.** `sports.codes` = NHL, NBA, NFL, MLB, NCAABB, NCAAFB, SOCCER, DARTS, PGA | `ENDPOINTS.yaml:121` | contract-level (high) |
| Any draft / draft-pick endpoint? | **No.** Endpoints are schedule*, live, play_by_play, team_info/stats, player_info/stats, injuries, depth_charts, events, field | `ENDPOINTS.yaml:181-330` | high |
| Does `player-info` carry draft year / round / debut / experience? | **Unknown, and not documented.** `player_info` lists only path and query params. No per-sport field list exists for it. Our ingest reads `player_id, player, position, team, number, age, height, weight, college/school, dob, status` and nothing draft-like | `ENDPOINTS.yaml:276-283`; `lib/sports-data/rollingInsightsTeamsPlayers.ts:318-349` | **none** (no fixture) |
| `age` | Is actually a mangled DOB. Year is recoverable ±1, and new rows salvage `dob` | `GAPS.md` ~410-441 | measured |
| Experience / rookie flags for NFL? | Not documented. `lib/providers/nflRookieSourcePolicy.ts:39` says Sleeper `years_exp` is the fallback | — | high |
| NCAABB players (for NBA prospects) | `player-info` and `player-stats` work for NCAABB on TOKEN2. **But** `ACT` ≠ current roster (`GAPS.md` N-17), season totals stop ~mid-December (N-14), live box can omit players (N-15), 2026-27 schedule 304 (N-16) | `GAPS.md` N-14..N-17; `fields.NCAABB` confidence **medium** (one game) | medium |
| MLB/NBA/NHL `live` shapes | Fixtures committed | `fixtures/live.{MLB,NBA,NHL}.json`; `fields.*.confidence: high` | high |

**Conclusion:** RI gives us **pro** rosters and stats for MLB/NBA/NHL and a college basketball
layer. It gives us nothing for MiLB, nothing for junior/European hockey, and no draft data.
Whether `player-info` hides a draft or experience field can only be settled by
`scripts/probe.sh player-info <SPORT>` with the fixture committed in the same change (the
CLAUDE.md rule), or by asking the vendor. **That probe was not run here.** It is decision D-6
in §7.

### 2.2 TheSportsDB (`contracts/thesportsdb/`)

- The `lookupplayer.php` full shape (`ENDPOINTS.yaml:413-422`, 66 fields, fixture
  `v1.lookupplayer.NFL.json`) has **no draft field**. The nearest fields are `dateSigned`,
  `strSigning`, `strCollege` and `strStatus`. In the one fixture (Jalen Hurts), `strSigning`
  is `''` and `dateSigned`/`strCollege` are `null`.
- `lib/providers/theSportsDbCapabilities.ts:27-29` already records `draft_year_confirmed`,
  `debut_year_confirmed` and `rookie_experience` as `'unknown'`, and
  `isTheSportsDbRookieExperienceSupported()` returns `false`.
- `league_ids` lists MLB 4424 and NBA 4387, and **no NHL id** (`ENDPOINTS.yaml:146-147`). There
  are no MiLB, AHL or CHL ids, and no fixture for any non-football sport.
- **Use:** headshots and biographical enrichment only. Not a prospect source.

### 2.3 NCAAB devy (NBA prospects)

- `DevyPlayer` already has `sport` (`@default("NCAAF")`), `ncaaSourceTag`,
  `draftEligibleYear`, `declaredDraftYear`, `draftStatus`, `draftRound`/`draftPick`
  (`prisma/schema.prisma:3629-3790`).
- `seedCollegeBasketballPlayers` writes `sport: 'NCAAB'` rows from `apiChain` 'players'
  (`lib/devy/CollegePlayerSeedService.ts:54-140`). Its only caller is
  `lib/workers/devy-data-worker.ts:300`. `app/api/cron/import-players/route.ts:506-529`
  notes that `seedCollegePlayers` is reachable only from excluded routes and the Redis worker.
  **So the NCAAB devy pool has no confirmed scheduled writer.** This is the same failure
  CLAUDE.md records for `ingestCFBDStats`.
- The ESPN NCAAB contract (`contracts/espn/`) is a headshot/roster cross-check only. Per
  owner decision E-06 it creates no ESPN-sourced player rows.

### 2.4 Fantrax / MLB identity

- `ingestMlbFantraxIdentities` (`lib/player-identity/ingestMlbFantraxIdentities.ts`) runs
  weekly from the `?intel=1` tick (`import-players/route.ts:162-169`). It links
  `PlayerIdentityMap.fantraxId` **only onto rows that already have a `rollingInsightsId`**,
  with an exact match on name, team and role (`mlbFantraxIdentityPlan.ts`).
- `FantraxPlayerRef` = `{ rotowireId?, fantraxId, name, team, position }`
  (`lib/league-import/fantrax/fantraxApi.ts:83-89`). It has no level, status or draft field.
- **Assumption (unverified):** Fantrax's MLB universe includes minor leaguers, because Fantrax
  hosts dynasty leagues with minors slots. If it does, they are counted today in
  `unmatched` and discarded. `contracts/fantrax/` has **no** `getPlayerIds` fixture (only
  `2026-actual-week-download.json`). Reading the marker row
  `sportsDataCache['fantrax:mlb-identities:last-run']` (`provided` vs `unmatched`) would size
  it with no probe. That is a DB read for the owner or an ops session.
- Fantrax roster import already understands non-ACTIVE states, including minor-league
  (`FantraxLeagueFetchService.ts:261`), and `MlbRosterTemplates.ts:31-64` defines `NA`,
  `MINORS` and `PROSPECT` slots. **The roster model is ready for prospects. The player
  universe is not.**

### 2.5 Rookie logic in the draft room (the part that is wrong today)

| Location | Behaviour | Problem |
|---|---|---|
| `sportsPlayerRecordDraftEnrichment.ts:109-111` | non-NFL: `gamesPlayed ?? games ?? g` `=== 0` → rookie | (a) A true rookie has **no** `sports_players.stats` row (the importer binds the *latest stored season row*, `sports-data-importer.ts:~964`), so this never fires for them. (b) It does fire for injured or non-playing veterans with a zero-GP row. (c) It does not read `games_played`, the key the RI field maps use (`lib/providers/rollingInsightsFieldMaps.ts:291,487,637` `regular_season.games_played`; `lib/stats/rollingInsightsPlayerStats.ts:187`). Whether MLB/NBA/NHL blobs use `games_played` is **unverified** (no player-stats fixture). Net: precision and recall are both unknown, and probably poor. |
| `getResolvedDraftPoolForLeague.ts:1430-1435` | maps `draft_year / rookie_year / debut_year / first_season_year / class_year` from pool rows | Nothing in our schema stores those for MLB/NBA/NHL (`SportsPlayer` has none of them, and `yearsExp` is documented as NFL experience, `schema.prisma:342-347`). They are always null. |
| `rookieFilterPredicate.ts:99-122` | NBA: `draftYear === current calendar year`. MLB: `debutYear === current`. NHL: `draftYear === current \|\| age <= 20` | Inputs are always null (above), so NHL reduces to `age <= 20`, and RI `age` was a mangled DOB until recently (`GAPS.md`). `CURRENT_SEASON_YEAR` uses the **calendar** year: an NBA 2026-27 rookie (drafted June 2026) stops matching on Jan 1 2027, mid rookie season. |
| `getResolvedDraftPoolForLeague.ts:931` | `rookies_only` keeps the **whole pool** when nobody is flagged | That is the correct fallback, given the above. It also means a non-NFL rookie draft today is effectively an all-players draft that skips rostered players. |

**Why no code fix ships with this plan.** The brief allowed a migration-free improvement *only
if fully supported by existing committed data*. None is. A real fix needs a stored draft year
or debut year per player, and no committed contract supplies one for these sports. Changing
the `gamesPlayed===0` heuristic without that data trades one unmeasured guess for another, and
`veterans_only` pools would shift for live leagues. §4.3 is the replacement, and it waits on
data.

### 2.6 Other tables in this area

- `RookieRanking` (`schema.prisma:12670`) has **no `sport`** and `@@unique([year, name])`.
  Readers are sport-blind: `lib/adp-data.ts:291`, and
  `lib/trade-engine/trade-analyzer-intel.ts:41` (top 20 by year, any sport). No TypeScript
  writer was found (`grep rookieRanking.(upsert|create)` → none). **Writing a single non-NFL
  row today would leak into NFL trade intel.**
- `RookieClass` (`schema.prisma:3806`) has `year` as the PK and only QB/RB/WR/TE depth. It is
  NFL-only by construction.
- `Player` (`schema.prisma:3572`) has `devyEligible`, `projectedDraftRound` and
  `nflDraftRound`, all NFL-shaped.

---

## 3. Candidate external sources

Nothing here was signed up for or called. "Verified" means it was read in the vendor's own
documentation. No scraping is recommended anywhere, including of the public pages several
community tools target.

### 3.1 MLB

| Source | Covers | Licensing / terms | Cost | Status |
|---|---|---|---|---|
| **MLB Stats API** (`statsapi.mlb.com`) | Full MiLB rosters and stats by sport id, `/draft/{year}`, `/draft/prospects/{year}`, transactions, `debutDate` on people | Every response carries an MLB Advanced Media copyright notice linking MLBAM terms. MLB publishes **no developer terms or docs** granting commercial use. Community wrappers state "not for commercial use" | Free (no key) | Shape: verified via community docs. **Commercial right: NOT established. Do not use without written MLBAM permission.** |
| **Sportradar MLB** | Team Full Roster includes "~100 minor league players not on the 40-man", but "does not include every player in the team's minor league system" (Sportradar MLB docs). No MLB draft endpoint was found | Commercial licence, contract | Not published (sales) | Roster claim **verified** (vendor docs). Draft/prospect coverage **unverified**. |
| **SportsDataIO MLB** | Standard MLB feeds. Prospect/MiLB coverage not visible without a key | Commercial licence | Third party: "Discovery Lab" $99-149/mo, next-day delay. Vendr buyer median ~$16.5k/yr | **Secondary.** Ask sales whether MiLB/draft is included. |
| **Rolling Insights** | MLB pro only (§2.1) | Already licensed (TOKEN2) | Already paid | Verified (contract): **no MiLB.** Ask the vendor about `player-info` draft/debut fields (D-6). |
| Baseball America / FanGraphs / Prospects Live (rankings) | Expert prospect rankings | No public data-licence terms found | Unknown | **Unverified.** Would need a direct licensing conversation. Rankings are an editorial product, separate from the player universe. |
| Fantrax `getPlayerIds?sport=MLB` | Possibly a MiLB-inclusive id/name/team/pos universe | Already used in production for identity | — | **Assumption.** Size it from the marker row before relying on it (§2.4). |

### 3.2 NHL

| Source | Covers | Licensing / terms | Cost | Status |
|---|---|---|---|---|
| **Elite Prospects API** (Everysport Group AB) | The authoritative hockey prospect database: CHL, NCAA, USHL, European leagues, AHL, draft history | API licence agreement (`developer.eliteprospects.com/legal/terms.pdf`). Business customers only. Keys issued by EP. **Plans priced by region** (North America / Nordics / Central Europe) | Not published | Terms/structure **verified** (vendor docs). Price unknown. |
| NHL web API (`api-web.nhle.com`) | `/v1/prospects/{team}`, draft rankings | No published developer terms. Third-party claims "free to use" are not the NHL's terms | Free | **Commercial right NOT established.** Same position as MLBAM. |
| Sportradar NHL | Roster guide lists "transactions, rosters, injuries, depth charts, players, and draft details". Player Profile carries draft info | Commercial | Not published | Draft info on drafted players **verified** (vendor guide). A prospect *list* endpoint was **not found**. |
| Rolling Insights NHL | NHL pro only | Licensed | Paid | Verified: **no junior/AHL/Europe.** |

### 3.3 NBA

| Source | Covers | Licensing / terms | Cost | Status |
|---|---|---|---|---|
| **Sportradar NBA Draft API** | `prospects` (upcoming/historical per year), `top prospects`, `draft summary`, push draft picks. College prospects appear after the NCAA early-entrant withdrawal deadline, international after the NBA one. A prospect's NBA id appears once drafted | Commercial | Not published | **Verified** (developer.sportradar.com reference pages) |
| Rolling Insights NCAABB | College players and stats | Licensed (TOKEN2) | Paid | Usable with the N-14..N-17 caveats |
| ESPN site API (NCAAB) | Rosters/headshots cross-check | Unofficial, no docs (`contracts/espn/`) | Free | Owner decision E-06: photos only |
| SportsDataIO NBA | Possibly draft/prospects | Commercial | See MLB row | **Unverified** |

**Sources consulted (secondary unless noted):**
[Sportradar NBA prospects](https://developer.sportradar.com/basketball/reference/nba-prospects) (vendor),
[Sportradar NBA draft guide](https://developer.sportradar.com/basketball/docs/nba-ig-draft) (vendor),
[Sportradar NBA top prospects](https://developer.sportradar.com/basketball/reference/nba-top-prospects) (vendor),
[Sportradar NHL rosters guide](https://developer.sportradar.com/ice-hockey/docs/nhl-ig-rosters) (vendor),
[Sportradar MLB overview](https://developer.sportradar.com/baseball/reference/mlb-overview) (vendor),
[Elite Prospects API terms](https://developer.eliteprospects.com/legal/terms.pdf) (vendor),
[Elite Prospects API coverage](https://docs.api.eliteprospects.com/coverage) (vendor),
[SportsDataIO review](https://sportsapis.dev/apis/sportsdata-io),
[Vendr SportsDataIO](https://vendr.com/marketplace/sportsdataio),
[pymlb-statsapi draft schema](https://pymlb-statsapi.readthedocs.io/en/latest/schemas/draft.html),
[nhl-stats-and-record-scraper](https://pypi.org/project/nhl-stats-and-record-scraper/),
[python-mlb-statsapi](https://pypi.org/project/python-mlb-statsapi/0.5.8).

### 3.4 Recommendation per sport

| Sport | Recommended | Why | Fallback |
|---|---|---|---|
| **NBA** (do first) | Sportradar NBA Draft API for the declared class, plus our NCAAB `DevyPlayer` for the college layer | It is the only verified, documented prospect endpoint among the candidates. The class is small (~60 picks plus ~100 top prospects), so cost per useful row is low. Half the pipeline (NCAAB devy, `nba_devy` adapter) already exists | No new vendor: derive "rookie" from RI NBA rosters ("on an NBA roster this season, absent from last season's RI player-stats"). That covers rookies but not pre-draft prospects |
| **MLB** | Licensed vendor feed. Ask Sportradar and SportsDataIO for MiLB-system and draft coverage. Separately, ask MLBAM for a Stats API licence | MLB prospect value is the whole dynasty MLB product, and it needs the full MiLB universe. Sportradar's own docs say its roster feed does not include every minor leaguer, so this needs confirming before purchase | Phase 1 can still ship FYPD-only from the MLB draft results of whichever licensed feed is bought |
| **NHL** | Elite Prospects API (North America region first) | The only verified, contractually licensable source covering CHL/NCAA/Europe, where NHL prospects actually play | Sportradar NHL player-profile draft info for **drafted** players only (rights holders), without junior stats |

---

## 4. Proposed data model (PROPOSED migrations, NOT applied)

Schema changes are the owner's decision (CLAUDE.md: "a migration is not pushable work").
Below is what would be proposed. None of it is in `prisma/schema.prisma` in this PR.

### 4.1 Why a new table rather than stretching `DevyPlayer`

`DevyPlayer` is college-shaped: `school` is required, `@@unique([normalizedName, position,
school])`, and it has ~60 NCAAF-specific columns (PPA, WEPA, air yards, coach). A Dominican
16-year-old signed on Jan 15, or a Swedish SHL defenseman whose rights Toronto holds, has no
`school`. Forcing them in would mean a sentinel school string plus a unique key that collides
across levels. **Keep `DevyPlayer` for NCAA (including NCAAB→NBA). Add a pro-prospect table.**

### 4.2 Proposed models

```prisma
/// A player who is NOT yet a major-league regular but is a dynasty asset in MLB/NHL/NBA.
/// One row per (sport, source, sourcePlayerId). Identity to the pro universe goes through
/// PlayerIdentityMap, never by name at read time.
model ProspectPlayer {
  id               String    @id @default(cuid())
  sport            String    @db.VarChar(8)       // MLB | NHL | NBA
  source           String    @db.VarChar(24)      // sportradar | eliteprospects | ...
  sourcePlayerId   String    @db.VarChar(64)
  name             String
  normalizedName   String
  position         String?   @db.VarChar(16)
  birthDate        DateTime?
  nationality      String?   @db.VarChar(48)
  /// Where the player plays now: MLB AAA/AA/A+/A/CPX/DSL; NHL CHL/NCAA/USHL/SHL/AHL/...;
  /// NBA NCAA/GLEAGUE/INTL.
  currentLevel     String?   @db.VarChar(16)
  currentTeam      String?   @db.VarChar(64)
  /// Pro organisation that holds the rights (MLB org / NHL club). NULL = unsigned/undrafted.
  rightsOrg        String?   @db.VarChar(8)
  draftYear        Int?
  draftRound       Int?
  draftPick        Int?
  draftOverall     Int?
  signedYear       Int?                            // MLB international signing (J2)
  proDebutDate     DateTime?                       // first major-league game; NULL = none yet
  /// "prospect" | "graduated" | "released" | "unknown"; graduated rows are kept, not deleted.
  status           String    @default("prospect") @db.VarChar(16)
  identityMapId    String?                         // PlayerIdentityMap.id once linked
  statsPayload     Json?                           // level stats, source-shaped, labelled
  rawPayload       Json?
  sourceUpdatedAt  DateTime?
  lastSyncedAt     DateTime  @default(now())
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  @@unique([sport, source, sourcePlayerId])
  @@index([sport, status])
  @@index([sport, draftYear])
  @@index([sport, normalizedName])
  @@index([identityMapId])
}

/// Per-sport rookie eligibility verdict, with its reason. The draft room reads this
/// instead of guessing from gamesPlayed.
model RookieEligibilityRecord {
  id             String   @id @default(cuid())
  sport          String   @db.VarChar(8)
  season         Int                               // the league season the verdict is for
  identityMapId  String?                           // pro player
  prospectId     String?                           // ProspectPlayer.id
  eligible       Boolean
  /// mlb_rookie_limits | nhl_draft_rights | nhl_gp_threshold | nba_draft_class |
  /// nba_first_season | unknown
  rule           String   @db.VarChar(32)
  evidence       Json                              // e.g. {ab:88, ip:0, draftYear:2025}
  computedAt     DateTime @default(now())

  @@unique([sport, season, identityMapId, prospectId])
  @@index([sport, season, eligible])
}
```

Changes to existing models (each one is a separate decision):

```prisma
model RookieRanking {
  // + sport String @default("NFL") @db.VarChar(8)
  // @@unique([year, name])  ->  @@unique([sport, year, name])
  // + @@index([sport, year])
}
model RookieClass {
  // year Int @id  ->  id cuid @id; + sport String @default("NFL"); @@unique([sport, year])
  // + positionDepth Json?   // sport-agnostic depth by position; QB/RB/WR/TE columns stay for NFL
}
model PlayerIdentityMap {
  // + sportradarId String?   (only if Sportradar is chosen)
  // + eliteProspectsId String? (only if EP is chosen)
  // + mlbamId String?          (only with an MLBAM licence)
}
```

⚠ **The `RookieRanking` change needs its readers changed in the same PR.** `lib/adp-data.ts:291`
and `trade-analyzer-intel.ts:41` must filter `sport: 'NFL'`. The default keeps existing rows
NFL, but an unfiltered reader would mix sports the moment the first MLB row lands. That is the
same silent shape CLAUDE.md warns about.

Migration safety: every addition is a nullable column or a new table, so the migration is
additive. Defaults make existing rows NFL. The `RookieClass` PK change is the only rewrite.
Defer it unless the owner wants non-NFL class strength.

### 4.3 Rookie eligibility rules (replacing `gamesPlayed === 0`)

Computed by an ingestion-side job into `RookieEligibilityRecord`. They are **never** computed at
request time.

| Sport | Rule (default; league-overridable later) | Inputs | Season key |
|---|---|---|---|
| MLB | Rookie-eligible while career MLB **AB < 130 AND IP < 50** (active-days clause omitted: we do not store service time) | Career MLB totals from our own RI MLB `player_season_stats`/`fantasy_stat_lines` summed over seasons, or vendor career totals. Prospects with `proDebutDate = null` → eligible | MLB season = calendar year |
| NHL | Eligible while **drafted (or signed) AND career NHL GP < 25** (configurable, e.g. 82). Undrafted junior players are prospects, not rookie-draft eligible until drafted | `ProspectPlayer.draftYear/rightsOrg` + RI NHL career GP | Season labelled by start year (2026 = 2026-27) |
| NBA | Eligible for season S's rookie draft iff `draftYear = S` (drafted in June of S), or undrafted signee whose first NBA season is S | Draft class from vendor; first-season from RI NBA rosters | Season labelled by start year; **never** calendar year (fixes the Jan-1 bug in `rookieFilterPredicate.ts:52`) |

Draft-room wiring once the table exists:

1. `getResolvedDraftPoolForLeague` loads `RookieEligibilityRecord` for (sport, league season)
   in one query and sets `isRookie` from it. `extractRookieHint`'s `gamesPlayed===0` branch is
   then **deleted**, not kept as a fallback, because a weaker guess stacked on a real verdict
   only adds false positives.
2. Prospects not on any pro roster (`ProspectPlayer.status = 'prospect'`, no identity link)
   are **added** to rookie/FYPD pools as `poolType: 'prospect'`, alongside the existing
   devy merge in the same resolver.
3. `applyDraftModePoolFilters`' whole-pool fallback (`:931`) stays, but it should **say so**:
   record `rookieDataState: 'no_rookie_metadata'` (already modelled in
   `draftPlayerRookie.ts:35-46`) so the UI can tell the commissioner the filter is inactive.
   This could ship before any vendor is chosen, but it touches UI copy, so it is left to the
   owner.

### 4.4 Identity linking

- MLB/NHL/NBA pro identity is `PlayerIdentityMap` keyed by `rollingInsightsId` (the
  `ingestMlbFantraxIdentities` pattern). Prospects link **on graduation**: when a
  `ProspectPlayer` appears on an RI roster, match by vendor id where the vendor exposes one
  (Sportradar NBA prospects expose the NBA id once drafted), otherwise by exact normalized
  name + birth date + org. **Never name alone.** `planMlbFantraxIdentityLinks`' "exactly one
  candidate, else refuse" rule is the template.
- NBA prospects from NCAA link to `DevyPlayer` (NCAAB) by name + school + birth year, and
  `DevyPlayer.graduatedToNFL` gets a sport-neutral sibling (`graduatedToPro`) **only if** the
  owner approves touching that model. Otherwise the link lives on `ProspectPlayer`.

---

## 5. Ingestion design (copy of the CFBD/devy shape)

| Layer | CFBD precedent | Proposed |
|---|---|---|
| Adapter: every export a live fetch, allowlisted only because its sole runtime importer is ingestion | `lib/cfb-player-data.ts` | `lib/prospects/<vendor>Fetch.ts`, one per chosen vendor. Host added to `DATA_API_HOST_PATTERNS` in `scripts/check-db-first-api-boundary.mjs` **in the same commit**, with a base-URL constant in `DATA_API_IDENTIFIERS` (the `lib/cfbd-base-url.ts` lesson) |
| Ingestion: writes the table | `lib/devy-classification.ts` → `DevyPlayer` | `lib/prospects/ingestProspects.ts` → `ProspectPlayer`; `lib/prospects/computeRookieEligibility.ts` → `RookieEligibilityRecord` |
| DB-first read used by request paths | `lib/devy/devyPlayerReads.ts` | `lib/prospects/prospectReads.ts`. The draft resolver and any prospect UI read only this |
| Scheduled writer | `/api/cron/import-players`, `devyPool → devyStats → devyIntel` phases | A new phase inside **`/api/cron/import-players?intel=1`**, next to `mlb-fantrax-identities`. Weekly-gated by a `sportsDataCache` marker exactly like `ingestMlbFantraxIdentities.ts:7-10`, admitted only with ≥ N s of `budget.remainingMs()`, resumable, and it records `deferred` when skipped |

Cadence: weekly in season, and **daily for the 7 days after** each sport's draft (MLB July, NBA
late June, NHL late June), gated by date inside the phase. No new schedule entry. The cron count
stays at 60. `cron-budget-check.mjs` rule 2 forbids a `?sport=` variant on the same schedule
anyway.

Credentials, logging and 304 handling follow CLAUDE.md: the token never goes in a logged URL,
and a 304 is never read as "empty" without a cache-busted retry. Each new vendor gets a
`contracts/<vendor>/` directory with `ENDPOINTS.yaml`, `GAPS.md`, `scripts/probe.sh` and
committed fixtures **before** the adapter is written. That is the shape authority rule, applied
to ourselves.

**The scheduled writer ships in the same PR as the read.** CLAUDE.md is explicit that a read
pointed at a table nothing refreshes "fails silently and looks correct". The NCAAB devy pool
appears to be in exactly that state today (§2.3). Fixing it is item P0-b below.

---

## 6. Phased plan

| Phase | Scope | Needs owner? | Effort (one engineer) |
|---|---|---|---|
| **P0-a** | Measure, no probe: read the `fantrax:mlb-identities:last-run` marker (`provided`, `unmatched`), count non-NFL `sports_players` rows whose `stats` has a 0 GP, and count NCAAB `DevyPlayer` rows by `lastSyncedAt` | DB read access only | 0.5 day |
| **P0-b** | Give the NCAAB devy pool a scheduled writer in the `?intel=1` tick (weekly-gated), or retire the read. Already in-repo data, no vendor | Yes (touches a cron handler) | 1-2 days |
| **P0-c** | Fix the `rookieFilterPredicate` calendar-year bug (use league season), and surface `rookieDataState` when `rookies_only` falls back to the whole pool | Yes (draft behaviour/UI copy) | 1 day + tests |
| **P1** (NBA) | Contract dir + adapter for the chosen NBA source, `ProspectPlayer` + `RookieEligibilityRecord` migrations, `RookieRanking.sport` (with reader filters), ingestion phase, draft-resolver wiring, delete the `gamesPlayed===0` branch for NBA | Vendor + migration approval | 6-9 days |
| **P2** (MLB) | Vendor contract + adapter, MiLB universe ingest, MLB rookie-limit computation from our RI MLB stats, FYPD pool after the July draft, `MINORS`/`PROSPECT` slot eligibility | Vendor + budget | 8-12 days |
| **P3** (NHL) | Elite Prospects contract + adapter (region-scoped), draft-rights linking to NHL clubs, NHL GP-threshold rule, prospect pool | Vendor + budget | 8-12 days |
| **P4** | Rankings/values per sport (`RookieRanking.sport`, a sport-aware `RookieClass`), AI/trade-intel prompts made sport-aware | Content source decision | 3-5 days |

The estimates assume the vendor contract is signed and a probe fixture exists. Add 1-3 days
per vendor for contract-directory work and identity tuning.

---

## 7. Decisions the owner must make

1. **D-1 Which sport first.** Recommended order: NBA (smallest class, half built, verified
   vendor endpoint), then MLB (largest dynasty need, largest data problem), then NHL.
2. **D-2 Which vendor to pay for, per sport.** NBA: Sportradar NBA Draft API, or no new vendor
   (rookies only, no pre-draft prospects). MLB: Sportradar vs SportsDataIO (both need a sales
   call confirming *full* MiLB system and draft coverage), or pursue an MLBAM Stats API
   licence. NHL: Elite Prospects (which regions), with or without Sportradar for draft rights.
3. **D-3 Budget ceiling** per sport per month. No candidate publishes prices except
   SportsDataIO's entry tier ($99-149/mo, secondary source). RI's own pricing is in
   `contracts/rolling-insights/ENDPOINTS.yaml:614-645`, which also names the Breakaway
   Accelerator discount.
4. **D-4 Legal review of terms.** Do not use MLB Stats API or the NHL web API commercially
   without written permission. Get RI's "competitive to ours" clause answered
   (`ENDPOINTS.yaml` `competitive_clause`) before relying on RI for any new fantasy surface.
5. **D-5 Schema approval.** Approve, amend or reject the §4.2 migrations: the new
   `ProspectPlayer` and `RookieEligibilityRecord` tables, `sport` on `RookieRanking`, and the
   `RookieClass` PK change (which can be deferred).
6. **D-6 One RI probe?** Allow `scripts/probe.sh player-info {MLB,NBA,NHL}` with fixtures
   committed (per the CLAUDE.md rule), or ask RI directly, to learn whether `player-info`
   carries draft or debut fields. That could cover NBA/NHL rookie detection at no extra cost.
7. **D-7 Default rookie rules.** MLB 130 AB / 50 IP; NHL GP threshold (25? 82?); NBA = draft
   class. Also: should commissioners be able to override per league?
8. **D-8 NCAAB devy writer (P0-b).** Schedule it in the `?intel=1` tick, or retire the NCAAB
   read until a vendor is chosen.
9. **D-9 Rankings.** Should prospect *rankings* (Baseball America, FanGraphs, EP) be licensed,
   or computed in-house from stats and draft capital? This is a separate contract from the
   player universe.
