# AllFantasy NFL Redraft — Launch Readiness Audit

**Audit-first, code-level (no live DB, no rebuild).** Answers one question:
**"Can I promote the NFL Redraft league product to real commissioners/users yet — and if not,
exactly what must be fixed first?"**

**Date:** 2026-07-08 · **Branch:** `g15-event-foundation` (heavy concurrent multi-session churn —
state is in flux; audited the current working tree).

**Update log:**
- **2026-07-08 — Beta Polish Phase 1:** P0 `PlayerStatCard` dev-stub **fixed** (no placeholder copy,
  no raw ids, honest projection fallback, weather block gated on a real projection). Remaining
  launch prerequisites unchanged: deployment/branch topology (P1), live non-prod core-loop + mobile
  QA (P1), paid features (Payments/Import/Team-Settings) still not beta-ready, AI still a separate
  track.

**Audit depth (honest):** traced UI shell/tab **reachability**, stub markers, the commissioner
settings panels, and the freshest wirings (playoffs/trades). **Did NOT** run a live end-to-end
flow (no live DB, per constraint), deep-audit every runtime route's guards live, or do live mobile
QA. Runtime "proven on staging" is cited from prior work, not re-verified this turn.

---

## Executive summary

**Verdict: promotable to real commissioners for a FREE closed beta — after a short P0/P1 list.**
The two historical UI blockers are **closed**: the nflRedraftCore shell now has a full, reachable
core tab set, playoffs UI is wired (`3c1600131`), and trades UI is wired (PR #137, staging E2E
passed). Core commissioner settings are real. Engines/APIs were proven production-ready on staging
in prior work. The gaps that remain are **polish + secondary features + monetization**, not a
broken core loop.

**Readiness estimate (code-level, this branch):**
- **Core league loop (create → draft → play → standings/playoffs → commissioner):** ~**90%** —
  fully wired + reachable; short P0/P1 polish list.
- **Monetization / paid-promotion readiness:** ~**60%** — Payments/Dues settings is a placeholder.
- **AI surfaces:** separate track (many routes exist; not depth-audited) — **not** a core blocker.

> This aligns with the prior "NFL ~93% full-prod" baseline in memory, now **higher on the UI axis**
> because the playoffs/trades UI gaps that memory flagged as beta-blockers are resolved.

> **⚠ Deployment reality (read before promoting):** this audit is of the **`g15-event-foundation`
> working tree**, which is a **local branch ~171 commits ahead of its remote** and **not merged to
> `main`**. The **playoffs UI fix ships as unmerged stacked draft PRs #156 (UI) → #154 (playoff-
> runtime foundation) → main**, and that runtime foundation is **unpushed** (absent from
> `origin/main` and `origin/g15`). So the core loop is wired *in the code audited*, but **nothing is
> on a deployable shared branch yet** — a release/merge decision (below, P1) is a hard prerequisite
> to any real promotion. See [playoffs-gap analysis in memory] / `#154`+`#156`.

---

## 1. Product flow audit (customer journey)

| Step | Status | Evidence / notes |
| --- | --- | --- |
| New user signs in | **working** | auth in place (session-gated routes throughout) |
| Create NFL redraft league | **working** | `app/api/leagues/redraft/create`, `app/api/league/create/redraft`; `lib/redraft-creation` |
| Configure settings | **working** (core) | `CommissionerSettingsModal` — real panels for Scoring/Roster/Trades/Waivers/Playoffs/Draft/Schedule/Divisions/Members/Co-owners/Notifications/Control/Delete |
| Invite / join teams | **partially working** | member/co-owner panels real; **Team Settings (names/logos/owner assignment) = placeholder** |
| Draft | **working** | `draft` tab → `DraftTab` / predraft setup; `lib/draft-engine`, `lib/draft-runtime`, `lib/redraft-draft-room` |
| View league home | **working** | `NflRedraftLeagueHomeDashboard` |
| Waivers | **working** | `waivers` tab → `SportAwareWaiverWire`; `lib/waiver-runtime` (staging-proven) |
| Trades | **working** | `trades` tab → `TradesTab`; `lib/trade-runtime` + `AfLeagueTrade` engine (PR #137, staging E2E pass) |
| Matchups | **working** | `matchups` tab → `MatchupTabContainer` |
| Standings / Playoffs | **working** | `standings` tab → `RedraftStandingsPlayoffsView` → real `StandingsView` with **Generate/Advance/Finalize** wired to `/api/redraft/playoffs/*` + `/api/redraft/seasons/finalize`; honest empty state pre-finalization (`3c1600131`) |
| Commissioner manages league | **working** | `commissioner` tab (gated to commissioners) + `CommissionerControlPanel`; core settings real |

**Every nflRedraftCore tab renders a real component** — `home, draft, roster, matchups, waivers,
trades, standings, league_chat, commissioner` (contract locked by
`__tests__/nfl-redraft-core-tab-bar.test.ts`). No "coming soon" dead tabs remain in the core loop.

## 2. Runtime / API audit (structural)

Redraft routes exist and are wired to the UI: `redraft/playoffs/{generate,advance}`,
`redraft/playoff-runtime`, `redraft/matchup`, `redraft/live-scoring`, `redraft/lineup-lock`,
`redraft/players`, waiver/trade runtimes, `leagues/redraft/create`, settings save/validate
(`commissioner/leagues/[id]/league-settings` + `/validate`). Spot-checked routes are
session-authed with `assertCommissioner`/membership guards and honest error/empty handling
(e.g., the standings view degrades to an empty state with no season).

**Not done here (P1 follow-up):** a live per-route pass (auth/guards/missing-league/error bodies)
against a real league — requires an approved non-prod environment; prior work reports the engines
as staging-proven, but that is not re-verified in this audit.

## 3. UI audit (screens)

**Solid / real:** `LeagueShell` tab switch (all core tabs), `NflRedraftLeagueHomeDashboard`,
`DraftTab`/draft room, `TeamTab`, `MatchupTabContainer`, `SportAwareWaiverWire`, `TradesTab`,
`RedraftStandingsPlayoffsView`, the core `CommissionerSettingsModal` panels, commissioner-only
gating on the Commissioner tab.

**Stubs / placeholders found:**
- **`PlayerStatCard`** (opened on player click, `LeagueShell:1489`) — **✅ FIXED in Beta Polish
  Phase 1.** Previously rendered an unconditional dev line (*"Placeholder baseline {pts} pts (wire
  your provider to replace). Player id {playerId}"*) plus a raw player id and raw league id, and the
  weather block printed point totals anchored to the same synthetic baseline. Now: no placeholder
  copy, no raw ids (unknown players show "Unknown player", not an id), an honest fallback
  ("Detailed projections will appear here when provider data is available."), and the weather block
  is gated on a **real** projection (dormant/preserved until a provider is wired — no fabricated
  points). Guarded by `__tests__/nfl-redraft-player-stat-card-no-stub.test.ts`.
- **`CommissionerSettingsModal` placeholder panels** (`PlaceholderPanel`): Team Settings, Payments/
  League Dues, Import/Sync, Advanced Rules, Appearance/Branding, Security/Permissions, Draft-Pick
  Settings, Integrations — 8 secondary areas. Core settings are real; these are secondary.
- Survivor/Zombie/BB setup panels have disabled inputs — **not NFL redraft**, out of scope for this
  launch path.

**Not deeply audited (P1/P2 follow-up):** live mobile overflow/responsive pass, empty-state sweep
across every screen, dead-link sweep. No obvious desktop-only-layout or duplicate-section smells
surfaced in the core redraft screens during this pass.

## 4. Launch blocker list

| Pri | Area / file | Issue | User impact | Recommended fix | Risk |
| --- | --- | --- | --- | --- | --- |
| ~~**P0**~~ **✅ FIXED** (Beta Polish Phase 1) | `app/league/[leagueId]/components/PlayerStatCard.tsx` | ~~Unconditional "Placeholder baseline … wire your provider to replace" + raw `playerId` shown on player click~~ | ~~Obvious unfinished/dev text + raw ID in a customer-facing card~~ | Removed the synthetic baseline at its root; honest projection fallback; no raw ids; weather block gated on a real projection. Test: `nfl-redraft-player-stat-card-no-stub.test.ts` | Resolved |
| **P1** | `CommissionerSettingsModal` → Payments/League Dues (placeholder) | No buy-in/dues/payout management | Blocks **paid** leagues | Build the Payments panel (or defer paid promotion) | Med |
| **P1** | `CommissionerSettingsModal` → Team Settings (placeholder) | No team names/logos/owner assignment UI | Commissioners can't manage team identity | Build the Team Settings panel | Med |
| **P1** | `CommissionerSettingsModal` → Import/Sync (placeholder) | No provider mapping/refresh UI | Blocks promoting **Sleeper import** as an onboarding path | Build or hide the import path in the pitch | Med |
| **P1** | Deploy/branch topology | Audited code is on **unpushed local `g15`** (~171 commits ahead of remote, not on `main`); playoffs UI is **unmerged draft PRs #156→#154→main** w/ an unpushed runtime foundation | Nothing is on a deployable shared branch — the audited product can't ship as-is | Land #154+#156 and reconcile the g15↔remote gap via a deliberate release decision | **High (prereq)** |
| **P1** | Runtime/API | No live end-to-end pass on a real league this audit | Unverified live behavior/guards | Run the flow in an approved non-prod env | Med |
| **P1** | Mobile | No live responsive/overflow QA | Possible mobile breakage for beta users | Live mobile pass on the core loop | Med |
| **P2** | `CommissionerSettingsModal` → Advanced Rules / Branding / Security / Integrations / Draft-Pick Settings | Secondary placeholders | Nice-to-have for beta | Build post-beta | Low |
| **P2** | Empty-state / dead-link sweep | Not exhaustively audited | Minor polish | Sweep during beta | Low |

## 5. AI feature readiness (separate track — do NOT build here)

Mapped only. **Not** part of core league readiness; **not** a launch blocker for a core-loop beta.

| AI surface | Exists | Notes |
| --- | --- | --- |
| Chimmy league context | yes | conversational; separate quality/safety track |
| Draft assistant / war room | yes | `redraft-war-room`, `WarRoomTab`, `AICoachingTab` |
| Waiver suggestions | route exists | `redraft/ai/waivers` |
| Start/sit | route exists | `redraft/ai/start-sit` |
| Commissioner assistant | route exists | `redraft/ai/commissioner` |
| Matchup / power-rankings / player-insight / weekly-recap / trade-analysis | routes exist | `redraft/ai/*` |
| Decision OS Manager/Commissioner Intelligence | **parked** | built/verified/packaged; **do not touch** (see [demo proof package](./DECISION_OS_DEMO_PROOF_PACKAGE.md)) |

These weren't depth-audited for output quality, safety, or raw-ID/rec-language leakage. **Treat AI
as its own readiness workstream after the core loop is beta-ready.**

## 6. Recommended next phase

**Phase: "NFL Redraft Beta Polish" — close the P0 + the beta-relevant P1s, then a live proof pass.**
0. **Prerequisite — get the audited code onto a deployable shared branch:** land the playoffs draft
   PRs (**#154 then #156**) and make a deliberate decision on the `g15`↔remote gap. Nothing below
   ships until this is resolved.
1. ~~Fix the **P0** `PlayerStatCard` placeholder~~ **✅ DONE (Beta Polish Phase 1).**
2. Decide the beta shape: **free beta** (defer Payments/Import to P1-later) vs **paid/import beta**
   (build Payments + Import/Sync + Team Settings first).
3. Run a **live core-loop proof pass** in an approved non-prod env (create → draft → waiver → trade
   → matchup → standings → **playoff generate/advance/finalize** → commissioner) + a mobile pass.
4. Sweep empty states / dead links on the core screens.

Then the honest promotion answer becomes: **"Yes, as a free closed beta"** once the branch lands +
P0 + the live proof pass are done; **"Yes for paid"** once the Payments/Import P1s land.

## 7. Do-not-touch boundaries

- **Decision OS demo workstream is PARKED** — no Manager/Commissioner Intelligence, Replay,
  foundation-branch, PR, or live-validation work (see [demo proof package](./DECISION_OS_DEMO_PROOF_PACKAGE.md)).
- This was an **audit** — no product code changed, no tests added, no live DB touched.
