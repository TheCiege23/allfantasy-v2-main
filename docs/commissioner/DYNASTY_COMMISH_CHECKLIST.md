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
| ◐ | Weighted rookie lottery | no gate | `lib/draft-lottery/` — seeded, runs once per rookie draft when the method is `weighted_lottery`, year 2+ dynasty only. Its max PF weighting and tiebreak now read true max PF when every team has one (#2794). **Gap:** the `reverse_max_pf` fallback is coerced to reverse standings (`WeightedDraftLotteryEngine.ts`). |
| ✅ | Toilet bowl / consolation decides pick 1 | no gate | #2716, #2730, #2735: `consolation_plays_for = pick`, loser (default) or winner gets 1.01; dynasty and keeper only. Read by the live rookie order; the lottery path ignores it. |
| ⬜ | Legacy rookie-order route is ungated | Plan | `app/api/commissioner/leagues/[leagueId]/rookie-draft-order` (PUT) has no entitlement check though its header says AF Commissioner; the live route is the gated one. |

## Taxi squad

| | Feature | Tier | Notes |
|---|---|---|---|
| ✅ | Taxi size and eligibility (rookies / years limit) | Free | `lib/taxi/TaxiSettingsService.ts`, enforced on lineup save (`rosterValidationService`), ineligible players moved to the bench at rollover. Settings → Taxi squad. |
| ⬜ | Taxi rules: lock after week X, promote-only windows | Plan | `taxiDeadlineWeek`, `taxiPromotionDeadlineWeek`, `taxiLockBehavior`, `taxiInSeasonMoves` are **stored but not enforced** for native leagues (`TAXI_DEADLINE_PASSED` is never produced). |
| ⬜ | Max years on taxi | Plan | No tenure counter for native rosters (`lib/core-app/taxiTenure.ts` reads Sleeper snapshots only). |
| ⬜ | Taxi stealing (claim another team's taxi player) | Plan | Not built. Devy has a display-only flag (misspelled `taxiPoachaingEnabled`). |

## Picks and trades

| | Feature | Tier | Notes |
|---|---|---|---|
| ✅ | Future pick trading, 1–3 years out | Free | `lib/league-trade-engine/nativeFuturePicks.ts`, `futurePickInventory.ts`; `futurePicksYearsOut` (default 3, 1–5). Trade Center. |
| ⬜ | Conditional pick trades ("becomes a 1st if Team X misses the playoffs") and pick protection | Plan | Not built. |
| ⬜ | Separate deadlines for player trades and pick trades | Free | Parked from redraft, where it never bites; in dynasty, picks trade all year. |

## Season and rosters

| | Feature | Tier | Notes |
|---|---|---|---|
| ✅ | Season rollover | Free / Plan | Next season created, rosters carried, taxi/IR/roster limits re-checked (`lib/redraft/offseason/startDynastyNewSeason.ts`, `dynastyRolloverHousekeeping.ts`), rookie draft optionally opened on a calendar date. The **dynasty rollover wizard** is on the Commissioner Hub (`lib/season-rollover/dynastyRolloverWizard.ts`, the same card and route as the redraft one): rookie draft order and creating the draft → taxi rules and a preview of who the start moves to the bench → expiring contracts (salary-cap leagues) → next season's dues → schedule → start, with or without a rookie draft. AF Commissioner adds the drafted announcement and the dues-to-payouts carry. A Commish OS task opens when the season ends; Chimmy is told the offseason state. |
| ✅ | IR eligibility by status (Out, COVID, suspended, NA, DNR, doubtful) | Free | `League.irAllow*`, enforced as `ir_ineligible_status`. Roster compliance settings. |
| ⬜ | IR: move a player back to the bench when he is activated | Plan | Not built; the app only suggests "Move X off IR". |
| ◐ | Dispersal draft for abandoned rosters | Plan | `lib/dispersal-draft/`, `requireEntitlement('commissioner_dispersal_draft')`, setup and draft screens. **Checked and fixed for native leagues** (`nativeDispersal.ts`): the engine read and wrote `Roster.playerData` only, so a native pool held no players (the JSON's `players` are id strings) and a claimed player never left the orphan team for scoring. A native league now builds the pool from the orphan team's `RedraftRosterPlayer` rows, native future picks and `faabBalance`, and a completed draft moves claimed players to the claimer's bench, drops unclaimed ones to free agency, moves claimed picks through `transferNativeFuturePick` and zeroes the orphan FAAB. Imported leagues keep the JSON path. **Gap:** the engine's own tables (`DispersalDraft`, `DispersalDraftPick`, …, created by migration `20260410143800_fix_schema_drift` as `supplemental_drafts` …) have no Prisma models, so the generated client has no `dispersalDraft` and every dispersal-draft call throws; the `as any` casts hide it from typecheck. |
| 🟡 | Orphan team auction | Plan | `lib/orphan-auction/`: an orphan team's players and future picks sold to the rest of the league for FAAB in one sealed-bid round. The commissioner opens it on the Commissioner Hub for one or more orphan teams (24 h – 7 days, a minimum bid); teams bid on the Waivers page, and a team's bids together cannot be more than its FAAB. Highest bid wins, ties go to waiver priority then the earlier bid, a win a team can no longer afford goes to the next bid, and a team pays only for what moved. Closing (the commissioner after the deadline, or the hourly sweep in `app/api/redraft/waiver-process`) moves the assets with the dispersal draft's native writer in one transaction; unsold players go to free agency, unsold picks stay, the orphan FAAB goes to 0. No new table: the auction is `League.settings.orphan_auction`, each team's bids `Roster.settings.orphan_auction_bids`, both written with `jsonb_set`. Commish OS task while open; Chimmy knows the auction (never bids). |

## Order of work

1. ~~True max PF for native leagues and a rookie order that updates itself after every playoff round, with a notice
   to the commissioner and an optional league chat post.~~ Done: #2794, #2795.
2. Dynasty rollover wizard on the Commissioner Hub (order → taxi → dues → schedule), reusing the redraft wizard.
3. Taxi rules that are stored but not enforced (lock week, promotion window), then max years.
4. IR auto-move on activation.
5. Conditional and protected picks.
6. Dispersal draft check, orphan auction, taxi stealing.
