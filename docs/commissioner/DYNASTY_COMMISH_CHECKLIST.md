# Dynasty commissioner — what's built, what's open, what's next

The working checklist for the **dynasty** commissioner experience, after redraft
(`docs/commissioner/REDRAFT_COMMISH_CHECKLIST.md`, complete). Product source: `docs/AF_COMMISSIONER_SETTINGS_SPEC.md`
§4.2 (PR #2494). **Free** = every commissioner; **Plan** = the Commissioner subscription; **Free / Plan** = a manual
or partial version is free and the automation or full version is on the plan; **no gate** = the code checks no
entitlement and the tier is still to be decided.

Everything in the redraft checklist that is not redraft-only — co-commissioners, score adjustments, settings lock,
league log, disputes, payouts, deadline autopilot and the rest — already applies to dynasty leagues. This list is only
what dynasty adds.

**Status key:** ✅ merged to `main` · 🟡 open PR (not merged) · ⬜ planned, not started · ◐ partly built, the gap is
in the notes.

⚠ "Merged" means the code is on `main`, **not** that it is live. `allfantasy-v2-main` deploys in batches
(`.github/workflows/railway-deploy.yml`, ~18–35 min after a merge), and cron-driven parts run on the worker, which
follows `worker-release` and moves about once a day. Check `/api/af-debug/sha` before saying a feature is in production.

_Audited against `main` on 2026-10-26 (7e2e4498)._

**How the code recognises a dynasty league:** there is no single check. `League.isDynasty`, `leagueVariant`
(dynasty / devy / c2c / merged_devy_c2c / dynasty_idp), `isDynastyFamilyLeague`
(`lib/redraft/offseason/carryDynastyRosters.ts`), `isDynastyLeagueRow` (`lib/draft-lottery/dynastyYearGuard.ts`) and
`renewalKindFromSelection(...) === 'dynasty_family'` all exist. New dynasty work should use `renewalKindFromSelection`,
the one the renew path itself uses.

## Rookie draft and draft order

| | Feature | Tier | Notes |
|---|---|---|---|
| ✅ | Live rookie draft order (§1.1) — non-playoff teams by reverse max PF / PF / record, playoff teams by finish then seed, worse seed first within a round, final order seats the next rookie draft | Free / Plan | `lib/rookie-order/` (engine, native + Sleeper bracket adapters, `liveRookieOrderService`), Draft settings → live order panel, saved final order used by `createNextLeagueDraft`. Calculate is free; the automation is `commissioner_automation` and keeps running for the season after a plan lapses. Imported platforms: #2543. True max PF for native leagues (#2794: `nativeMaxPf.ts`, `loadNativeMaxPf.ts`). The order refreshes hourly and, as each playoff round locks picks, notifies the commissioner with an optional league chat post (#2795: `roundNotices.ts`, `roundNoticeService.ts`, run from `app/api/redraft/waiver-process`). |
| ✅ | Weighted rookie lottery | no gate | `lib/draft-lottery/` — seeded, runs once per rookie draft when the method is `weighted_lottery`, year 2+ dynasty only. Its max PF weighting and tiebreak read true max PF when every team has one (#2794). The picks the draw does not assign now follow the configured fallback (`buildFullSlotOrder`): `reverse_max_pf`, the default, seats the non-playoff teams lowest max PF first (a tie to the worse finish) and then the playoff teams by finish, like the live rookie order; it had been coerced to reverse standings. `manual` seats by finish, and Draft HQ now says so in both languages. |
| ✅ | Toilet bowl / consolation decides pick 1 | no gate | #2716, #2730, #2735: `consolation_plays_for = pick`, loser (default) or winner gets 1.01; dynasty and keeper only. Read by the live rookie order; the lottery path ignores it. |
| ✅ | Legacy rookie-order route gated | Plan | `app/api/commissioner/leagues/[leagueId]/rookie-draft-order` (PUT) now refuses to switch automatic ordering on unless the league owner holds AF Commissioner (402 `AF_COMMISSIONER_REQUIRED`), the same check as the live route (`isLeagueEntitledToLiveRookieOrder`). Owner's call 2026-10-27, over the route's earlier "free on purpose" note: the preview, saving a mode, and switching it off stay free; a config already on keeps seating drafts after a lapse, like the live order. The GET says whether it can be switched on (`canAutomate`), and the Draft tab disables the switch and says why, in English and Spanish. |

## Taxi squad

| | Feature | Tier | Notes |
|---|---|---|---|
| ✅ | Taxi size and eligibility (rookies / years limit) | Free | `lib/taxi/TaxiSettingsService.ts`, enforced on lineup save (`rosterValidationService`), ineligible players moved to the bench at rollover. Settings → Taxi squad. |
| ✅ | Taxi rules: lock after week X, promote-only windows | Plan | Enforced on both lineup saves once the commissioner turns on **Enforce these rules** (Roster settings → Taxi squad rules, `League.settings.taxi_rules_enforced`) and the owner holds AF Commissioner: lock week (`TAXI_DEADLINE_PASSED`), promotion deadline, once promoted cannot return (a `taxi_promotion` row in `RedraftRosterMoveHistory`), in-season and playoff switches. `lib/taxi/taxiMoveRules.ts`, `taxiRulesService.ts`. Opt-in because every league holds defaults nobody chose; the offseason is always open and a commissioner override is never refused. |
| ✅ | Max years on taxi | Free | Commissioner setting, **2 seasons by default** (1–5 or no limit; Roster settings → Taxi squad rules, `League.settings.taxi_max_years`). Counted from completed seasons' rosters on any team (`lib/taxi/taxiMaxYears.ts`, no migration); a player who has used them moves to the bench at the season start and can't be put back on taxi by a lineup save. |
| ✅ | Taxi stealing (claim another team's taxi player) | Plan | Roster settings → Taxi stealing (`League.settings.taxi_stealing`), AF Commissioner, off by default. A team claims a player on another team's taxi squad from the Waivers page (one open claim per player; 1 claim per team per season by default, counted when made). The owner keeps the player by promoting them to the active roster within the window (48 h by default) — allowed even while the taxi rules close promotions, and counted as a promotion — or lets them go; otherwise the hourly sweep in `app/api/redraft/waiver-process` moves the player to the claimer's bench. Claims live in `League.settings.taxi_steal_claims`, written with `jsonb_set` under a row lock (no migration). Notices to both teams (EN/ES), a Commish OS task while claims are open, and Chimmy knows the rule and open claims. `lib/taxi/taxiStealing.ts`, `taxiStealingService.ts`. Devy still has its own display-only flag (`taxiPoachaingEnabled`). |

## Picks and trades

| | Feature | Tier | Notes |
|---|---|---|---|
| ✅ | Future pick trading, 1–3 years out | Free | `lib/league-trade-engine/nativeFuturePicks.ts`, `futurePickInventory.ts`; `futurePicksYearsOut` (default 3, 1–5). Trade Center. |
| ✅ | Conditional pick trades ("becomes a 1st if Team X misses the playoffs") and pick protection | Plan | `lib/league-trade-engine/pickTerms.ts` (rules), `pickTermsService.ts` (offer check, settlement). The commissioner turns it on (Trade settings → Conditional and protected picks, `League.settings.pick_terms_rule`), and while the league owner holds AF Commissioner an offer in the Trade Center can give each native future pick one term: **top-N protected** (it stays, or next year's same-round pick conveys instead) or **conditional** on a team making or missing the playoffs (it becomes another round, or does not convey). Checked on propose (`checkOfferPickTerms`), recorded when the trade settles and taken back by a reversal (`League.settings.pick_terms`, `jsonb_set`, no migration). Settled once, on the final order `createNextLeagueDraft` seats, inside `consumeNativeFuturePicksForDraft`; the playoff field is the season before's `RedraftPlayoffSeed` rows. Terms travel with the pick and cannot be replaced until settled; terms already agreed settle after a plan lapses. Trades page card lists every pick with terms and its outcome; Commish OS task for picks due in the next draft; Chimmy reads them. Native dynasty leagues only. |
| ✅ | Separate deadlines for player trades and pick trades | Free | `lib/trade-deadline/pickTradeDeadline.ts`. Trade settings → **Pick trade deadline** (dynasty, devy and C2C only, `League.settings.pick_trade_deadline`): the same as the trade deadline (the default), open all season, or close after a week of its own, earlier or later. A trade made only of draft picks follows it; a trade with any player or FAAB keeps the trade deadline and its close time. Read at every gate the trade deadline is: propose, accept and a commissioner processing a bare offer (`tradeService.ts`), the draft room's pick trades, and the deadline sweep, which now expires each pending offer by its own rule (`expireOffersAtDeadline.ts`). In season only, like the trade deadline. The Trade Center shows a chip beside the deadline, the Commissioner Hub calendar shows the pick deadline, and Chimmy is told the rule. |

## Season and rosters

| | Feature | Tier | Notes |
|---|---|---|---|
| ✅ | Season rollover | Free / Plan | Next season created, rosters carried, taxi/IR/roster limits re-checked (`lib/redraft/offseason/startDynastyNewSeason.ts`, `dynastyRolloverHousekeeping.ts`), rookie draft optionally opened on a calendar date. The **dynasty rollover wizard** is on the Commissioner Hub (`lib/season-rollover/dynastyRolloverWizard.ts`, the same card and route as the redraft one): rookie draft order and creating the draft → taxi rules and a preview of who the start moves to the bench → expiring contracts (salary-cap leagues) → next season's dues → schedule → start, with or without a rookie draft. AF Commissioner adds the drafted announcement and the dues-to-payouts carry. A Commish OS task opens when the season ends; Chimmy is told the offseason state. |
| ✅ | IR eligibility by status (Out, COVID, suspended, NA, DNR, doubtful) | Free | `League.irAllow*`, enforced as `ir_ineligible_status`. Roster compliance settings. |
| ✅ | IR: move a player back to the bench when activated | Plan | Commissioner Hub → IR auto-move (`League.settings.ir_auto_move`), AF Commissioner. Hourly, in `app/api/redraft/waiver-process`: a player on IR whose live designation the league's IR rules no longer allow is moved to the bench through the ordinary lineup save (`lib/ir-activation/`). A full bench or roster tells the manager to make room (once a week), and a Commish OS task lists those teams. A sport whose injury feed has no live rows is skipped, so an outage never empties every IR. Native leagues of any format. |
| ✅ | Dispersal draft for abandoned rosters | Plan | `lib/dispersal-draft/`, `requireEntitlement('commissioner_dispersal_draft')`, setup and draft screens. **Checked and fixed for native leagues** (`nativeDispersal.ts`): the engine read and wrote `Roster.playerData` only, so a native pool held no players (the JSON's `players` are id strings) and a claimed player never left the orphan team for scoring. A native league now builds the pool from the orphan team's `RedraftRosterPlayer` rows, native future picks and `faabBalance`, and a completed draft moves claimed players to the claimer's bench, drops unclaimed ones to free agency, moves claimed picks through `transferNativeFuturePick` and zeroes the orphan FAAB. Imported leagues keep the JSON path. The engine's own tables have Prisma models (#2832), so every dispersal-draft call reaches a real delegate. **The pick clock now runs on the server**: it used to live only in the on-the-clock manager's page, restarted on every 3-second poll, and nothing on the server ever auto-picked, so a dispersal draft stopped on the first manager who was not watching. The deadline is the draft row's last write plus the pick time (`pickDeadlineFor`), shown to every viewer; the every-minute `draft-tick` cron auto-picks an expired pick when the commissioner set "Auto-pick on timeout" (`processExpiredDispersalPicks`, outside `DRAFT_TICK_CRON_ENABLED`, like an auto draft), and any member's page can nudge one (`advance_expired`, checked on the server). The legacy POST route no longer lets a member pick, pass or auto-pick for another team. |
| ✅ | Orphan team auction | Plan | `lib/orphan-auction/`: an orphan team's players and future picks sold to the rest of the league for FAAB in one sealed-bid round. The commissioner opens it on the Commissioner Hub for one or more orphan teams (24 h – 7 days, a minimum bid); teams bid on the Waivers page, and a team's bids together cannot be more than its FAAB. Highest bid wins, ties go to waiver priority then the earlier bid, a win a team can no longer afford goes to the next bid, and a team pays only for what moved. Closing (the commissioner after the deadline, or the hourly sweep in `app/api/redraft/waiver-process`) moves the assets with the dispersal draft's native writer in one transaction; unsold players go to free agency, unsold picks stay, the orphan FAAB goes to 0. No new table: the auction is `League.settings.orphan_auction`, each team's bids `Roster.settings.orphan_auction_bids`, both written with `jsonb_set`. Commish OS task while open; Chimmy knows the auction (never bids). |

## Order of work

1. ~~True max PF for native leagues and a rookie order that updates itself after every playoff round, with a notice
   to the commissioner and an optional league chat post.~~ Done: #2794, #2795.
2. ~~Dynasty rollover wizard on the Commissioner Hub (order → taxi → dues → schedule), reusing the redraft wizard.~~
   Done: #2801.
3. Taxi rules that are stored but not enforced (lock week, promotion window), then max years.
4. IR auto-move on activation.
5. Conditional and protected picks.
6. Dispersal draft check, orphan auction, taxi stealing.
