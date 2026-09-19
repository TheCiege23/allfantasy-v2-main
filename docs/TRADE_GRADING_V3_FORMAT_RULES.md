# Trade Grading V3: League-Specific Rules and Evidence

Status: implemented policy foundation; contextual scoring integration remains fail-closed until all required evidence exists.  
Policy code: `lib/trade-intel/tradeGradingPolicy.ts`  
Policy version: `trade-policy-2.1`

## Decision

AllFantasy will show two different products and label them separately:

1. **Market comparison** answers whether the assets were similarly priced in this league at that time.
2. **Team outcome grade** answers whether the trade improved this manager’s roster against the objective of this exact league.

A market comparison is not a team outcome grade. A team outcome grade is issued only when user, roster, and league evidence is available. Missing required evidence produces “grade withheld” with the missing inputs; it never produces a neutral grade.

The three primary context layers are:

- **User:** manager/team identity, confirmed strategy when available, and the team’s evidence-based competitive state. Psychology may explain a decision but may not alter asset value or the grade.
- **Roster:** the complete roster immediately before and after the trade, legal lineup topology, player availability, replacement options, and format-specific depth.
- **League:** lifecycle, team count, scoring, lineup slots, bench/IR/taxi, transaction rules, trade deadline, playoff or elimination structure, and format-specific settings.

Market prices, projections, injuries, schedule, replacement pool, and uncertainty remain inputs, but they are subordinate to those three layers and must carry a source and an as-of time.

Every contextual receipt uses ten primary dimensions: league format, league settings, scoring settings, roster settings, trade legality, team needs, manager strategy, standings, contention state, and the paired before/after outcome probability. It then evaluates twenty secondary dimensions: market value, projections, lineup impact, replacement level, scarcity, depth, availability, age/trajectory, recent usage, remaining schedule, playoff schedule, bye overlap, volatility, ceiling/floor, correlation, draft capital, FAAB/cap liquidity, time horizon, opponent impact, and data freshness/uncertainty. A dimension can be marked not applicable; it cannot be silently guessed.

## Researched rules

| Format | Authoritative rule | Grading consequence |
|---|---|---|
| Redraft | Sleeper defines redraft as empty rosters and a fresh set of picks each season. Future-season picks cannot be traded until renewal. | Use rest-of-season production and current playoff/title odds. Do not carry player or pick value into the next season. |
| Dynasty | Sleeper says teams keep the entire roster, with long-term team building, rookie drafts, and taxi squads. Future picks may be traded. | Combine current title impact with separate 1/3/5-year roster value, age/trajectory, rookie picks, and taxi rules. Do not double-count picks inside a long-term roster-strength score. |
| Guillotine | Guillotine Leagues and Yahoo Death Leagues eliminate the lowest weekly scorer and release that roster to waivers; Yahoo specifies no playoffs or schedule. | Replace playoff odds with paired survival probability. Use weekly floor, chop-line distance, field size, weeks remaining, eliminations per period, FAAB purchasing power, and release timing. |
| Best ball | Sleeper automatically inserts the top-scoring legal players each week. Trades, waivers, and free agents are disabled by default but can be enabled. Yahoo public best ball has no adds, drops, trades, or start/sit decisions. | Check trade eligibility first. If enabled in a custom league, recompute the optimal whole-roster score distribution; use spike weeks, position depth, bye overlap, injury fragility, and correlation. Never use submitted starter/bench logic. |
| Salary-cap contract dynasty | League Tycoon defines the asset as a player plus salary and contract length, with extensions, tags, restricted free agency, rookie contracts, dead money, and cap enforcement. | Check both teams' cap legality first. Price contract surplus, years, dead money, rollover, future flexibility, and replacement spending power before raw player value. |
| Survivor | The supplied rules use tribe-dependent safety, voting, a merge, jury outcome, idols/advantages, Exile, and transaction timing that differs inside and across tribes. | Enforce the trade window before valuation. Pre-merge value includes tribe safety and voting position; post-merge value shifts to individual immunity and jury-win probability. |
| Survivor Guillotine | The supplied All-Stars rules explicitly prohibit trades and change the elimination rule, lineup, rewards, and advantages by week. | Return **trade ineligible** with no grade. A commissioner-created trade-enabled variant must use its exact weekly phase rather than a standard guillotine formula. |
| Zombie | The supplied rules allow Survivors and the Whisperer to trade but block Zombies after infection is final. Serums, weapons, money, and draft picks can move. | Check both teams' execution-time status first. Use infection-adjusted survival/payout, item transfers and deadlines, matchup state, instant replacement, and the shrinking legal counterparty pool. |
| Tournament | The supplied Black and Gold rules explicitly prohibit player trades and draft-pick trades; rosters reset at later tournament stages. | Return **trade ineligible** with no grade. In configurable trade-enabled tournaments, value ends at the next redraft and the target is advancement probability in the current stage. |
| King of the Hill | Week 1's top scorer becomes King and receives +10 weekly until losing. A loss releases that King's three highest scorers from that week to waivers; that week's top scorer becomes King. The mechanic ends at the playoffs. | Add expected crown points, subtract the King-specific probability and cost of a three-player release, and include the real waiver/FAAB chance of reacquiring or adding released players. |
| Pirate | A weekly winner steals one unprotected player from the loser. Each team protects three; every other starter, bench player, and IR player is exposed. All trades lock from Thursday kickoff through the end of Monday games. | Validate the transaction window first. Rebuild protection choices after the trade, price the best exposed player rather than average depth, and simulate both matchup value and future steal outcomes. |

Primary sources:

- Sleeper, [League Types & Formats](https://support.sleeper.com/en/articles/3537396-league-types-formats)
- Sleeper, [Can I trade draft picks?](https://support.sleeper.com/en/articles/3974639-can-i-trade-draft-picks)
- Sleeper, [How do taxi squads work?](https://support.sleeper.com/en/articles/3640482-how-do-taxi-squads-work)
- Sleeper, [Do you offer Best Ball?](https://support.sleeper.com/en/articles/4100708-do-you-offer-best-ball)
- Yahoo, [Overview of Fantasy Death Leagues](https://help.yahoo.com/kb/pro-football-pickem/guillotine-sln37116.html)
- Guillotine Leagues, [How Guillotine Leagues work](https://www.guillotineleagues.com/)
- Yahoo, [Best Ball Fantasy Football](https://bestball.fantasysports.yahoo.com/howToPlay)
- League Tycoon, [Contract Dynasty Fantasy Football](https://leaguetycoon.com/contract-dynasty/)

League-specific source files supplied by the commissioner:

- `Survivor All-Stars Guillotine.docx`
- `KB Survivor Rooks vs Vets Rewrite.docx`, `Suvivor chat.docx`, `Welcome to the Island.docx`, and `Exile Island.pdf`
- `Beta Zombie League Rules 2025 (1).docx`, `Zombie league weekly update.docx`, and the Zombie Universe trackers
- `Tournament Rules.docx`, `Tournament.docx`, `Tournament setup on replit.docx`, and `KBI Black & Gold 2026.xlsx`

These files are evidence for their named commissioner formats. They are not universal defaults for every league carrying a similar label. No supplied file identifies itself as “EFL,” so AllFantasy must not silently attach that acronym to a rule set; the current implementation treats the Island/Exile documents as Survivor/Exile rules until an explicit EFL identifier is stored.

## Format contracts

### Redraft

The target is the change in rest-of-season playoff and championship probability for the receiving team. The before and after simulations must use identical random scenarios so the delta comes from the roster change rather than simulation noise.

Required inputs are the league’s scoring and roster rules, trade rules, the team identity, exact before/after rosters, values and projections available at the trade time, replacement pool, player availability, remaining schedule, and a paired season simulation. Current draft picks may be priced only before that season’s draft. Future-season picks invalidate the grade.

### Dynasty

The target has two reported parts: current-season playoff/title probability and the multi-year championship window. The engine must preserve the manager’s competitive state instead of treating a rebuilder and contender as if they have the same horizon.

Required inputs add player age/trajectory, rookie-pick ownership and legal years, taxi settings and eligibility, and multi-year roster strength. Current impact and future value remain separate on the receipt. If a roster-strength model already includes draft capital, no separate pick term may be added.

### Guillotine

The target is the change in survival probability over the remaining elimination periods. Standard playoff probability is not applicable.

Required inputs add the active field, teams eliminated per period, current and projected chop line, each team’s weekly score distribution, weeks remaining, FAAB balances, roster-release timing, and observed winning bids. A generic season-long market letter is withheld. If trades were disabled at the relevant time, the transaction is ineligible rather than gradeable.

### Best ball

Best ball is a lineup mode layered on a redraft or dynasty lifecycle. The target is the change in the distribution of automatically optimized weekly scores, plus playoff probability for head-to-head leagues when applicable. Dynasty best ball also retains the dynasty horizon.

Required inputs add weekly score distributions, full-roster optimal lineup matching, spike-week history, position fragility, byes, availability, and same-team correlation. A player’s manual starter/bench label is irrelevant. If league settings disable trades, AllFantasy must explain that and issue no grade.

### Salary-cap contract dynasty

The target is the change in cap-adjusted championship window. A transaction is ungradable until both post-trade ledgers satisfy the cap ceiling and any enforced floor. Each player must carry salary, remaining years, guarantees or dead-money consequence, and applicable option/tag status. The engine must value the opportunity cost of occupied cap space using the league's actual free-agent and replacement market; it may not invent a player-value-to-salary conversion.

### Survivor and Exile

The target is jury-win probability under the current game phase. The trade window is a hard constraint: the supplied rules distinguish cross-tribe and within-tribe timing, lock players who have played, and void deals whose assets move to waivers after elimination. Before the merge, the model needs both managers' tribes, tribe safety rule, voting position, and advantages. After the merge, it needs individual immunity, jury path, and remaining powers. Exile tokens and return mechanics are separate state and only count when the league rules allow them to affect the manager's return.

### Survivor Guillotine

The supplied All-Stars league does not permit trades, so the product must show **Trades disabled by league rules** and no A–F letter. Strategy analysis can still value waiver claims and roster construction. Its survival model changes by phase: tribe match play, tribe champion, Gauntlet double elimination, standard guillotine, then final-three weekly placement. Lineup slots expand during the season, standard and Gauntlet idols expire on different dates, swap tokens have deadlines, and strategic benching is legal.

### Zombie

The target combines survival/infection state with expected payout. A Zombie participant is ineligible when `zombieTradeBlocked` is active; historical checks require the state recorded at execution, not today's state. The grade includes transferable serums, weapons, and winnings; item-use deadlines; the current opponent and possible ambush; revival paths; and the chance that infection closes the manager's future trade window. Because free agents are instant and there are no normal waivers in the supplied rules, ordinary depth receives a much lower replacement premium.

### Tournament

The supplied Black and Gold tournament disables trades, so no grade is issued. The platform setting remains configurable for other tournaments. When enabled, the target is advancement probability in the current qualification, bubble, elimination, or championship stage. All acquired value ends at the next scheduled redraft; byes and weekly variance receive more weight in short elimination windows, and unused FAAB loses value before a configured reset.

### King of the Hill

The target is crown-adjusted championship probability until the playoff cutoff. The current King receives an expected stream of +10 bonuses but also carries a discontinuous loss risk: the three highest scorers on that roster in the loss week go to waivers. The model therefore needs the current King, weekly matchup and player-score distributions, playoff start week, roster concentration, FAAB balances, waiver priority, and observed claim prices. The released players are determined by that week's points rather than general market rank. After the playoffs begin, the crown contributes zero.

### Pirate

Trade legality is checked before value: no deal may execute from the start of Thursday's game until Monday's games have ended. Every team protects three players, and every unprotected player is stealable regardless of starter, bench, or IR designation. After each hypothetical trade, the engine must optimize the three protections, identify the most valuable exposed player, and simulate future head-to-head wins and losses. An incoming fourth star may be worth much less than market price because either he remains exposed or displaces another valuable player from protection.

## Historical trades

Historical decision grades use only facts available at or before the transaction timestamp:

- league rules and trade eligibility effective then;
- both rosters immediately before and after the transaction;
- standings, schedule, projections, injuries, values, FAAB, and format state as of then;
- a versioned model and paired before/after scenarios saved with the result.

Today’s value, today’s roster, and later injury news are future information and cannot be used to judge the original decision. When an exact decision-time snapshot is unavailable, AllFantasy shows the separate realized outcome grade based on what happened while the assets were held and states that the original decision grade is unavailable. A retrospective outcome must never overwrite the original decision grade.

Every persisted grade receipt must include the policy/model version, transaction time, evidence timestamps and sources, league settings fingerprint, before/after roster hashes, each component result, missing inputs, confidence, and whether the grade is a market comparison, decision grade, or realized outcome grade.

## Implementation status

The first evidence batch now persists a manager-confirmed `win-now`, `balanced`, or `rebuild` objective per user and league. Proposal readiness requires that confirmation plus an available paired before/after outcome simulation, readable league/roster settings, and priced suggested assets.

New `AfLeagueTrade` proposals also create an append-only `TradeDecisionSnapshot` in the same database transaction. It freezes the league settings, participating rosters, proposed assets, policy version, manager context, evidence states, and readiness result. A simulation returned through the browser is retained as unverified audit data and cannot unlock a contextual grade. Server-verifiable asset-value, projection, and paired-simulation capture remains a rollout gate, so these initial receipts correctly remain partial rather than assigning an unsupported historical letter.

## Rollout gates

1. Keep the current display explicitly labeled **Market grade** for current redraft/dynasty trades while the full contextual inputs are incomplete.
2. Withhold a letter for every specialty format until its format objective and hard legality checks are calculated; respect league-, phase-, and team-specific eligibility.
3. Withhold historical market letters unless an immutable as-of-trade snapshot exists. Continue displaying the separate realized result.
4. Connect paired simulations and optimal-lineup deltas to the policy evidence contract.
5. Backtest against historical decisions without leaking post-trade data, then calibrate thresholds by format. No uncalibrated coefficient may silently change a production letter.
