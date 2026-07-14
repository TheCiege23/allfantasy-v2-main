# G63 — Defect Log

**RC under test:** `release/nfl-redraft-invited-mvp-rc1` @ `daacd0a2163819e151de511d82aeb1d7cbbd7019`
**DB:** disposable Neon branch `br-restless-sound-add08fqz` (clone of prod `icy-field-51189449` "All Fantasy"; prod never written). **Date:** 2026-07-12.

Severity: **P0** = blocks invited beta / build · **P1** = major, needs decision · **P2** = fidelity/quality · **P3** = dev-only/cosmetic.

---

## 🔴 P0-1 — RC1 league home 500s; production build broken (missing component)
**Confirmed at runtime.** Loading any league home (`/league/[leagueId]`) as an authenticated user returns **HTTP 500**:
```
Module not found: Can't resolve '@/components/decision-os/UserOsCardConnected'
> 22 | import UserOsCardConnected from '@/components/decision-os/UserOsCardConnected'
Import trace: ./app/league/[leagueId]/LeagueShell.tsx → LeagueShellClient.tsx
```
- RC1 has `components/decision-os/UserOsCard.tsx` but **NOT** `UserOsCardConnected.tsx`.
- `components/league-home/NflRedraftLeagueHomeDashboard.tsx` imports it (line 22) and renders it (line 460); that dashboard is wired into the league route via `LeagueShell.tsx`.
- **`UserOsCardConnected.tsx` DOES exist on the later `feat/fantasy-os-*` branch** → RC1 @ `daacd0a2` is a **bad cut** that references a component not included in the branch.

**Impact:** Every league home a commissioner or invited manager opens is broken. `next build` (production) fails on this unresolved import — **RC1 is not deployable.** This is the true blocker; it is unrelated to staging infrastructure.

**Verdict:** Genuine P0 defect. **Fix (minimum):**
1. **Preferred (release mgmt):** re-cut the invited-MVP RC from a SHA that already includes `components/decision-os/UserOsCardConnected.tsx`, then re-run this validation. OR
2. **Patch:** port `components/decision-os/UserOsCardConnected.tsx` (+ any deps it needs) from the later branch into the RC and confirm `/league/[leagueId]` compiles; OR remove the import (line 22) + usage (line 460) from `NflRedraftLeagueHomeDashboard.tsx` if the card is out-of-scope for the MVP.
Add a regression test that compiles/renders `NflRedraftLeagueHomeDashboard` (or asserts the league route returns 200).

**✅ STATUS: FIXED during G63.** Ported `components/decision-os/UserOsCardConnected.tsx` verbatim from the `feat` branch into the RC (all deps — `UserOsCard`, `lib/decision-os/userOs`, `/api/decision-os/user-os` route — already present; props matched). Result: `✓ Compiled /league/[leagueId] in 1817ms`, league home now renders 200 (Commissioner HQ, tabs, draft setup, Manager-OS card, invite surface all live). **Follow-ups:** (1) this fix lives only in the local worktree — fold it into the release (re-cut or cherry-pick) and add the render test; (2) still recommend re-cutting from a SHA that includes the file rather than carrying a manual patch.

---

## 🟠 Other findings

| ID | Sev | Area | Finding | Verdict |
|----|-----|------|---------|---------|
| **REG-1** | **P1** | Regression suite | RC1 redraft Vitest gate: **22 failed / 1116 passed (10 of 106 files failed)**. Mix of (a) **real** failures — `prisma.redraftSeason.findUnique is not a function` (playoff-advance/finalize), DST scoring `expected 17, got 0` (g37 live-scoring), the P0-1 import break (g32 fails to collect); and (b) **brittle "source-should-contain-X" tests** that are test-drift, not runtime bugs (player-headshot, pre-draft-fix-action-listener `sliceStart:-1`, fantasycalc route, `canEnterDraftRoom`). | Suite is **RED**. Triage: fix P0-1 + investigate the playoff `redraftSeason` + DST scoring failures; update/retire the brittle source-assertion tests. |
| **C-1** | **P1 (product decision)** | Sleeper import | Imported leagues carry **standings only** — `league_teams` has `ownerName/teamName/wins/pointsFor/pointsAgainst/projectedWins`, **no player column**; **0** rows in `redraft_rosters`/`rosters`/`league_settings`/`league_seasons`. No player rosters, lineups, waivers, trades. | **Intended design, not a code bug** — the import is documented "League row only … historical Sleeper seasons" (history/ranking import). **Needs a product decision:** does "invite people to *import* redraft leagues" mean history/context [works] or a *live playable* league [not built]? |
| **D-1** | **P3** *(downgraded)* | League-type mapping | `buildLeagueUpdateData` (`lib/league/sleeper-import-process.ts:358`) never sets `leagueType` → all imports default to `redraft`. Dynasty captured via `isDynasty = settings.type===2`; keeper (`type===1`) not distinguished. | **Downgraded after UI check:** the imported type=2 league correctly shows **"Dynasty league / 12-Team Dynasty"** in the UI (driven by `isDynasty`), so dynasty *is* surfaced to users — `leagueType` default is a harmless internal coarseness. Only **keeper** is undistinguished (collapses to redraft). Not a beta blocker. |
| **DB-1** | **P2** | DB migrations / Decision-OS | RC1 (and current code) query `decision_os_imported_activity` + `decision_os_behavioral_snapshot`, which **do not exist in the prod database** (confirmed on the prod clone): `prisma:error … table … does not exist`. Hit on the league home + draft room (Manager-OS / behavioral widgets). | **Caught / non-fatal** — features degrade to empty state ("no_snapshots"), no crash. But Decision-OS/Manager-OS features are **non-functional on prod until these migrations are deployed.** Deploy the missing migrations (or gate the features) before relying on them. |
| **A-1** | **P3 (dev-only)** | Auth/onboarding | `dev-bypass` provider session carries `username:null` → always redirects to `/choose-username`. | Not a product defect (real users carry username). The `/choose-username` flow itself is **correct** (verified). |
| **A-2** | **P3 (dev-only)** | Auth | `dev-bypass` provider has no UI button (dev-only mechanism). | Expected. |
| **ENV-1** | **P3 (noise)** | Session cookie | Stale `next-auth.session-token` from a prior run → `ERR_JWE_DECRYPTION_FAILED` / spurious 401 until sign-out. | Environmental (browser-profile carryover), not RC1 code. |

## Phase E/F addendum (post-P0-fix)
| ID | Sev | Finding | Verdict |
|----|-----|---------|---------|
| **E-1** | **P2 (decision)** | Email **and** username invites default to **disabled** on new leagues — `/api/commissioner/leagues/[id]/invite/send` returns 403 ("… invites are disabled for this league") on *every* league tested (mine + prod-clone). Management UI is Settings → Members. | The invite API is correct (enforces per-league privacy). But a new commissioner can't invite until enabling a method — confirm this privacy-first default isn't unwanted friction for the invite flow. |
| **F-1** | **P2 (perf)** | The **live draft room is very heavy** — open SSE streams (`/api/draft/intel/stream`), cold pool warm, large board — and **locks the test browser's renderer** (screenshot/JS/text extraction time out). Route loads in ~40s. | Live picks could not be driven in-browser here. Worth a perf pass; real users on weak devices may struggle. Draft mechanics not falsified — just not exercised live. |
| **SETUP-1** | **P3 (test note)** | Leagues created via the direct `createRedraftLeagueInTransaction` path (my earlier verification) **skip `runPostCreateInitialization`** → incomplete roster config (draft blocked: "Roster configuration incomplete"), empty draft pool ("0 players"), invites disabled. | Not an RC1 defect — the real wizard runs the init. Explains why RC-VERIFY leagues weren't draftable/invitable. Use wizard-created leagues for draft/invite validation. |

## Net counts
**P0: 1** (P0-1 — **FIXED**) · **P1: 1** (C-1 product decision; **REG-1 RESOLVED in G64** — redraft suite 23→0: 1 real DST-scoring defect fixed + 22 test-drift, see `G64_REGRESSION_TRIAGE_AND_REMEDIATION.md`) · **P2: 1** (DB-1 — refined in G64: migrations are "never to production", app fails-open, NOT MVP-required, separate deploy gate) · **P3: 4** (A-1, A-2, ENV-1, D-1)
