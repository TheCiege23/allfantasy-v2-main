# AllFantasy NFL Redraft — Beta Landing & Core-Loop QA Runbook

**Beta Polish Phase 2 — planning/runbook only.** This document maps the branch/deploy dependencies,
recommends a safe landing path, and defines the human QA checklist + acceptance criteria for a
**free closed beta**. It **does not execute deployment**, push branches, open/merge PRs, touch a live
DB, or change product code. Companion to [`NFL_REDRAFT_LAUNCH_READINESS_AUDIT.md`](./NFL_REDRAFT_LAUNCH_READINESS_AUDIT.md).

**Date:** 2026-07-08 · **Audited from:** local `g15-event-foundation` @ `0de7bc889`.

---

## 0. TL;DR

- **The audited NFL Redraft beta experience exists on _local g15 only_.** `origin/main` does **not**
  have the nflRedraftCore shell, the playoffs UI view, or the P0 fix (it still ships the placeholder
  stub). `origin/g15` is **176 commits behind** local g15 and equally stale.
- **The open PRs (#137 trades, #154 playoff-runtime foundation, #156 playoffs UI) are _partial
  slices_.** Even fully merged to `main`, they would **not** deliver a working beta, because the
  nflRedraftCore **shell** they wire into is not on `main`, and the **P0 PlayerStatCard fix has no
  PR at all**.
- **Recommended landing path: Option B (focused beta branch off `main`), with Option C as its first
  sub-step.** Land the reviewed slices (#154 → #156 → #137), then assemble the shell + P0 fix onto a
  focused `nfl-redraft-beta` branch — **excluding** the parked Decision OS / Replay / Trade Learning
  / Intelligence / provider-migration work that saturates g15. **Option A (deploy g15 as-is) is
  rejected** — it bundles ~60+ off-limits/parked commits.
- **Do not solve deployment in this phase.** This runbook is the map; the *decision to land* is the
  next phase.

> **Phase 3 refinement → [`NFL_REDRAFT_BETA_SLICE_AUDIT.md`](./NFL_REDRAFT_BETA_SLICE_AUDIT.md).** The
> commit-level audit shows the beta is a **clean, sequential, labeled `G30–G44` series** (create →
> home/shell → league runtime → draft → roster → schedule → scoring → waiver → trade → playoff →
> player-data → notifications → full-season → polish), plus the later UI/fix commits (#137 trades,
> #156 playoffs, P0 `0de7bc889`). So the refined recommendation is a **curated cherry-pick of that
> series** onto a focused `nfl-redraft-beta` branch (not a PR-first stack — #154's merge gate is
> currently blocked by *pre-existing `main`* CI failures), **excluding G28 (Decision OS), G45–G48
> (provider), G49A–J (premium, incl. the G49E paywall), and the Replay card**. Two files need
> hunk-surgery (`LeagueShell` ← G28, `HomeDashboard` ← Replay); `PlayerStatCard` is a file-transplant.

---

## 1. Branch / Landing dependency map (verified 2026-07-08)

**Reference points**
- Local `g15` HEAD: `0de7bc889` (P0 fix). `origin/g15` tip: `9845cbd3e` (**176 behind** local, 0 ahead).
- `origin/main` tip: `f7240f63c`. Merge-base(local g15, main): `35fb8ff4e`.
- Local g15 is **250 commits** ahead of that merge-base; `main` is **97 commits** ahead of it (diverged).

| # | Dependency | Where it actually lives | Classification |
| --- | --- | --- | --- |
| 1 | **nflRedraftCore shell + core tab set** (`isNflRedraftCoreDashboardFromUserLeague`, `NFL_REDRAFT_CORE_TAB_IDS`, tab switch in `LeagueShell.tsx`) | **local g15 only** — 0 of these markers exist on `origin/main` | **local only** |
| 2 | **Playoffs UI** (`RedraftStandingsPlayoffsView.tsx`, commit `3c1600131`) | **local g15 only**; absent from `origin/main` and `origin/g15`; re-applied in PR #156 | **local only + draft-slice in #156** |
| 3 | **P0 PlayerStatCard fix** (commit `0de7bc889`) | **local g15 only — NO PR exists** | **local only** |
| 4 | **Trades UI wiring** (`TradesTab` → `AfLeagueTrade`) | PR **#137** open → `main`; `main` has an *older* `TradesTab.tsx` (not the wired one) | **open PR (#137)** |
| 5 | **Playoff-runtime foundation** (`lib/playoff-runtime/*`, `/api/redraft/playoff-runtime`, client layer) | PR **#154** packages it → `main` | **open PR (#154, MERGEABLE but BEHIND)** |
| 6 | **Playoffs UI PR** (re-application of `3c1600131` onto #154) | PR **#156** → base `#154` (stacked) | **open PR (#156, MERGEABLE but UNSTABLE)** |
| 7 | `origin/g15-event-foundation` | 176 commits behind local g15; lacks #2, #3, and the latest | **remote, stale (not beta-ready)** |
| 8 | `origin/main` | lacks shell (#1), playoffs UI (#2), P0 fix (#3); still ships the placeholder stub | **landed base, NOT beta-ready** |
| 9 | **Parked / off-limits work interleaved in g15 history** (g15-only commits by theme: Decision OS ~27, Replay ~21, Trade Learning ~10, Commissioner Intelligence ~10, Manager Intelligence ~6, Closed-Beta ~3, provider migration ~1) | local g15 (and the never-pushed foundation below it) | **blocked by foundation / parked — must NOT be bundled** |

> **Correction to prior notes:** PRs **#154 and #156 are no longer drafts** — both are OPEN and
> review-ready (#154 is `BEHIND` main → needs an update-from-main; #156 is `UNSTABLE` → checks
> pending/failing). This supersedes the "stacked *draft* PRs" wording in earlier memory.

**What this means:** the beta is **not** "merge two PRs away." The reviewed PRs cover **trades +
playoffs runtime + playoffs UI**, but the **shell that makes every tab reachable** and the **P0 fix**
are local-only, and they sit on top of a g15 branch saturated with parked work.

---

## 2. Landing strategy

**Goal:** get the audited beta experience onto a **deployable branch** without bundling parked /
off-limits / unfinished work.

| Option | What it is | Delivers a working beta? | Bundles off-limits work? | Effort | Risk | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| **A** | Deploy local `g15` as-is | Yes (everything's there) | **Yes** — ~60+ Decision OS/Replay/Trade-Learning/Intelligence/provider commits | Low | **High** | **Reject** |
| **B** | Focused `nfl-redraft-beta` branch off `main` (cherry-pick only beta-critical redraft commits) | Yes, once assembled | No | **Med–High** (shell rewrite conflicts w/ main; needs a slice audit) | Low (deploy) | **Recommended** |
| **C** | Land the stacked PRs first (#154 → #156 → #137) | **No, not alone** — no shell, no P0 fix on `main` after | No | Med | Low | **Necessary sub-step of B, not sufficient alone** |
| **D** | Continue local-only | No deployable beta | No | None | None | Status quo; doesn't advance the goal |

### Recommendation: **Option B, sequenced as "C feeds B"**

1. **Land the reviewed slices to `main`** (they are the self-contained, already-reviewed pieces):
   **#154** (update-from-main first, it's `BEHIND`) → **#156** (stacked; clear the `UNSTABLE` checks) →
   **#137** (trades). *This is Option C, done as the foundation — not the finish line.*
2. **Run a "beta slice audit"** to identify the remaining beta-critical set **not** covered by those
   PRs — chiefly:
   - the **nflRedraftCore shell** (the `LeagueShell.tsx` rewrite + tab-id set + core-league detection
     + home/roster/matchups/waivers/standings wiring), and
   - the **P0 `PlayerStatCard` fix** (`0de7bc889`, no PR).
   Assemble them onto a focused **`nfl-redraft-beta`** branch off `main`, **excluding** Decision OS /
   Replay / Trade Learning / Manager & Commissioner Intelligence / provider-migration commits.
3. **Fallback if the shell proves too entangled with g15 event-foundation infra to extract cleanly:**
   publish `origin/g15` **forward to a reviewed cut** that includes the beta but stops short of the
   off-limits work — a scoped release decision. **Still not a blind Option A.**

**Note on conflicts (why B is Med–High, not trivial):** `main` has none of the nflRedraftCore
concept and its `LeagueShell.tsx` has diverged substantially from g15, and the P0 fix is a full
rewrite of a file `main` still holds in its placeholder form — so neither cherry-picks cleanly. The
slice audit + conflict resolution is the real work, and it is **out of scope for this phase.**

> **This phase does not execute any option.** No branch is created/pushed, no PR opened/merged.

---

## 3. Core-loop QA runbook (free closed beta)

Human QA pass to run **on the deployed beta branch, in an approved non-prod environment**, before
inviting any commissioner. Every item: **steps → expected → Pass/Fail → severity → notes**.
Severity: **P0** = blocks beta · **P1** = fix-soon / workaround acceptable · **P2** = polish.

**Environment preconditions (record before starting):** deployed branch + commit SHA; environment
URL (non-prod); test commissioner + ≥1 test manager account; browser + device matrix (≥1 desktop, ≥1
mobile); non-prod DB confirmed (never prod).

### 3.1 Onboarding & league setup

| ID | Steps | Expected | P/F | Sev | Notes |
| --- | --- | --- | --- | --- | --- |
| A1 | Sign in (email + each enabled OAuth) | Lands authenticated; no console/auth errors | ☐ | P0 | |
| A2 | Create NFL redraft league | League created; redirects to league home | ☐ | P0 | |
| A3 | Open Commissioner settings → Scoring / Roster / Waivers / Playoffs / Draft / Schedule | Real panels render + save; reload persists | ☐ | P0 | |
| A4 | Invite / add a second team (member + co-owner) | Invite works; second account joins | ☐ | P0 | |
| A5 | Team identity (name/logo/owner) | If **Team Settings** placeholder still shows → must be **hidden**, not shown as broken | ☐ | P1 | placeholder panel |

### 3.2 Draft

| ID | Steps | Expected | P/F | Sev | Notes |
| --- | --- | --- | --- | --- | --- |
| B1 | Open Draft tab → predraft setup → Open Live Draft Room | Room opens; pool loads (readiness gate honored) | ☐ | P0 | |
| B2 | Make a manual pick | Pick registers; roster/board update | ☐ | P0 | |
| B3 | Auto/queue pick (if enabled) + timer expiry | Autopick fires correctly; no double-advance | ☐ | P1 | |
| B4 | Finalize draft | Picks sync to rosters; season becomes active | ☐ | P0 | draft→roster sync (see PR #21) |

### 3.3 In-season core loop

| ID | Steps | Expected | P/F | Sev | Notes |
| --- | --- | --- | --- | --- | --- |
| C1 | Roster tab | Real roster; lineup set/save; slot rules enforced | ☐ | P0 | |
| C2 | **Player click → PlayerStatCard** | **No raw ids, no "wire your provider", no fake projections**; honest fallback when no projection | ☐ | P0 | **P0 fixed `0de7bc889`**; guard test exists |
| C3 | Matchups tab | Matchup renders; scores/lineups consistent | ☐ | P0 | |
| C4 | Waivers tab | Claim add/drop; weekly lock correct; lineup_sections stay in sync | ☐ | P0 | see PR #131 |
| C5 | Trades tab → propose → accept/approve | Trade lifecycle via real engine; rosters sync | ☐ | P0 | trades wiring = PR #137 |
| C6 | League chat | Send/receive; no crash | ☐ | P1 | |

### 3.4 Standings, playoffs, commissioner

| ID | Steps | Expected | P/F | Sev | Notes |
| --- | --- | --- | --- | --- | --- |
| D1 | Standings tab (pre-finalization) | Honest empty state, not a dead "coming soon" | ☐ | P1 | |
| D2 | Commissioner → Generate playoff bracket | Correct seeding/byes; bracket displays | ☐ | P0 | `/api/redraft/playoffs/*` |
| D3 | Advance round | Winners advance; round progression correct; no double-advance | ☐ | P0 | |
| D4 | Finalize season | Champion crowned; final standings persist; season → complete | ☐ | P0 | |
| D5 | Commissioner controls (lock/edit/override where offered) | Actions gated to commissioner; take effect | ☐ | P0 | |

### 3.5 Cross-cutting: mobile, empty states, errors

| ID | Steps | Expected | P/F | Sev | Notes |
| --- | --- | --- | --- | --- | --- |
| E1 | Full core loop on **mobile** (≤ 400px) | Usable: no clipped controls, no desktop-only layout, tap targets work | ☐ | P1 | no live mobile QA yet |
| E2 | Every core tab **before data exists** | Honest empty states everywhere; no raw ids, no "coming soon" dead ends | ☐ | P1 | empty-state sweep |
| E3 | Error paths (bad league id, non-member access, network fail) | Graceful errors; membership/commissioner guards hold; no stack traces to users | ☐ | P1 | |
| E4 | **Placeholder/paid/AI surfaces** (Payments, Import/Sync, Advanced Rules, etc.) | **Hidden or clearly "unavailable"** — never shown as broken or half-built | ☐ | P0 | see §4 free-beta rule |
| E5 | Console/network sweep across the loop | No uncaught errors; no leaked internal ids/PII in payloads shown to users | ☐ | P1 | |

---

## 4. Beta acceptance criteria (tiered)

### 4.1 Free closed beta — **required to invite commissioners**

- ☐ Core league loop works end-to-end: create → settings → draft → roster → matchups → waivers →
  trades → standings → **playoff generate/advance/finalize** → commissioner controls.
- ☐ **No dev stubs visible** anywhere in the core loop (PlayerStatCard P0 already fixed).
- ☐ **No raw ids visible** to users.
- ☐ Commissioner can configure the basics (scoring/roster/waivers/playoffs/draft/schedule) and they persist.
- ☐ All core surfaces (draft/matchup/waiver/trade/playoff) are **reachable** from the shell.
- ☐ **Mobile is usable enough** for the core loop (E1).
- ☐ **Paid / import / AI features are hidden or clearly marked unavailable** (E4) — not shown broken.
- ☐ Running on a **deployable branch** (Option B result), **not** local-only, and **not** carrying
  parked Decision OS / Replay / Trade-Learning / Intelligence / provider work.
- ☐ QA runbook §3 passed with **zero open P0s** (P1s may ship with a known-issues note).

### 4.2 Paid beta — **additionally required**

- ☐ **Payments / League Dues** no longer a placeholder (buy-in/dues/payout management real).
- ☐ **Import/Sync** ready **or** cleanly hidden as an onboarding path.
- ☐ **Team Settings** (names/logos/owner assignment) real.
- ☐ Billing/subscription **gating verified** (entitlement checks on paid features).

### 4.3 Public launch — **additionally required**

- ☐ **Live end-to-end proof** on the real stack (not structural-only).
- ☐ **Support flow** (contact/help, incident path).
- ☐ **Monitoring** + **error tracking** wired and watched.
- ☐ **Privacy / compliance review** (data handling, no-gambling policy, AI transparency where applicable).
- ☐ AI surfaces (Chimmy, `redraft/ai/*`, war room) audited for quality/safety **as their own track**.

---

## 5. The map, in one place

- **What must land (before any beta invite):** the nflRedraftCore **shell** + core-tab wiring
  (local-only) and the **P0 PlayerStatCard fix** (`0de7bc889`, no PR) — plus the reviewed slices
  **#154 → #156 → #137** — assembled onto a **focused `nfl-redraft-beta` branch off `main`** (Option B).
- **What must be tested:** QA runbook §3 (all P0s green), on that deployed branch, in an approved
  non-prod env, incl. a real **mobile** pass.
- **What can be deferred:** Payments/Dues, Import/Sync, Team Settings, Advanced Rules/Branding/
  Security/Integrations/Draft-Pick panels, and **all AI surfaces** — provided they are **hidden or
  marked unavailable** for the free beta.
- **What is safe to show free-beta users:** the full core loop (home/draft/roster/matchups/waivers/
  trades/standings/playoffs/chat/commissioner), which is structurally complete and, on the deployed
  branch, free of dev stubs and raw ids.

## 6. Boundaries honored this phase

- No product/AI/payments/import/Decision-OS code created or modified.
- No branch pushed, no PR opened/reopened/merged, no live DB touched.
- Decision OS remains **parked**. Deployment is **mapped, not solved** — the landing *decision* and
  the first human QA pass are the next phases.
