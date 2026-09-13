# AllFantasy Trade System: Research and Valuation Audit

**Audit date:** September 13, 2026  
**Scope:** redraft, dynasty, keeper, IDP, kicker, devy/college, FAAB, draft picks, pending offers, completed history, mobile access, and Decision OS alignment.

## Current verdict

The trade system is **about 74% complete overall**. The foundation is stronger than the visible product suggested: AllFantasy already has league-specific value books, a rich trade engine, pending Sleeper offer discovery, IDP and kicker valuation modules, roster/context adjustments, counteroffer logic, manager tendencies, current-market native history regrading, and a distinctive multi-year realized-outcome grader. The main issue is fragmentation. The simplest pending-offer surface does not always call the richest engine, several asset classes have weak or incomplete market coverage, and historical provider data is uneven.

| Area | Completion | Audit finding |
|---|---:|---|
| Trade discovery and inbox | 78% | Sleeper pending offers are read and pre-evaluated. Yahoo has a pending reader. ESPN, Fantrax, MFL, and Fleaflicker do not expose equivalent complete inbox behavior in AllFantasy. |
| Mobile access | 96% | This release pins Trades in Core and league mobile navigation. Trade cards and tables already collapse for phones. Real-device browser testing remains. |
| Offensive-player valuation | 82% | Format-matched FantasyCalc values, scoring fit, age, volatility, role and roster context exist. The production path still needs one canonical evaluator. |
| Draft-pick valuation | 66% | Year, round, slot, format and time discount exist. Class strength and probabilistic pick slot need stronger modeling. |
| IDP valuation | 61% | League-scored VORP and position-specific logic exist, but the global market snapshot contains no defenders and the Core pending path can therefore withhold IDP grades. |
| Kicker valuation | 50% | A league-aware conservative/flat method exists and is defensible, but opportunity, dome/weather, offense and job-security signals need fuller use. |
| College/devy valuation | 39% | The engine recognizes devy/college assets and prospect fields. Identity and market coverage remain too incomplete for dependable automatic grades. |
| FAAB valuation | 31% | FAAB is recognized and one documented heuristic exists. The older engine's `amount / 10`, capped at 25, is much too crude. |
| League/roster strategy | 73% | Need, depth, starter impact, contender/rebuild direction, scarcity and partner tendencies exist. Several inputs are partial or not consistently used on every surface. |
| Historical regrading | 70% Sleeper / 55% native / 24% other providers | Native player-only history now gets a current-market regrade from one league-specific value book. Sleeper can follow up to 12 linked seasons and score assets only while held. Consumed picks, FAAB, missing player identities, and other imported providers still need fuller outcome mapping. |
| Proposal/counter/decline history | 62% native / 15% imported | This release exposes privacy-filtered native closed states and existing counter chains. Imported provider history is mainly completed trades; declined/expired offers often are not available from provider APIs. |
| Decision OS integration | 68% | Canonical assets and read-time trade memos exist. A persisted canonical trade memo for every provider event is still missing. |

## What this release changes

- Trades is now one of the five primary mobile Core destinations instead of being buried under **More**.
- Every league page with a Trades tab now has a pinned mobile **Trades** shortcut.
- The league trade log is grouped by season and can be filtered by year.
- **Your trades** is also separated by season.
- Sleeper completed trades display two honest realized grades: **First** (the first scored season) and **Now** (the cumulative result through the latest scored season).
- Native completed trades are visible league-wide; rejected, cancelled, countered, expired and vetoed negotiations are visible only to their participants and commissioners.
- New native proposal snapshots now select the league's real redraft/dynasty/keeper, 1QB/superflex and standard/half-PPR/PPR value book. Fully priced proposals save a proposal-time grade; incomplete and FAAB-containing offers withhold that grade instead of laundering fallback values into a verdict.
- Native historical trades now receive a separate **Now** grade from today's league-specific market values when every original asset still resolves. The proposal's **Then** snapshot is never overwritten. Consumed picks and unresolved assets show why a current grade is unavailable.
- Pending and completed rows keep their existing phone-friendly stacked layout.

No database migration is needed for these UI and grouping changes.

## How online trades actually work

The platform workflow is stateful, not a single calculator action. A proposal is sent, may be modified, countered, cancelled, declined, accepted, reviewed or vetoed, then processed. ESPN displays pending moves to both managers, supports configurable review periods, and can auto-cancel unanswered offers. Yahoo allows accept, reject and counter actions, gives an offer up to ten days for a response, limits pending offers, and can require commissioner or league review. Sleeper supports players, picks, FAAB, counteroffers and trade-block signals; its draft-pick rules differ between redraft and keeper/dynasty.

That leads to a product requirement: AllFantasy needs an immutable event timeline for every offer state, plus a value snapshot at each material event. A single `status` field and a current calculator result cannot reconstruct what the offer looked like when proposed, countered, accepted and processed.

## Required grade model

Every completed trade should keep three grades separate:

1. **Then — market grade:** values and league context captured when the offer was proposed, countered and accepted.
2. **Now — market regrade:** today's values applied to the original assets, with drafted picks resolved to the selected player when known.
3. **Outcome grade:** fantasy production, lineup value, playoff impact and championships actually produced while each acquired asset remained on that roster.

The current Sleeper grader already provides the third view and now exposes its first-season and cumulative grades. Native history now provides the second view for trades whose original assets all still resolve in today's league value book. It cannot honestly recreate a proposal-time market grade for dates before AllFantasy began storing daily value snapshots. Old trades should display **Then value unavailable — predates value history**, never a fabricated C.

## Visual and calculation audit by asset type

### Offensive players

The visual structure makes sense: each manager, assets sent, asset values, side totals, grade, confidence and a direct provider link. The strongest behavior is the full-coverage guard: if one player is unpriced, the system withholds a grade instead of treating the player as zero. Fine tuning is still required for package tax, starting-lineup displacement, best-ball depth, player correlation, replacement level by league size, and consistent use of the full engine on pending imported offers.

### IDP

IDP cannot share one global chart with offensive players. Value depends heavily on exact scoring, true position, required starters, positional depth, snap role and tackle/pass-rush opportunity. AllFantasy has league-scored IDP VORP and recognizes DL/LB/DB subpositions, which is the right direction. The gap is delivery: `PlayerValueSnapshot` has no defenders, so any surface that relies only on that table cannot price an IDP trade. The canonical evaluator must inject the league IDP board before grading.

### Kickers

A conservative flat value is safer than pretending year-to-year kicker rank is stable. It still needs tiers for job security, team scoring opportunity, field-goal attempt distribution, long-distance bonuses, dome/weather exposure and replacement availability. Kicker value should remain low in shallow one-kicker formats and rise only in deep, multi-kicker or premium-scoring leagues.

### College and devy players

The engine recognizes these assets, but reliable automatic values require canonical identity, eligibility rules, devy roster limits, prospect class, expected draft capital, age, breakout age, production share, competition level, athletic testing, transfer/coach changes and declare/return risk. Until coverage is measured and high, the UI should show a confidence/coverage label beside every college value.

### FAAB

Linear dollars-to-value is insufficient. Ten dollars in Week 2 with an elite injury replacement available is different from ten dollars in Week 13, and ten dollars is different when it represents 10% versus 50% of a manager's remaining budget. The model must use original budget, remaining budget for both teams, week, waiver quality, free-agent depth, rollover rules, minimum bid, trade deadline and competitor budgets. The current heuristic should remain visibly labeled until replaced.

### Draft picks

The current year/round/slot/time-discount basis is sound but incomplete. Pick value must be a distribution, especially before draft order is set. Projected finish, max points for, schedule, injuries and playoff odds should produce early/mid/late probabilities. Class strength, positional composition, superflex demand, rookie draft date and pick liquidity should then adjust that distribution. Package tax must prevent five weak picks from automatically equaling one elite asset.

## 100 valuation signals the canonical engine should use

**Status key:** **Built** means a production module exists; **Partial** means the signal exists but coverage or wiring is incomplete; **Missing** means it should be added or persisted.

| # | Signal | Applies to | Status | Required use |
|---:|---|---|---|---|
| 1 | League type: redraft/dynasty/keeper | All | Built | Select present-season versus multi-year value horizon. |
| 2 | Superflex/2QB setting | QB, picks | Built | Raise starting QB scarcity and rookie-QB pick value. |
| 3 | PPR/half/standard scoring | Offense | Built | Select market book and scoring fit. |
| 4 | Tight-end premium | TE | Partial | Reprice TE production above the base chart. |
| 5 | Points per carry/first down | RB/QB/WR | Partial | Adjust role types favored by league scoring. |
| 6 | Big-play bonuses | Offense/K | Partial | Reward explosive profiles and long kicks. |
| 7 | Passing-TD and interception values | QB | Built | Adjust pocket/rushing QB relative value. |
| 8 | IDP scoring weights | IDP | Built | Score tackles, sacks, pressures, turnovers and bonuses. |
| 9 | Kicker scoring rules | K | Partial | Apply distance, miss and XP penalties. |
| 10 | Starting lineup slot counts | All | Built | Set replacement level and positional scarcity. |
| 11 | Bench depth | All | Partial | Change replacement supply and consolidation value. |
| 12 | Taxi squad size/rules | Prospects | Partial | Change cost of holding developmental assets. |
| 13 | IR slot rules | Injured players | Partial | Change the roster cost of injury stashes. |
| 14 | League team count | All | Built | Shift replacement level and market depth. |
| 15 | Best-ball format | All | Partial | Raise depth and weekly spike value. |
| 16 | Salary/cap contract rules | All | Missing | Convert player value to surplus contract value. |
| 17 | Keeper cost and escalation | Keeper | Partial | Compare production with next-year keeper price. |
| 18 | Trade deadline | All | Built | Reduce actionability after the usable window. |
| 19 | Playoff format and number of qualifiers | All | Partial | Set urgency and marginal playoff value. |
| 20 | Draft-pick trading rules | Picks | Partial | Reject illegal assets and years. |
| 21 | Team projected points | All | Built | Establish contender strength. |
| 22 | Current record | All | Built | Inform playoff/rebuild direction. |
| 23 | All-play record | All | Partial | Separate luck from roster strength. |
| 24 | Max points for | Dynasty/picks | Partial | Estimate true team strength and pick slot. |
| 25 | Playoff probability | All | Partial | Weight present versus future production. |
| 26 | Championship probability | All | Built | Measure marginal title equity. |
| 27 | Elimination status | Redraft | Partial | Prevent eliminated-team advice from overvaluing rentals. |
| 28 | Rebuild/contend classification | Dynasty | Built | Shift youth/pick versus veteran preference. |
| 29 | Roster age curve | Dynasty | Built | Detect timeline mismatch. |
| 30 | Starter quality by position | All | Built | Measure actual lineup upgrade. |
| 31 | Bench quality by position | All | Built | Measure expendable depth. |
| 32 | Positional surplus | All | Built | Identify assets a roster can move. |
| 33 | Positional need | All | Built | Add value only where an asset improves usable slots. |
| 34 | Replacement player availability | All | Partial | Compare trade asset with free alternatives. |
| 35 | Waiver-wire depth | All/FAAB | Partial | Reduce low-tier trade and FAAB value in shallow leagues. |
| 36 | Open roster spots after trade | All | Built | Reject or penalize illegal/forced-drop outcomes. |
| 37 | Forced-drop value | Packages | Partial | Deduct the best player that must be cut. |
| 38 | Starting-lineup displacement | All | Partial | Credit only points gained above the replaced starter. |
| 39 | Bye-week coverage | Redraft | Partial | Measure near-term lineup usability. |
| 40 | Schedule strength during fantasy playoffs | Redraft | Partial | Weight production in decisive weeks. |
| 41 | Player rest-of-season projection | Offense/IDP/K | Built | Core short-term expected output. |
| 42 | Weekly projection distribution | All | Partial | Distinguish floor, median and ceiling. |
| 43 | Points above replacement | All | Built | Put positions on a common league scale. |
| 44 | Value over replacement by starting slot | All | Built | Account for flex and superflex eligibility. |
| 45 | Expected points added to optimal lineup | All | Built | Measure team-specific benefit. |
| 46 | Historical fantasy production | All | Built | Anchor projections in observed results. |
| 47 | Recent production trend | All | Built | Detect improving/declining performance. |
| 48 | Opportunity trend | All | Partial | Track usage before box scores react. |
| 49 | Snap share | Offense/IDP | Partial | Measure role stability. |
| 50 | Route participation | WR/TE/RB | Partial | Separate real receiving roles from low snaps. |
| 51 | Target share | WR/TE/RB | Partial | Measure team passing-game share. |
| 52 | Air-yard share | WR/TE | Partial | Measure high-value target role. |
| 53 | Carry share | RB/QB | Partial | Measure rushing role. |
| 54 | Goal-line/red-zone share | Offense | Partial | Model touchdown opportunity. |
| 55 | Third-down/two-minute role | RB/WR/TE | Missing | Improve receiving-floor projection. |
| 56 | Quarterback pressure-to-sack tendency | QB | Missing | Model matchup and long-term stability. |
| 57 | Offensive line quality/injuries | QB/RB | Partial | Adjust efficiency and injury exposure. |
| 58 | Team pace and play volume | Offense/IDP | Partial | Scale opportunity. |
| 59 | Team pass/run rate over expectation | Offense | Partial | Detect coaching philosophy. |
| 60 | Coaching/play-caller change | All | Missing | Reprice role after scheme changes. |
| 61 | Depth-chart competition | All | Partial | Estimate role-loss risk. |
| 62 | Teammate injury/return timetable | All | Partial | Separate temporary from durable opportunity. |
| 63 | Player injury status | All | Built | Apply immediate availability. |
| 64 | Injury history by body part | All | Partial | Model recurrence and workload risk. |
| 65 | Games missed and durability | All | Built | Quantify availability history. |
| 66 | Practice participation trend | All | Partial | Improve near-term confidence. |
| 67 | Suspension/legal availability | All | Partial | Price known missed time without speculation. |
| 68 | Contract years remaining | Dynasty | Missing | Model role and team-control horizon. |
| 69 | Guaranteed money/dead cap | Dynasty | Missing | Estimate cut/trade security. |
| 70 | Trade-request/team-trade risk | Dynasty | Missing | Model destination uncertainty explicitly. |
| 71 | Age | Dynasty | Built | Apply position-specific career curve. |
| 72 | Position-specific aging curve | Dynasty | Built | Avoid one generic age penalty. |
| 73 | Remaining prime seasons | Dynasty | Partial | Convert current advantage to career value. |
| 74 | Time discount for future production | Dynasty/picks | Built | Discount distant outcomes. |
| 75 | NFL draft capital | Rookie/devy | Partial | Strong prior for opportunity and patience. |
| 76 | Expected future NFL draft capital | Devy | Partial | Price pre-draft prospects probabilistically. |
| 77 | College age and breakout age | Devy | Built | Identify early production. |
| 78 | College dominator/production share | Devy | Partial | Normalize team environment. |
| 79 | Early-declare probability | Devy | Missing | Model arrival timing and return-to-school risk. |
| 80 | Athletic testing/size-adjusted profile | Rookie/devy | Built | Add upside and role priors. |
| 81 | Competition level/conference | Devy | Partial | Normalize production context. |
| 82 | Transfer portal and depth-chart move | Devy | Missing | Reprice opportunity after school changes. |
| 83 | Rookie class strength | Picks/devy | Missing | Move whole class and position buckets. |
| 84 | Rookie class positional composition | Picks | Missing | Change pick utility by league needs. |
| 85 | Pick year | Picks | Built | Apply horizon. |
| 86 | Pick round | Picks | Built | Apply base hit-rate curve. |
| 87 | Exact pick slot | Picks | Built when known | Use slot-specific market value. |
| 88 | Early/mid/late pick probability | Future picks | Partial | Value uncertain picks as distributions. |
| 89 | Original owner's projected finish | Future picks | Partial | Update slot probabilities. |
| 90 | Pick liquidity in this league | Picks | Partial | Adjust for local supply and trade frequency. |
| 91 | Rookie-draft calendar/rookie fever | Picks | Built | Reflect predictable seasonal market movement. |
| 92 | Package/consolidation tax | Packages | Built | Stop quantity from automatically equaling elite quality. |
| 93 | Elite-asset scarcity premium | All | Partial | Price assets that cannot be replaced by bundles. |
| 94 | Market consensus value | Offense/picks | Built | Provide a neutral baseline from real trades. |
| 95 | Market trend over 7/30 days | All priced | Built | Detect rising/falling price. |
| 96 | Market disagreement/standard deviation | All priced | Built | Lower confidence when the market disagrees. |
| 97 | Trade frequency/liquidity | All priced | Built | Distinguish tested prices from thin estimates. |
| 98 | Manager's historical asset preference | All | Built | Personalize likely acceptance and counter. |
| 99 | League-specific trading behavior and hoarding | All | Partial | Detect local pick/position premiums and inactive markets. |
| 100 | FAAB remaining, week, opponent budgets and waiver target quality | FAAB | Missing/partial | Replace the flat formula with situational expected utility. |

## Highest-priority gaps and errors

1. **Unify evaluation paths.** Pending offers in every surface should call one canonical Decision OS trade evaluator. Today the full engine is richer than the lightweight Core pending calculation.
2. **Persist event-time snapshots.** Store proposed, countered, accepted, vetoed, declined, cancelled, expired and processed events with asset identities, league context, roster state, value source/version and grade. This is required for an honest **Then** grade.
3. **Do not label first-season outcome as proposal-time value.** They answer different questions. The UI change in this release labels it **First** and **Now** realized outcome.
4. **Fix IDP delivery.** Inject league-specific IDP VORP into every trade surface; the global player market table has no defenders.
5. **Replace the old FAAB curve.** Use remaining-budget share and expected waiver utility, not a fixed points-per-dollar shortcut.
6. **Model future picks probabilistically.** Use early/mid/late distributions tied to the original owner's strength and playoff odds.
7. **Measure college coverage.** Publish resolved identity/value coverage by league before enabling confident devy grades.
8. **Preserve provider truth.** Show proposed/declined/countered history only when the provider returns it or AllFantasy captured it live. Never infer missing events from the absence of a completed trade.
9. **Separate legality, fairness and recommendation.** A legal trade can be uneven; an even market trade can hurt a contender's lineup; a commissioner review should focus on rules/collusion evidence rather than calculator disagreement.
10. **Add outcome calibration.** Backtest the recommendation against later points, playoff equity and retained market value, split by format and asset class.

## Recommended build order

### P0: complete the live product

- Route every pending offer through the canonical league-aware evaluator.
- Add an immutable trade-event/value-snapshot record for new native and imported offers observed during sync.
- Add IDP, kicker, pick and FAAB coverage gates to every card.
- Keep the new mobile shortcuts and season timeline; verify on 375 px, 390 px and 430 px widths.

### P1: make historical grading complete

- Promote the existing **Then** and **Now** columns into a completed-trade detail view with separate **Then market**, **Now market**, and **Outcome** tabs.
- Backfill market-at-trade values only where a dated snapshot exists; display unavailable otherwise.
- Resolve drafted picks to players while preserving the pick's original market value.
- Show native proposal/counter/decline chains from `AfLeagueTradeStatusHistory` and `parentTradeId`.
- Expand provider adapters where transaction APIs expose failed, declined or counter events.

### P2: improve the models

- Build the FAAB expected-utility curve.
- Add probabilistic pick slots and class-strength modifiers.
- Add coaching/scheme, contract and richer injury features.
- Train league-local preference adjustments only after minimum evidence thresholds.
- Calibrate confidence and recommendation accuracy by season and format.

## Research sources

1. [Sleeper: Can I trade draft picks?](https://support.sleeper.com/en/articles/3974639-can-i-trade-draft-picks)
2. [Sleeper trading documentation](https://support.sleeper.com/en/collections/2293466-trading)
3. [ESPN: Proposing and accepting trade offers](https://support.espn.com/hc/en-us/articles/360039546251-Propose-Trade-on-the-Web)
4. [ESPN: Trade review](https://support.espn.com/hc/en-us/articles/360000036731-Trade-Review)
5. [ESPN: How the trade deadline works](https://support.espn.com/hc/en-us/articles/5896863921172-How-does-the-Trade-Deadline-work)
6. [Yahoo: Propose, cancel, respond and counter](https://help.yahoo.com/kb/SLN6125.html)
7. [Yahoo: Commissioner trade reviews](https://help.yahoo.com/kb/fantasy-sports-app-for-android/commissioner-trade-reviews-sln7223.html)
8. [Footballguys: 2026 dynasty trade value methodology](https://www.footballguys.com/article/2026-dynasty-trade-value-chart-june)
9. [Dynasty League Football: Trade Analyzer FAQs](https://dynastyleaguefootball.com/dynasty-trade-analyzer-faqs/)
10. [Dynasty League Football: Trade Finder FAQ and real-trade data](https://dynastyleaguefootball.com/trade-finder-faq/)
11. [IBM/ESPN: Large Scale Diverse Combinatorial Optimization for fantasy trades](https://arxiv.org/abs/2111.02859)
12. [Parshall, Ali and Zimmerman: playoff-biased trade optimization](https://arxiv.org/abs/2511.17535)
13. [PFF: IDP usage, role and efficiency measures](https://www.pff.com/news/fantasy-football-nfl-week-12-fantasy-idp-report)
14. [FantasyPros: FAAB waiver-wire strategy](https://www.fantasypros.com/2025/09/fantasy-football-faab-waiver-wire-strategy-advice/)

These sources support the workflow and model design, but the completion percentages and implementation findings come from the AllFantasy repository audit.
