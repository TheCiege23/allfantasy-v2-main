# AF Rescue Merge Plan — `wip/phase38-rescue` → `fix/access-tier-and-landing`

Analysis only. No source file was merged, cherry-picked, or checked out to produce this
document. Comparison points:

- **BASE** = `git merge-base wip/phase38-rescue fix/access-tier-and-landing` = `59b25f4e8` (the
  "docs: data-provenance audit" commit — the exact point the rescue branch was cut from mainline,
  right before Prompts 7 and 8 began).
- **RESCUE_CHANGES** = `git diff --name-status BASE wip/phase38-rescue` → **966 files** (690 added,
  276 modified, **0 deleted**).
- **MAINLINE_CHANGES** = `git diff --name-status BASE fix/access-tier-and-landing` → **17 files**
  (1 added, 16 modified) — exactly the Prompt 7 + Prompt 8 commits.
- **OVERLAP** = files both sides touched = **2 files**. See §0 below — this is the entire blast
  radius for "could this clobber existing work."

Because every NEW-in-rescue file is by definition a path mainline never touched (mainline only
has A/M status, no path collisions with rescue's 690 additions were found), the overlap risk is
**structurally confined to the 276 files rescue *modified*** — and of those, only 2 intersect
with what mainline modified.

---

## Phase overview table

| # | Phase | Files (N/M-safe/OVERLAP/del) | Migration | Depends on | Recommendation |
|---|---|---|---|---|---|
| 0 | **Overlap reconciliation** (see below) | 2 / 0 / 2 / 0 | — | — | needs-reconciliation |
| 1 | Build-tooling config | 0/4/0/0 | — | none | safe-to-take-as-is |
| 2 | Identity Service (shared-services) | 8/2/0/0 | — | none | safe-to-take-as-is |
| 3 | Sleeper import hardening | 12/1/2/0 | — | Phase 0 | needs-reconciliation |
| 4 | Canonical player valuation path | 1/0/1/0 | — | Phase 0 | needs-reconciliation |
| 5 | Knowledge Graph service | 20/3/0/0 | — | Phase 2 | needs-author-review |
| 6 | Trade Service Shadow + backtest | 20/2/0/0 | — | Phase 2, 5 | needs-author-review |
| 7 | Waiver Service Shadow | 17/2/0/0 | — | Phase 2 | needs-author-review |
| 8 | Draft Service Shadow + backtest | 20/2/0/0 | — | Phase 2 | needs-author-review |
| 9 | Game Day / Scoring Service | 15/2/0/0 | — | Phase 2, 6 | needs-author-review |
| 10 | Commissioner Intelligence Service | 24/2/0/0 | — | Phase 2, 5, 6, 8 | needs-author-review |
| 11 | League Hub / User-OS + Commissioner-OS surface | 30/3/0/0 | — | Phases 2, 5–10 | needs-author-review |
| 12 | Redraft renewal + trade-execution-snapshot schema | 6/2/0/0 (+8 migrations) | **8 migrations, all already applied to prod** | none | needs-author-review |
| 13 | Redraft app/api routes (renewal, trade reversal, AI) | 13/0/0/0 | none (see Phase 12) | Phase 12 | needs-author-review |
| 14 | Redraft engine + core contract (lib/redraft, lib/redraft-core-contract) | ~10/2/0/0 | none | Phase 12 | needs-author-review |
| 15 | Redraft tests | 46/0/0/0 | — | Phases 12–14 | hold (validate after 12–14 land) |
| 16 | League Hub UI wiring (app/league, components/league-hub) | 14/2/0/0 | — | Phase 11 | needs-author-review |
| 17 | Commissioner-OS/User-OS/Decision-OS test suites | 30/0/0/0 | — | Phases 5–11 | hold |
| 18 | NCAAF / CFBD provider | 6/0/0/0 | — | none | safe-to-take-as-is |
| 19 | Plugin framework | 9/1/0/0 | — | none | needs-author-review |
| 20 | League lifecycle engine | ~8/0/0/0 | — | Phase 12 (shares redraft lifecycle states) | needs-author-review |
| 21 | Admin dashboard tools (visitor analytics, API health) | 8/0/0/0 | — | none | safe-to-take-as-is |
| 22 | Matchup Center + live scoring surfaces | 14/2/0/0 | — | Phase 9 | needs-author-review |
| 23 | UI component library refresh (components/ui) | 11/0/0/0 | — | Phase 1 (tailwind tokens) | needs-author-review |
| 24 | My Players / Cross-League Player workspace | 6/1/0/0 | — | none | safe-to-take-as-is |
| 25 | Documentation (docs/os, docs/redraft) | 241/0/0/0 | — | none — pure docs | safe-to-take-as-is |
| — | **Exclude: session debris** | 22 files, not a phase | — | — | **discard, do not take** |

Counts above are directory-scoped estimates from path analysis (not a full line-by-line audit of
all 966 files — see the note on methodology at the end). The 8 phases marked
**needs-author-review** are all real, substantial, previously-documented shared-services /
redraft subsystems (see this session's own memory index — Identity Phase 1 through Commissioner
Phase 10 map file-for-file onto phases 2–11 below); "needs-author-review" reflects their size and
that they were never live-tested against real Sleeper accounts in this git history, not that
anything looks wrong.

---

## DANGER LIST — every OVERLAP file, in one place

**Only 2 files total.** Neither is a hard line-level conflict — both are reconcilable with a
small amount of manual work, not a silent-clobber risk, but both need a human decision before
either branch's version of the file is taken wholesale.

### 1. `lib/league-import/mfl/MflLeagueFetchService.ts`

- **Mainline (Prompt 7, commit `2c75f6492`)**: added `fetchMflUserLeagues()` (ported from this
  exact rescue branch) and exported the pre-existing `parseMflSourceInput()`, to fix a build
  break where `commissionerGate.ts` imported both and neither existed/was exported in the
  committed tree.
- **Rescue**: has a **superset** of mainline's version — the same `fetchMflUserLeagues()`
  function (byte-identical body), *plus* an additional function, `discoverMflPreviousSeasons()`,
  that mainline never received.
- **Verdict**: compatible, not conflicting. Rescue's version is safe to take as the final state —
  it fully contains what mainline needed, plus more. Recommendation: take rescue's version in
  Phase 3, confirm `discoverMflPreviousSeasons()` is actually called from somewhere real before
  shipping it (not verified in this pass).

### 2. `server/api-route-modules/legacy/trade/proposal-generator/route.ts`

- **Mainline (Prompt 7, commit `f5ea38066`)**: a 136-line rewrite — single deterministic
  acceptance % (audit fix #4), touching the middle/body of the file.
- **Rescue**: a single-line change — redirects the `fetchFantasyCalcValues` import from
  `@/lib/fantasycalc` to a new canonical module, `@/lib/player-valuations/canonicalPlayerValuations`
  (Phase 4 below), at the top of the file.
- **Verdict**: different regions, not a textual conflict — but **do not blind-merge**. Taking
  mainline's file wholesale drops rescue's canonical-valuation-path migration; taking rescue's
  file wholesale reverts the Prompt 7 acceptance-% fix. Reconciliation: keep mainline's current
  body, and if Phase 4 (canonical player valuation) is approved, re-apply just the one-line import
  swap on top of the already-fixed file.

**If you were worried OVERLAP might be large: it isn't.** 964 of 966 rescue files (99.8%) touch
paths mainline never modified since BASE, so a phase-by-phase apply carries essentially no clobber
risk outside these two files.

---

## §0 — Overlap reconciliation (must happen before Phases 3–4 land)

Not a phase with new capability — this is the two DANGER LIST files above, called out on their
own because they gate Phases 3 and 4. Recommended sequencing: land Phase 1 (config) first, then
resolve §0 by hand for both files (small, mechanical), then Phases 3–4 can proceed cleanly.

---

## Phase detail

### Phase 1 — Build-tooling config
**Purpose**: infra hygiene, not a product feature. Extends the Windows webpack-cache-disable to
production builds (may fix the `readlink EISDIR` issue this session has treated as a known
non-failure all along), adds a semantic Tailwind design-token layer, hardens vitest path
resolution for Windows.
**Files**: `next.config.js`, `tailwind.config.js`, `tsconfig.json`, `vitest.config.ts` — all
MODIFIED, none in OVERLAP.
**Migration**: none. **Depends on**: nothing. **Build-safety**: applies alone cleanly — these are
foundational and additive (new Tailwind tokens, no removed ones; tsconfig only adds
`.next-dev-local`/`.next-playwright-3101` to an already-broad include list).
**Recommendation**: safe-to-take-as-is. Land first — Phase 23 (UI components) likely assumes
these tokens exist.

### Phase 2 — Identity Service (`lib/shared-services/identity`)
**Purpose**: canonical cross-provider player/manager identity resolution — the foundational shared
service every other `lib/shared-services/*` subsystem below builds on (per this session's own
memory: "Fantasy OS Identity Service impl", Phase 1, additive-only, 23 tests).
**Files**: ~7 NEW in `lib/shared-services/identity/`, 3 NEW tests in
`__tests__/shared-services/identity/`, plus `docs/os/CANONICAL_PLAYER_IDENTITY_CONTRACT.md`.
**Migration**: none. **Depends on**: nothing. **Build-safety**: standalone.
**Recommendation**: safe-to-take-as-is — this is additive, well-scoped, and every later
shared-services phase imports from it, so it should land before Phases 5–11.

### Phase 3 — Sleeper import hardening
**Purpose**: real fixes to the live import adapters (ESPN/Yahoo/MFL/Fantrax/Sleeper mappers,
`canonicalImportNormalizer.ts`, `canonicalSeasonMaterialization.ts`, `ImportedLeagueCommitService.ts`).
**Files**: 15 total in `lib/league-import/` — 1 file is the MFL DANGER LIST entry (#1 above); the
rest (14) are MODIFIED, safe (mainline hasn't touched them since BASE).
**Migration**: none. **Depends on**: §0 reconciliation for the MFL file.
**Build-safety**: cannot land cleanly until the MFL overlap is resolved (mainline currently
depends on `fetchMflUserLeagues`/`parseMflSourceInput` existing in this exact file).
**Recommendation**: needs-reconciliation (mechanical, see DANGER LIST #1).

### Phase 4 — Canonical player valuation path
**Purpose**: introduces `lib/player-valuations/canonicalPlayerValuations.ts` as the intended
single source for `fetchFantasyCalcValues`, redirecting one call site to it.
**Files**: 1 NEW (`lib/player-valuations/canonicalPlayerValuations.ts`), 1 OVERLAP (DANGER LIST #2).
**Migration**: none. **Depends on**: §0 reconciliation.
**Build-safety**: the new module is self-contained; the import-swap needs the reconciliation
above before it's safe to re-apply.
**Recommendation**: needs-reconciliation — small, but touches a file this session already fixed
twice (Prompt 7 commits `7dff0b9f8` and `f5ea38066` both live in this exact valuation lineage), so
worth the author confirming the canonical module produces the same real FantasyCalc values before
swapping the import.

### Phase 5 — Knowledge Graph service (`lib/shared-services/knowledge-graph`)
**Purpose**: signal-capture aggregation layer (trade/waiver/behavioral signals) feeding manager
intelligence — per memory, "Fantasy Knowledge Graph impl (Phase 3)", in-memory store only.
**Files**: 14 in `lib/shared-services/knowledge-graph/`, 9 in
`__tests__/shared-services/knowledge-graph/` (23 total; some may be NEW test-fixture files, not
independently counted here), plus `docs/os/FANTASY_KNOWLEDGE_GRAPH_SCHEMA_PROPOSAL.md` and related.
**Migration**: none (in-memory per its own design, per memory). **Depends on**: Phase 2 (identity).
**Build-safety**: standalone once Phase 2 lands.
**Recommendation**: needs-author-review — real, tested, but never validated against a live DB.

### Phase 6 — Trade Service Shadow + backtest (`lib/shared-services/trade`)
**Purpose**: shadow-mode trade evaluation service + historical backtest replay (memory: "Trade
Service Shadow Build (Phase 5)" + "Trade Shadow Backtest (Phase 6)").
**Files**: 14 in `lib/shared-services/trade/` (incl. `backtest/`), 8 in
`__tests__/shared-services/trade/`.
**Migration**: none directly, but its real-data validation path assumes `TradeExecutionSnapshot`
exists (Phase 12).
**Depends on**: Phase 2, Phase 5 (consumes knowledge-graph signals per memory).
**Build-safety**: compiles standalone; full real-data value needs Phase 12's schema.
**Recommendation**: needs-author-review.

### Phase 7 — Waiver Service Shadow (`lib/shared-services/waiver`)
**Purpose**: mirrors the trade shadow pattern for waivers (memory: "Waiver Service Shadow +
Backtest (Phase 7)", 2 orphaned FAAB engines noted at the time).
**Files**: 12 in `lib/shared-services/waiver/` (incl. `backtest/`), 7 in
`__tests__/shared-services/waiver/`.
**Migration**: none. **Depends on**: Phase 2.
**Build-safety**: standalone.
**Recommendation**: needs-author-review.

### Phase 8 — Draft Service Shadow + backtest (`lib/shared-services/draft`)
**Purpose**: VORP-less/ADP-based draft shadow service + true point-in-time backtest replay
(memory: "Draft Service Shadow + Backtest (Phase 8)").
**Files**: 13 in `lib/shared-services/draft/`, 9 in `__tests__/shared-services/draft/`. This is
also the single largest `docs/os/` cluster (41 files matched "draft" in Phase-count check above —
most of those are Phase 28–32 draft-OS audit/readiness docs, folded into Phase 25 below rather
than duplicated here).
**Migration**: none. **Depends on**: Phase 2.
**Build-safety**: standalone.
**Recommendation**: needs-author-review.

### Phase 9 — Game Day / Scoring Service (`lib/shared-services/game-day`)
**Purpose**: reuses live scoring engines (`buildMatchupCenterPayload`,
`computeLineupActionsForUser`), adds cross-league `UserPlayerExposure` (memory: "Game Day/Scoring
Service Shadow (Phase 9)"; lineup replay was noted as impossible — no snapshot existed at the
time).
**Files**: 7 in `lib/shared-services/game-day/`, 10 in `__tests__/shared-services/game-day/`.
**Migration**: none. **Depends on**: Phase 2, Phase 6 (reuses trade-adjacent scoring context per
memory).
**Build-safety**: standalone.
**Recommendation**: needs-author-review.

### Phase 10 — Commissioner Intelligence Service (`lib/shared-services/commissioner`)
**Purpose**: aggregates League Health/Engagement/Rankings/Rivalry/Draft-grade/Trade-grade/
Integrity signals for commissioners (memory: "Commissioner Intelligence Service Shadow (Phase
10)" — most surface overlap with already-live Mission Control/League Analytics; identity
self-attested/unsolved at the time).
**Files**: 14 in `lib/shared-services/commissioner/`, 12 in
`__tests__/shared-services/commissioner/`.
**Migration**: none. **Depends on**: Phase 2, 5, 6, 8 (draft-grade generator needs the draft
shadow service).
**Build-safety**: needs Phases 2/5/6/8 present to compile cleanly (real cross-imports, not
verified line-by-line in this pass — flagging as an assumption to confirm before approving this
phase alone).
**Recommendation**: needs-author-review.

### Phase 11 — League Hub / User-OS + Commissioner-OS surface (`lib/shared-services/league-hub`)
**Purpose**: the largest single `lib/shared-services/*` cluster (24 files) — the recommendation
coordinators (`assembleUserOsRecommendations`, `assembleCommissionerOsRecommendations`),
generators, provider-capability/sync-freshness helpers. This is the assembly layer every
dashboard/League-Hub UI surface reads from.
**Files**: 24 in `lib/shared-services/league-hub/`, plus its dedicated test dir (5, under
`__tests__/league-hub/` — note this test dir sits OUTSIDE `__tests__/shared-services/`, a naming
inconsistency worth flagging to the author) and 4 in `app/api/league-hub/`.
**Migration**: none. **Depends on**: Phases 2, 5–10 (this is the top of the dependency stack —
it assembles output from every generator below it).
**Build-safety**: will NOT compile standalone without Phases 2 and 5–10 present.
**Recommendation**: needs-author-review — land last among the shared-services phases.

### Phase 12 — Redraft renewal + trade-execution-snapshot schema
**Purpose**: the `TradeExecutionSnapshot`/`TradeReversal` Prisma models, `FantraxLeague.appUserId`
security field, `LeagueRenewalStatus`/`LeagueRenewalSlotStatus` new enum values, and the
`lib/redraft/renewal/*` service layer (`CanonicalRedraftRenewalService.ts`,
`createNextSeason.ts`, `nextSeasonEligibility.ts`, etc.).
**Files**: `prisma/schema.prisma` (MODIFIED, +117 lines, additive-only), 8 migration directories
(all NEW), 6 files in `lib/redraft/renewal/`.
**Migration — confirmed via direct read-only prod query this session**: **all 8 migrations in
this rescue set are already applied to production**:

| Migration | Applied at (UTC) |
|---|---|
| `20260627000000_add_league_championships` | 2026-06-26T14:30:09Z (separate, earlier) |
| `20260711110000_add_trade_execution_snapshots` | 2026-07-14T13:12:36Z |
| `20260711120000_create_redraft_renewal_foundation` | 2026-07-14T13:12:37Z |
| `20260711121000_extend_redraft_renewal_for_franchises` | 2026-07-14T13:12:37Z |
| `20260711130000_widen_redraft_trade_proposal_status_check` | 2026-07-14T13:12:37Z |
| `20260712000000_add_next_season_creation_completion_evidence` | 2026-07-14T13:12:38Z |
| `20260712010000_add_missing_league_lifecycle_state_values` | 2026-07-14T13:12:38Z |
| `20260712020000_add_fantrax_league_app_user_ownership` | 2026-07-14T13:12:38Z |

**These are source-only for this phase — never re-run `prisma migrate deploy` for them.** Taking
this phase means committing the *source* of a schema that already exists live in prod (this is
literally the reason the rescue rescue-and-preserve pass mattered — until now, this schema had no
git history at all, even though it's been live since July 14).
**Depends on**: nothing. **Build-safety**: `prisma generate` needs the schema change; the
renewal service files depend on the new models existing in the generated client.
**Recommendation**: needs-author-review — high-value (closes the "schema exists only in prod"
gap) but the author should confirm the source matches what's actually live before committing it
as historical record.

### Phase 13 — Redraft app/api routes (renewal, trade reversal, AI)
**Purpose**: the live route handlers for season renewal (`/api/redraft/renewals/*`), trade
reversal (`/api/redraft/trades/[proposalId]/reverse`), and AI commissioner/trade/waiver assistants.
**Files**: 13 in `app/api/redraft/`.
**Migration**: none directly (consumes Phase 12's schema). **Depends on**: Phase 12.
**Build-safety**: will not compile without Phase 12's Prisma models.
**Recommendation**: needs-author-review.

### Phase 14 — Redraft engine + core contract
**Purpose**: `lib/redraft/playoffEngine.ts`, `lib/redraft/tradeSettlement.ts`,
`lib/redraft/offseason/RedraftOffseasonService.ts`, `lib/redraft/ai/*` (commissioner/trade/waiver
analyzers), `lib/redraft-core-contract/`, `lib/redraft-creation/`.
**Files**: ~10-12 across `lib/redraft/` (excluding the renewal subset already in Phase 12) and
`lib/redraft-core-contract/`, `lib/redraft-creation/`.
**Migration**: none directly. **Depends on**: Phase 12 (shares the renewal/trade-execution
context).
**Build-safety**: partially standalone; the renewal-adjacent pieces need Phase 12.
**Recommendation**: needs-author-review.

### Phase 15 — Redraft tests
**Purpose**: the test suite for Phases 12–14 — 46 files under `__tests__/redraft/` covering
draft-finalize, trade-reversal, renewal contracts, week-advancement concurrency, team-defense
scoring, and more.
**Files**: 46, all NEW.
**Migration**: none. **Depends on**: Phases 12–14 must land first for these to have anything real
to test against.
**Recommendation**: hold — land alongside or immediately after Phases 12–14, run them for real
before trusting the redraft phases are actually sound (they were never run in this git history).

### Phase 16 — League Hub UI wiring
**Purpose**: `app/league/[leagueId]/` tab components (PlayersTab, TeamTab, TradesTab,
redraft-specific Standings views), `components/league-hub/*`, `CommissionerSettingsModal.tsx`.
**Files**: 14 across `app/league/` (8) and `components/league-hub/` (6). One file,
`app/league/[leagueId]/LeagueShell.tsx.settings-close-backup`, is a stray backup artifact (not
real source — flag for deletion, not inclusion).
**Migration**: none. **Depends on**: Phase 11 (reads from the league-hub assembly layer).
**Recommendation**: needs-author-review.

### Phase 17 — Commissioner-OS / User-OS / Decision-OS test suites
**Purpose**: the remaining OS-layer test coverage not already bucketed into a shared-services
phase — `__tests__/commissioner-os/` (12), `__tests__/user-os/` (10), `__tests__/decision-os/` (8).
**Files**: 30, all NEW.
**Migration**: none. **Depends on**: Phases 5–11.
**Recommendation**: hold — same reasoning as Phase 15, run for real before trusting.

### Phase 18 — NCAAF / CFBD provider
**Purpose**: `lib/ncaaf-provider/*`, `scripts/import-ncaaf-players-cfbd.ts`,
`scripts/refresh-ncaaf-pool-cfbd.ts`, `__tests__/cfbd-ncaaf-player-import.test.ts` — a real
college-football data provider integration (CFBD is a real, already-configured key per this
session's own live-sports-layer audit).
**Files**: ~6, all NEW.
**Migration**: none. **Depends on**: nothing.
**Recommendation**: safe-to-take-as-is — self-contained, and CFBD is already confirmed real and
wired elsewhere in this codebase.

### Phase 19 — Plugin framework
**Purpose**: `lib/plugin-framework/*` (9 files) — matches this session's long-standing
"Plugin architecture vision" (one core engine; league/draft/scoring/AI as config plugins).
**Files**: 9 NEW, 1 test (`__tests__/plugin-framework-contract.test.ts`).
**Migration**: none. **Depends on**: nothing directly, but its value is realized once other
subsystems adopt it.
**Recommendation**: needs-author-review — worth checking whether this is scaffolding-only or
actually wired into a real consumer before approving.

### Phase 20 — League lifecycle engine
**Purpose**: `lib/league-lifecycle-engine/*` — real lifecycle-state transition logic, likely the
engine backing Phase 12's `LeagueRenewalStatus`/lifecycle enum additions.
**Files**: ~8, all NEW.
**Migration**: none directly. **Depends on**: Phase 12 (shares lifecycle state enums).
**Recommendation**: needs-author-review.

### Phase 21 — Admin dashboard tools
**Purpose**: `components/admin/ApiHealthPanel.tsx`, `VisitorAnalyticsPanel.tsx`,
`VisitorGlobePanel.tsx`, `lib/admin-dashboard/ApiHealthService.ts`,
`lib/admin-dashboard/VisitorAnalyticsService.ts`, `lib/analytics/recordSiteVisit.ts`,
`app/api/admin/api-health/`, `app/api/admin/visitor-analytics/`.
**Files**: 8, all NEW.
**Migration**: none. **Depends on**: nothing.
**Recommendation**: safe-to-take-as-is — internal tooling, no user-facing risk, self-contained.

### Phase 22 — Matchup Center + live scoring surfaces
**Purpose**: `components/matchup-center/*` (7 files: MatchupAiAnalysisPanel, MatchupHeaderCard,
MatchupInsightsPanel, MatchupStartSitModal, MatchupStarterRow, MatchupTabContainer,
MatchupWeekSelector), `__tests__/live-scoring/`, `server/services/matchupCenterService.ts` (if
present — this file was seen as MODIFIED in the original uncommitted diff; confirm it's in this
rescue set before approving).
**Files**: ~14. **Migration**: none. **Depends on**: Phase 9 (game-day service).
**Recommendation**: needs-author-review — this is a live, user-facing surface (the same
`buildMatchupCenterPayload` this session's own Prompt 8 work already reused for Portfolio
Analytics), so changes here deserve real browser verification before shipping.

### Phase 23 — UI component library refresh
**Purpose**: `components/ui/*` — AppModal, badge, button, card, dialog, input, select, skeleton,
switch, table, textarea (11 files). Likely design-token consumers.
**Files**: 11, all MODIFIED (pre-existing components, not new).
**Migration**: none. **Depends on**: Phase 1 (tailwind tokens) — if these components reference the
new semantic color tokens Phase 1 adds, they'll look broken without it.
**Recommendation**: needs-author-review — these are broadly-used base components; a visual regression
pass across the app is warranted given how many surfaces consume them.

### Phase 24 — My Players / Cross-League Player workspace
**Purpose**: `app/my-players/*`, `__tests__/cross-league-player/*` — matches this session's
memory ("Cross-League Player Intelligence Platform", Phase 9-ish body of work already
substantially documented and validated per memory).
**Files**: ~6, mostly NEW.
**Migration**: none. **Depends on**: nothing new (Cross-League Player service itself already
shipped on mainline per memory).
**Recommendation**: safe-to-take-as-is, pending a quick check that it doesn't duplicate
already-shipped Cross-League Player UI.

### Phase 25 — Documentation (`docs/os/`, `docs/redraft/`)
**Purpose**: 158 + 83 = 241 markdown files. Pure documentation — audit reports, readiness
assessments, architecture specs, phase closeout reports for every subsystem above. Zero code, zero
build risk, zero migration risk.
**Files**: 241, all NEW `.md`.
**Migration**: none. **Depends on**: nothing (docs don't need their described code to exist to be
committed, though they're obviously most useful alongside their corresponding phase).
**Recommendation**: safe-to-take-as-is — could even land as its own single commit independent of
every code phase above, since it carries zero technical risk. The main judgment call is whether
241 files of internal audit trail belong in the permanent git history or should be pruned/
consolidated first — a product/repo-hygiene call, not a safety one.

---

## Exclude — session debris (not a phase, recommend discard)

22 files that are session artifacts, not product source, and shouldn't be taken in any phase:

```
AF_BUILD_PLAN.md, AF_DEPLOY_RUNBOOK.md, AF_NEXT_BUILDS.md, RANK_AND_IMPORT_FIXES.md
audit-redraft-creation.ps1
bad-code-path-directories.txt
canonical-draft-room-audit.txt
draft-room-speed-pool-readiness-audit.txt, draft-room-speed-pool-readiness-search.txt
live-draft-regression-audit.txt, live-draft-regression-search.txt
redraft-api-call-map.txt, redraft-build-audit.txt, redraft-critical-files.txt,
redraft-finalization-audit.txt, redraft-finalization-services-audit.txt,
redraft-nfl-ncaaf-build-audit.txt, redraft-players-roster-repair-audit.txt,
redraft-post-draft-waiver-audit.txt, redraft-prisma-models-audit.txt, redraft-targeted-audit.txt
repo-audit.txt
app/league/[leagueId]/LeagueShell.tsx.settings-close-backup
local-backups/pre-redraft-local-changes.patch
app/auth/callback_TEMP/page.tsx
```

Note: `AF_DEPLOY_RUNBOOK.md` is a duplicate of a file that may already exist elsewhere in history
under the same name (worth a diff before assuming it's pure debris) — flagging rather than
asserting.

---

## Methodology note

This plan was built from `git diff --name-status` path analysis, directory-structure grouping,
cross-referencing this session's own persistent memory (which documented the original build of
most `lib/shared-services/*` and `lib/redraft/*` subsystems phase-by-phase as they were built,
before this branch's history was lost to the uncommitted-state incident), and one direct
read-only production database query (the 8-migration cross-check in Phase 12). It is **not** a
line-by-line content review of all 966 files — the file-count/dependency claims per phase are
derived from paths and import-graph plausibility, not exhaustive code reading. Before actually
approving any phase beyond Phase 1/2/18/21/24/25 (the ones marked safe-to-take-as-is), a real
`npm run build` + `npm run typecheck` pass with just that phase's files staged is the
recommended next step — this document tells you *what* to stage together, not that it's already
been proven to compile.
