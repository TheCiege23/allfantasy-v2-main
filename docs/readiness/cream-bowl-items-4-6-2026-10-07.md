# Cream Bowl readiness: items 4–6

Evidence captured October 6–7, 2026. Scope: the owned Fantrax Cream Bowl import and its linked NCAAF season.

## 4. Conversion data and mapping

Fantrax `INDIVIDUAL_TWO_POINT_CONVERSIONS_SCORES` covers rushing and receiving conversions. Passing credit is excluded. The scorer and commissioner panel preserve those roles independently; explicit role counts supersede a legacy aggregate count.

ESPN summary game `401856697`, scoring play `401856697700`, explicitly records KJ Jackson passing to Sutton Smith for a successful two-point conversion. Cross-provider game ID, school, full name and athlete ID agreement identify Smith (`4805256`) as the receiver. His conversion closes Georgia's two-point period-4 gap. Jackson's passing try contributes no points to this league's conversion-scores category.

The enrichment path is separate from the settled CFBD box-score ledger. It uses bounded requests, deduplicates play IDs, replays cached evidence after box-score refreshes, removes retracted evidence only after a verified refresh, and reports unavailable or ambiguous evidence. Optimistic updates protect concurrent corrections. Failed, defensive, unnamed or mismatched tries are not credited. An XP deficit selects a game to inspect; it never becomes a player stat.

## 5. Native history and calendar

The native season, matchup, schedule and standard head-to-head standings views project preserved Fantrax results. Source-owned matchups are read-only. Current period is resolved from Fantrax's dated calendar, including the source playoff boundary, rather than a default week 1.

Production verification: current period 6; 12 mapped teams; 60 regular-season fixtures; 30 finalized matchups; 30 unplayed fixtures; five completed periods; zero schedule validation issues. Unplayed scores remain null. A genuine played 0–0 tie remains final. Stable team IDs preserve mapping after team renames. Missing or ambiguous ownership is refused.

The calendar is stored in dedicated import metadata so rebuilding the generic Fantrax settings does not discard it. An identical metadata sync reports `changed: false`.

## 6. Scoring evidence and provenance

The ingestion writer now records the actual provider on both insert and correction. With explicit user approval, 16,479 period-4/5 player-game rows were checked field by field against fresh CFBD responses before provenance and verified conversion evidence were repaired. A backed-up, guarded production repair changed only stat payloads, normalized stat maps and provider provenance. It did not write individual fantasy-point values, published team totals or winners. Repeat dry run: zero planned player-stat changes.

57 athlete-role conversion evidence records were resolved. Eight unmatched athlete roles in other college games remain named coverage gaps; they are not inferred or silently marked verified. Candidate selection uses available offensive TD/XP data and previous conversion evidence; it does not establish universal conversion coverage for defensive-return-only scoring.

Fresh Fantrax `getTeamRosters` responses contain player ID, position and status, without individual actual points. `getMatchupScores` supplies team totals and team categories. The scoped individual-source-score table contains zero rows for these two periods. The API and matchup display explicitly disclose that limitation. The supplied roster CSV projections are not treated as actual scores.

## Completed-period comparison

| Period | Independent comparison | Winner comparison | Evidence |
| --- | --- | --- | --- |
| 4 | 12/12 team totals reproduced | 6/6 | Verified Sutton Smith receiving conversion; Bryant Wesco punt-return TD |
| 5 | 11/12 with current CFBD lines after replaying the verified Marcel Williams identity correction; 12/12 with ESPN's final Jackson Arnold passing line | 6/6 | Jackson Arnold rushing conversion; Willie Rodriguez receiving conversion |

Period 5 identifies two distinct issues. Marcel Williams's existing identity points at CFBD roster ID `4244849`, while the fresh CFBD and ESPN Akron game records use `5193341`; its separate production correction requires explicit approval. Jackson Arnold's CFBD passing line is 177 yards, while ESPN's final line is 172. Fantrax's team passing category agrees with the 172-yard line. The resulting CFBD comparison difference is +0.20 points. The fixture records the disagreement and independently demonstrates that ESPN's explicit line reproduces the source total without changing scoring weights. Published Fantrax actuals remain authoritative.

## Verification and limits

Captured scoring fixtures and regression tests cover both completed periods, conversion roles, correction replay, concurrency, provenance, ownership, team renames, standings, missing future scores and rendered source-score labels. Release gates and deployment evidence are recorded separately with the release.

These items do not certify full individual-player parity: Fantrax has not supplied individual actual points. The previously identified eligibility cases and Ryder linkage are separate readiness work. Offensive fumble-recovery TD and every future special-event category still require athlete-level evidence when such an event occurs.

Primary evidence endpoints: [Fantrax league information](https://www.fantrax.com/fxea/general/getLeagueInfo), [CFBD player game statistics](https://api.collegefootballdata.com/games/players), [ESPN Arkansas conversion summary](https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=401856697), [ESPN Jackson Arnold final box score](https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=401858247), [ESPN Marcel Williams game record](https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=401866430).
