# AllFantasy Decision OS — Demo Proof Package & PR Readiness

**One place** to review the Decision OS demo workstream: what's built, what's test-validated vs
only live-like, the module/route/flag inventory, the safety boundary, a ready-to-use PR
description, and the honest next step. **Packaging/verification only — no new features.**

> **Honest status (unchanged, do not overstate):**
> - Ready to demo with **seeded / live-like** data: ✅
> - Validated against **approved non-prod live Sleeper** data: ❌ **not yet** (needs an approved
>   non-prod run — see [Follow-up](#follow-up)). No live DB has been touched; no screenshots faked.

---

## What's built

- **Manager Intelligence** — hub at `/league/[id]/manager-hub` (client flag, default off) with 5
  modules.
- **Commissioner Intelligence** — hub at `/league/[id]/intelligence` (no client flag; auth + data
  gated) with 7 modules.
- **Demo Layer** — league-home launchers, an operational demo-flow runbook, a partner storyboard,
  and a consolidated flag summary.

## What's validated by tests vs only live-like

- **Validated by tests (deterministic):** every module's aggregator/classifier logic, the A1
  route gate + auth contracts (flag-off / 401 / 403 / data / empty / 500), and hub rendering
  (loading / empty / error / restricted / upgrade), plus "no recommendation language" and "no raw
  ID" scans. See [test coverage](#test-coverage).
- **Only live-like / seeded:** the end-to-end experience with **real imported Sleeper data** and a
  live authed browser session. That is documented and **explicitly not claimed as validated.**

---

## Feature flags (consolidated)

All **default OFF**; enable in **non-prod / demo only**:

| Flag | Scope | Gates |
| --- | --- | --- |
| `NEXT_PUBLIC_MANAGER_INTELLIGENCE_HUB_ENABLED` | client | Manager hub + its league-home entry card |
| `NEXT_PUBLIC_MANAGER_REPLAY_INSIGHTS_DASHBOARD_ENABLED` | client | Manager Historical Replay card (with the server flag) |
| `MANAGER_REPLAY_INSIGHTS_DASHBOARD_ENABLED` | server | Replay-insights route |
| `MANAGER_TEAM_HEALTH_ENABLED` | server | Team Health route |
| `MANAGER_WEEKLY_OUTLOOK_ENABLED` | server | Weekly Outlook route |
| `MANAGER_TRANSACTION_READINESS_ENABLED` | server | Transaction Readiness route |
| `COMMISSIONER_TRADE_REVIEW_ENABLED` | server | Trade Review route |
| `COMMISSIONER_RULE_SETTINGS_ENABLED` | server | Rule / Settings route |
| `CHIMMY_REPLAY_CONTEXT_ENABLED` | server | Chimmy observational replay context (trade intent) |

**Base Commissioner hub is NOT client-flagged** — it is always mounted, gated by **auth (session
role)** and **data (precomputed `IntelligenceLeagueSnapshot`)**. Its base modules (Activity /
Health / Action Items / Stories / Audit Feed) have **no dedicated env flags**; only Trade Review +
Rule Settings are env-flagged. (`DECISION_OS_INTELLIGENCE_API_ENABLED` gates the separate public
keyed API, which the hub does **not** use.)

---

## Manager Intelligence — module inventory

| Module | Route / source | Flag | Default | Data source | Boundary | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| Historical Replay | `GET /api/leagues/[id]/replay-insights` (`ManagerReplayInsightsCard`) | `*_REPLAY_INSIGHTS_DASHBOARD_ENABLED` (client+server) | off | Decision Replay correlation (`ManagerReplayInsightSetV1`) | observational (validated evidence) | replay-framework suite; hub test |
| League Context | `GET /api/app/leagues/[id]/standings` | hub client flag only | on when hub on | `RedraftRoster` standings | observational | hub test |
| Team Health | `GET /api/app/leagues/[id]/team-health` | `MANAGER_TEAM_HEALTH_ENABLED` | off | `RedraftRosterPlayer` + `RedraftSeason.currentWeek` | observational | `manager-team-health-aggregator` + hub |
| Weekly Outlook | `GET /api/app/leagues/[id]/weekly-outlook` | `MANAGER_WEEKLY_OUTLOOK_ENABLED` | off | `RedraftMatchup` (+ reused Team Health) | observational | `manager-weekly-outlook-aggregator` + `-route` + hub |
| Transaction Readiness | `GET /api/app/leagues/[id]/transaction-readiness` | `MANAGER_TRANSACTION_READINESS_ENABLED` | off | roster slots/injuries/byes + `resolveRedraftRosterConfig` | observational | `manager-transaction-readiness-aggregator` + `-route` + hub |

Hub tests: `__tests__/dashboard/manager-intelligence-hub.test.tsx`. Non-prod validation helper +
guard tests: `scripts/manager-intelligence/validate-nonprod-readonly.ts`,
`__tests__/decision-os/manager-intelligence-nonprod-guard.test.ts`.

## Commissioner Intelligence — module inventory

| Module | Route / source | Flag / gate | Default | Data source | Boundary | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| League Activity | `GET /api/v1/intelligence/leagues/[id]/activity` | auth (member) | on (data-gated) | `IntelligenceLeagueSnapshot` | observational | `hub.test.tsx` |
| League Health | `.../health` | auth (commissioner) | on (data-gated) | deterministic health snapshot | observational | `hub.test.tsx` |
| Action Items | `.../action-items` | auth (commissioner) | on (data-gated) | `deriveActionItems()` | observational **alerts** | `hub.test.tsx` |
| League Stories | `GET /api/v1/stories/leagues/[id]/preview` | auth (member/commish types) | on (data-gated) | deterministic narrative (no LLM) + safety note | observational | `hub.test.tsx` |
| Audit Feed | `.../audit-feed` | auth (member) | on (data-gated) | event log (cursor paged) | observational | `hub.test.tsx` |
| Trade Review | `GET /api/app/leagues/[id]/commissioner/trade-review` | `COMMISSIONER_TRADE_REVIEW_ENABLED` + `assertCommissioner` | off | `IntelligenceLeagueSnapshot` + `RedraftTradeProposal`/votes | review **workload** (never a verdict) | `commissioner-trade-review-aggregator` + `-route` + `proof-surface` |
| Rule / Settings | `GET /api/app/leagues/[id]/commissioner/rule-settings` | `COMMISSIONER_RULE_SETTINGS_ENABLED` + `assertCommissioner` | off | `parseSettingsSnapshot` + `resolveRedraftRosterConfig` + `getRedraftSportConfig` + `League` cols | **descriptive** config (never judges) | `commissioner-rule-settings-aggregator` + `-route` + `proof-surface` |

Commissioner hub + proof tests: `__tests__/commissioner-intelligence/{hub,nav-entry,proof-surface}.test.*`.

## Route inventory (all internal, read-only, session-authed)

```
# Manager (A1 app routes)
GET /api/leagues/[id]/replay-insights
GET /api/app/leagues/[id]/standings
GET /api/app/leagues/[id]/team-health
GET /api/app/leagues/[id]/weekly-outlook
GET /api/app/leagues/[id]/transaction-readiness
# Commissioner (G15.5 intelligence/story + A1 app routes)
GET /api/v1/intelligence/leagues/[id]/{activity,health,action-items,audit-feed}
GET /api/v1/stories/leagues/[id]/preview
GET /api/app/leagues/[id]/commissioner/trade-review
GET /api/app/leagues/[id]/commissioner/rule-settings
```

None consume an AI / recommendation endpoint (regression-guarded by the hub route-allowlist tests).

---

## Boundary summary

### What Decision OS does now
Decision OS **summarizes historical, roster, matchup, transaction, league, and commissioner-state
intelligence** — grounded in the league's own data. Every surface is **observational / display-
only**: it describes state; it does not dictate moves.

### What Decision OS does NOT do yet
It does **not** automatically tell users what moves to make. There is no recommendation output on
these surfaces.

**Explicitly preserved through the whole workstream:**
- Replay evidence remains **observational** (backtest/validation only; never a recommendation).
- Commissioner insights remain **observational / action-workload** based (Trade Review = workload,
  not verdict; Rule Settings = descriptive, not judgment).
- **No recommendation logic was changed.** No Trade AI / Waiver AI endpoints consumed.
- **No Trade Learning or calibration was touched.**
- No Replay Framework, Manager, or Commissioner contract was modified outside its own build phase.

---

## Known blockers

1. **Live data needs native activity + an approved env.** Event-driven modules (Manager +
   Activity/Health/Action-Items/Trade-Review) read projected `DomainEvent`s → import-only Sleeper
   leagues render sparse. **Rule / Settings is the exception** (stored config → renders even on
   import-only leagues). A true live pass needs an approved non-prod `DATABASE_URL` + an authed
   session.
2. **Branch hygiene:** `g15-event-foundation` carries heavy concurrent churn from other sessions
   (~250 dirty paths). This workstream was committed by staging **exact filenames only**; the
   typecheck baseline (158) reflects unrelated dirty-branch noise — always diff the error *list*.

---

## Recommended PR description

> **Title:** Decision OS Demo Layer — Manager + Commissioner Intelligence (observational, default-off)
>
> **Summary**
> Adds two display-only intelligence hubs (Manager + Commissioner) built from the league's own
> data, plus a packaged demo flow. Everything is deterministic/observational and default-off; no
> recommendation logic, AI endpoint, or data model was added or changed.
>
> **Major Systems Added**
> - **Manager Intelligence** (`lib/decision-os/manager-intelligence/*`): Team Health, Weekly
>   Outlook, Transaction Readiness display contracts + pure aggregators + read-only resolvers +
>   default-off A1 routes; hub at `/league/[id]/manager-hub`; reuses the existing Replay card +
>   standings.
> - **Commissioner Intelligence** (`lib/decision-os/commissioner-intelligence/*`): Trade Review
>   (review workload) + Rule / Settings (descriptive config) display contracts + A1 routes,
>   layered onto the existing G15.6 hub's Activity/Health/Action-Items/Stories/Audit-Feed.
> - **Demo Layer**: league-home launchers (`LeagueTab.tsx`), demo-flow runbook, partner
>   storyboard, snapshot-seed + non-prod runbooks, and a consolidated flag summary.
>
> **Safety / Boundaries**
> Observational only. Replay stays evidence; Trade Review is workload not a verdict; Rule Settings
> describes not judges. No Trade Learning / calibration / recommendation code touched. Guarded by
> "no recommendation language" + "no AI-endpoint" tests.
>
> **Validation**
> Deterministic aggregators, route auth/gate contracts, and hub rendering are unit/RTL tested.
> **Ready to demo with seeded/live-like data; approved non-prod live Sleeper validation is still
> pending.**
>
> **Known Limitations**
> Event-driven modules need native league activity; import-only leagues render sparse except Rule
> Settings. Live e2e requires an approved non-prod environment.
>
> **Follow-Up**
> Run the non-prod runbooks in an approved environment to validate live; optionally add a base-
> Commissioner-hub feature flag if a hard kill-switch is wanted.

---

## Commit narrative (this workstream, in order)

```
4752e6b35  Manager Intelligence — P1: hub shell (new page /manager-hub)
f7e243e56  Manager Intelligence — P2: Team Health contract
7e1fa88ad  Manager Intelligence — P3: Weekly Outlook contract
dbe0cf85c  Manager Intelligence — P4: Transaction Readiness contract (5 modules, 0 placeholders)
66e44e654  Manager Intelligence — P5: hub polish + live-like proof
7ea0b6d21  Manager Intelligence — P6: non-prod validation runbook + safe read-only helper
c09e6f457  Commissioner Intelligence — P1: proof pass + gap audit (5 modules already existed)
3b0898056  Commissioner Intelligence — P2: hub demo readiness + snapshot seed runbook
fbc233011  Commissioner Intelligence — P3: Trade Review / Fairness data audit (GO)
60d47c249  Commissioner Intelligence — P4: Trade Review contract (6th module)
1fafc4b0c  Commissioner Intelligence — P5: Rule / Settings data audit (GO)
f2af183f5  Commissioner Intelligence — P6: Rule / Settings contract (7th module)
1beaa47d6  Demo Layer — P1: league-home launchers + demo flow + flag summary
ce3b2e9ba  Demo Layer — P2 (pivot): partner storyboard (live-exec gate not met → safe alternate)
```

---

## Follow-up

Choose one:

- **Option A — Open PR / review pass.** Prepare `g15-event-foundation` for review; summarize the
  commits above; handle CI. (Note the branch has unrelated concurrent work — a focused PR may want
  to cherry-pick this workstream's commits onto a clean branch.)
- **Option B — Approved non-prod live validation.** Only with, in-turn: a confirmed non-prod
  `DATABASE_URL`, a test user/session, a league ID, the flags above, and explicit read-only
  validation approval. Then run the Manager + Commissioner runbooks and record results in a new
  `docs/DECISION_OS_NONPROD_LIVE_VALIDATION_RESULTS.md`.

Until then, the correct status is: **Demo packaged and ready. Live validation pending an approved
environment.**
