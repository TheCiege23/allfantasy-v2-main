# Fantrax reserve identity review — 2026-10-06

Twelve user-supplied roster CSVs prove the names/positions for 466 unique Fantrax IDs. Historical CFBD IDs below were checked against provider search and official biographies. A historical link does not prove 2026 eligibility. CFBD's 2026 FBS roster contains Bryson Barnes, but Utah State's March 2026 Pro Day release calls him a former Aggie; the conflict is retained.

| Fantrax ID | Name | Role | CFBD historical ID | 2026 availability | Evidence |
|---|---|---|---|---|---|
| 05khp | E.J. Smith | RB | 4430825 | college_inactive | [Official source](https://www.chiefs.com/news/breaking-down-the-chiefs-2026-undrafted-free-agent-class-) |
| 05zra | Antonio Gates | WR | 4685359 | needs_verification | [Official source](https://msuspartans.com/sports/football/roster/antonio-gates-jr/13017) |
| 04zh9 | Donavon Greene | WR | 4567033 | needs_verification | [Official source](https://hokiesports.com/news/2025/08/23/virginia-tech-football-position-preview-wide-receivers-2025) |
| 05ny7 | Bryson Barnes | QB | 4695600 | college_inactive | [Official source](https://utahstateaggies.com/news/2026/3/18/utah-state-football-holds-annual-pro-day.aspx) |
| 04zjh | Jacob Clark | QB | 4569535 | college_inactive | [Official source](https://www.raiders.com/news/raiders-sign-17-undrafted-free-agents-2026-nfl-transactions) |
| 05mu0 | Kentrel Bullock | RB | 4430992 | college_inactive | [Official source](https://www.bengals.com/news/five-draft-picks-college-free-agents-signed-2026-transactions) |
| 069b6 | Jeffery Pittman | RB | 5152209 | needs_verification | [Official source](https://southernmiss.com/sports/football/roster/jeffery-pittman/10172) |
| 05lol | Malik Sherrod | RB | 4607267 | needs_verification | [Official source](https://broncosports.com/news/2026/2/19/football-boise-state-announces-pro-day-date) |
| 05w3m | Landon Sims | RB | 4875791 | college_inactive | [Official source](https://hawaiiathletics.com/story.aspx?file_date=3%2F19%2F2026&filename=football-pro-day-spotlight-rainbow-warriors-take-the-stage-in-sacramento) |
| 05jvj | Kenny Tracy | RB | 4431432 | needs_verification | [Official source](https://miamiredhawks.com/sports/football/roster/kenny-tracy/10405) |
| 05zuk | Camden Brown | WR | 4808759 | college_inactive | [Official source](https://gseagles.com/news/2026/7/29/football-six-former-eagle-players-report-to-nfl-camps) |
| 05owb | Joey Hobert | WR | 4432267 | college_inactive | [Official source](https://txst.com/sports/football/coaches) |
| 05m2h | Trayvon Rudolph | WR | 4433906 | college_inactive | [Official source](https://www.vikings.com/news/michael-briscoe-trayvon-rudolph-wide-receivers-signed-roster-moves) |
| 077wg | Ryder Lyons | QB | Unavailable | prospect | [Official source](https://byucougars.com/ryder-lyons-2026-byu-football-recruiting-class) |

## Scheduled backfill defect

The prior heuristic accepted missing schools, fell back to name alone when schools disagreed, ignored positions, and overwrote established links. Between audits it assigned E.J. Smith RB to Nevada LB 5296359, Jacob Clark QB to Glenville State LB 5227943, and Landon Sims RB to Wyoming QB 5296625. Their correct historical IDs are 4430825, 4569535 and 4875791. No 2026 weekly scores were found for those three Fantrax IDs during the audit.

The fix requires positive name, school and position agreement, preserves established links and guards concurrent updates. Missing role or school is refused.

## Repair and scoring

`scripts/repair-ncaaf-fantrax-reserve-identities.ts --snapshot=<owned-snapshot-uuid>` is a dry run by default; add `--apply` after reviewing it and deploying the backfill fix. Run via Node with `--conditions=react-server --import tsx` and the intended database environment. The script verifies source membership, names/positions, live historical provider search and unique source ownership; any other existing-link conflict stops the repair. It backs up the registry before a serializable transaction, updates 13 source-owned CFBD edges and stores season evidence. It never deletes UUIDs, infers current schools or writes scores. Existing RI identities and references remain intact. Nine historical canonical records therefore remain alongside their source-owned imported identity; no unsupported UUID consolidation is attempted.

For these 14 Fantrax IDs only, 2026 missing rows remain unavailable with an explicit reason: eight verified former/professional/coaching records, five needing current-season verification, one prospect. An old school's bye or ingested final game cannot manufacture zero points. Actual season game evidence may resolve a player needing verification; rows conflicting with confirmed inactive/prospect evidence are withheld and warned. Future seasons and native roster namespaces are unaffected. Ryder Lyons keeps his source identity; no CFBD ID is fabricated.

A second repair run must propose zero writes. Regression tests cover namesakes, conflicting school/position, absent evidence, immutable links, concurrent updates, inferred zeros, provider-status conflicts and native isolation.
