# Fantrax contract gaps

Unknowns about Fantrax's `fxea` read API that code in this repo works around rather than resolves.
Per CLAUDE.md: do not call Fantrax to settle these. Each needs a committed capture (a public league,
no credentials — the `fxea/general` endpoints are unauthenticated) before the workaround can be
replaced by a rule.

Committed league captures: MLB (`tests/fixtures/fantrax/mlb-points-public.json`,
`mlb-player-map-public.json`) and, since 2026-10-26, four real public PRE-DRAFT leagues captured
with the owner's consent — `nba-public-2026.json`, `nhl-public-2026.json`, `nfl-public-2026.json`
(IDP) and `epl-public-2026.json`, each holding `getLeagueInfo` (scoring, roster, playoff settings
verbatim; playerInfo trimmed), `getTeamRosters`, `getStandings`, `getDraftPicks`,
`getDraftResults`, plus `nba-player-ids-public.json` / `nhl-player-ids-public.json` slices. League
ids, names and team identities are replaced with placeholders. Pinned by
`tests/fantrax-public-2026-captures.test.ts`.

⚠ **A PRE-DRAFT LEAGUE HAS EMPTY ROSTERS**, so the roster-id sport detection named nothing and the
import refused it. `getLeagueInfo.playerInfo` (the league's whole player pool) is the same id space
and now decides the sport when every roster is empty: 1,287/1,287 NBA pool ids in the NBA map and 0
in NHL; 8,757/8,757 NHL in NHL and 0 in NBA. Each scoring group's `group.code` also names the sport
(`BASKETBALL_PLAYER`, `HOCKEY_SKATING`/`HOCKEY_GOALIE`, `FOOTBALL_OFFENSE`/`_DEFENSE`/`_KICKING`,
`SOCCER_GOALIE`/`SOCCER_NON_GOALIE`, MLB `BASEBALL_HITTING`/`_PITCHING`), but football's does not
separate NFL from college, so the pool is what is used.

## F-01 — NBA / NHL `getPlayerIds` — **RESOLVED 2026-10-26**

Same id-keyed shape as MLB/CFB, plus `rotowireId`, `sportRadarId` (and `statsIncId` on NHL). One
position per row in the captured slices (`PG`, `SG`, … ; hockey `C`/`LW`/`RW`/`D`/`G`); a player
with no club reads `team: "(N/A)"`. The original note follows.

### (original) NBA / NHL `getPlayerIds` is not captured

`getPlayerIds?sport=NBA` and `?sport=NHL` are read by `importFantraxLeague` for sport detection and by
`ingestProFantraxIdentities` for identity links. They are assumed to have the same id-keyed
`{ fantraxId, name: "Last, First", team, position }` shape as the captured MLB/CFB maps.
`getAdp?sport=NBA` WAS verified (2026-10-13, see `fantraxApi.ts`), which shows the `NBA` code is
accepted — not that `getPlayerIds` answers it, nor what `team`/`position` spellings it uses.

Workaround: a map that fails to load fails soft (the import needs only the league's own sport), and
the identity matcher refuses on an unrecognised team label rather than guessing.

**Needed:** a trimmed `getPlayerIds?sport=NBA` and `?sport=NHL` slice (a few rows each, including a
two-position player and, for NHL, a goalie) committed under `tests/fixtures/fantrax/`.

## F-02 — How an NBA/NHL league labels its season — **RESOLVED 2026-10-26**

`seasonYear` is the number of the year the season BEGINS: `2026` for both the NBA league
(`startDate` 2026-10-26) and the NHL league (2026-09-29) of 2026-27 — exactly the key we use.
The original note follows.

### (original) How an NBA/NHL league labels its season

`seasonYear` is `2023` (a number) on the MLB capture. For a basketball/hockey league it is unknown
whether Fantrax sends `2025`, `2026` or `"2025-26"` for the 2025-26 season. We key those seasons by the
year they BEGIN. `fantraxSplitSeasonStartYear` reads, in order: a range label → the league's own
`startDate` / `scoringPeriods[].startDate` → a bare number → the season in progress.

**Needed:** `getLeagueInfo` for one public NBA and one public NHL league (the `seasonYear`,
`startDate`, `endDate` and first `scoringPeriods` entry are enough).

## F-03 — NBA/NHL slot codes — **RESOLVED for these two leagues, 2026-10-26**

NBA: `C`, `G`, `F`, `Flx` (all-position utility → `UTIL`). NHL: `D`, `F` (→ C/W flex), `G`.
⚠ The NBA league sends **no `maxTotalReservePlayers`** (only 14 total / 10 active), which dropped
its bench; total − active now stands in. Other leagues may use more codes; unknown ones still report.
The original note follows.

### (original) NBA/NHL `rosterInfo.positionConstraints` slot codes

Only MLB's codes are captured (`C`, `1B`, …, `UT`, `CI`, `MI`, `P`). The NBA/NHL mapping in
`mapFantraxRosterSlots` accepts our catalog's own codes plus `UT`, and reports anything else as
`rosterSlotGaps` instead of coercing it. Combined slots (`G/F`, `F/C`, hockey `F`, `Skt`) are mapped
only where the meaning is unambiguous.

**Needed:** `getLeagueInfo.rosterInfo` from a public NBA and NHL league, ideally one with a
combined/flex slot.

## F-04 — Minors / IR roster limits and statuses

`getTeamRosters` `status` values captured: `ACTIVE`, `RESERVE`. `INJURED_RESERVE` and `MINORS` appear
only in synthetic tests. NBA/NHL `MINORS` is carried as the taxi squad; an unrecognised status falls
to bench (never IR). `rosterInfo` keys for minors/IR limits (if any) are not captured, so native
taxi/IR slot counts are not imported.

**Needed:** `getTeamRosters` + `getLeagueInfo.rosterInfo` from a public dynasty league that uses
minors and IR slots (any sport).

## F-05 — Future draft picks (dynasty)

`getDraftPicks.futureDraftPicks` was EMPTY in the only league measured (see `fantraxApi.ts`), so its
element shape — and whether it reflects traded ownership (original vs current team) — is unverified.
`lib/league-trade-engine/importedFuturePicks.ts` therefore stays Sleeper/MFL only; a Fantrax league
shows no future picks rather than listing every pick with its original team.

**Needed:** `getDraftPicks` from a public dynasty league in which at least one future pick has been
traded.

## F-06 — No dynasty / keeper flag in `getLeagueInfo`

Nothing in the captured `getLeagueInfo` says redraft, keeper or dynasty. Imported Fantrax leagues keep
`isDynasty = isDevy` as before. Deriving it from F-04/F-05 evidence (minors slots, future picks) is
plausible but would be a guess today.

**Needed:** the full `getLeagueInfo` body of a known dynasty or keeper league, to look for the flag.

## F-07 — Category scoring

`scoringSystem.type` is `POINTS_BASED` on the capture. For any other type `fantraxScoringRules`
returns a gap, and `importedMlbScoring` (native conversion) only understands ESPN's category
`scoringItems`, so a Fantrax category league is refused at "make this league native". Which
categories a Fantrax category league scores — and in which field — is not captured.

**Needed:** `getLeagueInfo.scoringSystem` from a public H2H-categories and a roto league (MLB first;
NBA/NHL when F-02 is closed).

## F-08 — NBA/NHL points scoring codes — **RESOLVED 2026-10-26**

`scoringSystem.type` is `HEAD_TO_HEAD_POINTS_BASED`. Codes are shared across sports and only the
GROUP tells them apart — `INDIVIDUAL_SAVES` was being read as a baseball save in a hockey league.
`fantraxScoringRules` now resolves by group first (`GROUP_CATEGORY_KEYS`). Captured: basketball
PTS/REB/AST/ST/BLK/TO; hockey skater G/A/SOG/PPP/SHG/Hit/Blk/PIM, goalie W/SV/GA/SHO/A/PIM (goalie
and skater PIM share one rule and a different value is reported). Football also gained FL, thrown
INT, XP, FG and the IDP defence group. The original note follows.

### (original) NBA/NHL points scoring codes

`fantraxScoringRules` maps football and baseball `scoringCategory.code`s only. Basketball/hockey codes
are unknown, so every NBA/NHL rule is reported as a gap (the import still completes; native conversion
would refuse).

**Needed:** `getLeagueInfo.scoringSystem.scoringCategorySettings` from a public NBA and NHL points league.

## F-09 — Prior seasons

`previousSeasons` lists only snapshots this repo has already stored for the same league name. No
captured endpoint maps a league id to its prior-season league ids, so multi-season backfill remains
Sleeper-only.

## F-10 — Does `getPlayerIds?sport=MLB` (or `NHL`) include minor leaguers / prospects? (recorded 2026-10-20, no probe)

`ingestProFantraxIdentities` (`MLB`, and since its generalisation `NHL` and `NBA`) reads this universe weekly but keeps only players it can link to an
existing Rolling Insights row, so any minor leaguer in it is counted as `unmatched` and discarded.
There is **no `getPlayerIds` fixture**, and `FantraxPlayerRef` carries only id, name, team and
position — no level, status or draft field. So even if minor leaguers are present, nothing would
mark them as prospects.

**Blocks:** an MLB prospect layer in the draft pool from data we already fetch.
**Needed, without a probe first:** read the `sportsDataCache['fantrax:mlb-identities:last-run']`
marker (`provided` vs `unmatched`; `fantrax:nhl-identities:last-run` for NHL) to size it. If it is worth pursuing, capture one
`getPlayerIds?sport=MLB` response as a committed fixture and check for a level/status field.
