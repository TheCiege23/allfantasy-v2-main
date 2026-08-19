# Redraft Full-Lifecycle Audit (G14) — NFL + NCAAF

**Date:** 2026-06-27
**Scope:** NFL Redraft and NCAAF Redraft, from league creation → settings → invites/team
setup → draft → roster finalization → schedule → lineups → waivers/FA → trades → live
scoring → standings → playoffs → champion → archive/renewal.
**Method:** code audit grounded in the actual implementation + three fresh evidence runs:

| Evidence run | Command | Result |
|---|---|---|
| NFL full-season **engine** harness (real staging DB) | `node --import tsx scripts/run-nfl-full-season-engine-e2e.ts` | **PASS 32 · FAIL 0 · BLOCKED 0 · SKIP 0** |
| Redraft **test suite** | `vitest run __tests__/redraft/` | **31 files / 383 tests passed** |
| NFL **browser proof** (production `next start`, non-prod DB) | `e2e/g8-team-defense-browser.spec.ts` (`RUN_G8_DST_BROWSER=1`) | **1 passed (2.0m)** — see `docs/g8-team-defense-browser-verification.md §G13` |

> The engine harness drives **real engine functions against a real database** (scoring,
> waivers, trades, lineup locks, standings, playoffs, champion) under an isolated,
> cascade-cleaned league. It is the authoritative back-half proof; the browser proof is the
> authoritative front-half + live-experience proof.

---

## Architecture note (Core engine is sport-agnostic — keep it that way)

The redraft engine **is** the reusable Core Fantasy Engine. Sport-specific behavior is
isolated, not forked:

- **Core (sport-agnostic):** `lib/redraft/*` — `scoringEngine`, `standingsEngine`,
  `playoffEngine`, `waiverEngine`, `tradeEngine`, `scheduleEngine`, `lineupLock`,
  `lineupValidation`, `redraftSeasonScoringRunner`, `playerWeeklyScoreService`.
- **Sport plugins:** `lib/redraft/sportAdapters/{nfl,ncaaf,nba,nhl,mlb,ncaab,soccer}.ts`
  (`parseRawStats` + lock time) and the canonical config layer
  `lib/sportConfig/configs/{nfl,ncaaf,...}.ts` (scoring categories, roster slots, schedule
  defaults, playoff defaults, feature flags).
- **Sport services:** `lib/{nfl,ncaaf}-{roster,scoring,schedule}/*` for per-sport
  templates/presets/config.

This is healthy plugin architecture and must be preserved for Dynasty/Keeper/Best Ball/
Guillotine/Survivor/Tournament/Devy/C2C/IDP. No fix in this pass hardcoded NFL into Core.

---

## NFL Redraft

### Production-ready (verified this pass)
- **League creation → playable season.** Canonical create → draft finalize → active
  `RedraftSeason` is architecturally sound (G12) and browser-proven end-to-end (G13).
- **Scoring settings → engine.** Commissioner scoring (TE premium, custom pass-TD,
  PPR/standard, DST D1–D9 incl. return yards, legacy `nfl_scoring_config` fallback) all
  flow to the engine via the canonical `sportConfig.categoryPoints` bridge. *(harness
  S1–S2, D1–D9; `scoring-key-bridge.test.ts`, `commissioner-scoring-contract.test.ts`)*
- **Rosters / lineups / locks.** Starter/bench/FLEX/SF/K/DEF/IR slots; SF config read from
  DB; per-player kickoff lock; commissioner emergency unlock. *(harness 8–9, L1–L3, RC1;
  `lineup-lock-engine.test.ts`, `lineup-validation.test.ts`,
  `commissioner-roster-validation.test.ts`)*
- **Schedule generation.** Round-robin with bye support for odd team counts; deterministic
  ordering; `createdAt`→`id` ordering bug fixed in G11‑4G. *(`schedule-generator-ordering.test.ts`,
  `draft-finalize-schedule.test.ts`)*
- **Waivers / FAAB.** Add + drop + FAAB debit; window processing. *(harness 14–16;
  `waiver-scoring.test.ts`, `waiver-watchlist-service.test.ts`, `add-drop-errors.test.ts`)*
- **Trades.** Proposal → accept with a **race guard (exactly one finalize wins)**;
  canonicalization; settlement; commissioner veto. AI trade analysis is correctly separate
  from the transaction engine. *(harness 17–19; `trade-settlement.test.ts`,
  `trade-canonicalization.test.ts`, `trade-veto-route.test.ts`)*
- **Live scoring.** Incremental orchestrator tick, scheduled runner, external worker loop,
  matchup-center parity (UI total == engine), SSE to roster/league/dashboard/matchup/feed.
  *(harness MC1, LIVE1–LIVE3; G11 Phases 2–4; G13 browser proof)*
- **Standings.** Wins/losses/PF/PA accumulation across weeks; tiebreaker ordering.
  *(harness 13; `standings-api.test.ts`)*
- **Playoffs → champion.** Bracket generation is **commissioner-gated and settings-driven**
  (`app/api/redraft/playoffs/generate/route.ts`: seeds by wins→PF→PA, power-of-two bracket
  with byes, standard seeded pairings); winner advancement and champion finalization are
  **idempotent**. *(harness 20–25; `playoff-advance.test.ts`, `playoff-finalize.test.ts`)*

### Fixed this pass
- **None.** No genuine bounded production defect surfaced. The two errors thrown during the
  evidence runs were both **non-production artifacts** (see "Investigated, not defects").

### Investigated, not defects
- **`server-only` import errors during canonical create in the tsx harness**
  (`warmLeagueSportsData.ts`, `sleeper/user-lookup.ts`). `server-only` throws whenever it is
  imported outside Next's `react-server` condition — i.e. under tsx. These are caught
  `*_non_fatal` and **do not occur in the real `next start` server** (G13 created leagues
  cleanly). *Caveat:* the harness therefore cannot exercise the post-create steps
  (warm-sports-data, constitution, auto-materialize) — see "Needs proof".
- **`recordRedraftTradeMarketEvent` `findUnique` error in `trade-veto-route.test.ts`.** The
  test's prisma mock doesn't stub `redraftSeason`; the function is explicitly best-effort
  (`try/catch`, "Never throws"), so production is unaffected. Test-mock noise — see
  "Needs proof / test gap".

### Browser-proven (G13, fresh build this session)
Create → finalize (real completion path) → playable active season → live SSE scoring across
roster (4B), league scoreboard (4C), dashboard (4D), activity feed + matchup breakdown (4E),
matchup-center total; engine↔UI parity; DEF readable, no `nfl:def:` leak; zero residue.

### Not browser-proven (engine/DB-proven only — "needs proof")
- **Interactive pick-by-pick browser drafting** (draft-room UI). Carried G13 gap.
- **Multi-user invite → join** (browser proof seeds 2 rosters; real invite/join unproven).
- **Browser** waivers / trades / playoffs / champion **UI clicks** (engine-DB-proven via the
  harness; walkthrough specs exist: `e2e/redraft-waiver-walkthrough.spec.ts`,
  `e2e/redraft-trade-walkthrough.spec.ts` — not run this pass).
- **End-of-season archive / renewal / duplicate-settings UI** (champion + season-complete are
  engine-proven; the history/renew surfaces — `app/api/league/[leagueId]/season-history` —
  are not browser-verified).
- **Post-create bootstrap** (warm sports data, constitution, auto-materialize) — server-only;
  unverifiable by the tsx harness; verify in the real server.

---

## NCAAF Redraft

**Verdict: BETA — blocked by the data provider layer. Already correctly guarded in code.**

### What exists (works)
- **League creation / settings / roster / scoring config.** `NCAAF_CONFIG`
  (`lib/sportConfig/configs/ncaaf.ts`) is complete: scoring categories, roster slots
  (QB/RB/WR/TE/FLX/SF/DEF/K), 13-week season / playoff week 12 / 4 playoff teams, per-player
  kickoff lock, `supportsRedraft: true`. Dedicated services exist
  (`lib/ncaaf-{roster,scoring,schedule}/*`). NCAAF redraft defaults were intentionally added
  (`draft-type-support-matrix.test.ts`).
- **Sport-agnostic Core reuse.** Standings/playoffs/champion would work for NCAAF *if scores
  existed*, because the engine is sport-agnostic.
- **Honest beta guardrails (already wired).** `lib/league/ncaaf-beta-guard.ts` +
  `components/NcaafBetaDataBanner.tsx` render an amber "Beta Data Pipeline" banner with
  `data-testid` on the **Draft** and **Players** tabs; `isNcaafPlayerPoolPending` drives a
  "player pool pending" empty state for devy/c2c.

### What is missing (the blockers)
- **No NCAAF live-stats provider.** `lib/live-scoring/` has `nflLiveStatsProvider.ts`; there
  is **no NCAAF equivalent**. Weekly scoring is **wired for NFL only** —
  `redraftSeasonScoringRunner.ts:97` **skips non-NFL seasons with a `dataWarning`** ("not
  marked successful"), and `score-sync/route.ts` documents the same. **This is honest, not
  faked** — NCAAF cannot complete a real scored season today.
- **Player pool is partial/pending.** Plain NCAAF has partial Sleeper data; devy/c2c have no
  native AllFantasy pool yet (per the beta guard).
- **No NCAAF projections / stat-correction pipeline.**

### Required guardrails — status
| Guardrail | Status |
|---|---|
| Beta label | ✅ `NcaafBetaDataBanner` (amber, testId) on Draft + Players tabs |
| Coverage warning | ✅ banner detail copy + partial-pipeline messaging |
| Commissioner data warning | ⚠️ shown on Draft/Players; **not** surfaced on Scoring/Matchups/Standings |
| Unsupported-feature messaging | ✅ player-pool-pending empty state (devy/c2c) |
| No false live-scoring claims | ✅ scoring runner skips NCAAF with a dataWarning (no fabrication) |

---

## Gap Table

| System | NFL Status | NCAAF Status | Evidence | Fix Made | Remaining Work | Risk |
|---|---|---|---|---|---|---|
| League creation → playable season | ✅ Prod | ✅ Creates (beta data) | G12/G13; harness 1–7 | — | Verify post-create bootstrap in real server | Low |
| Settings → runtime (scoring) | ✅ Prod | ⚠️ Config OK, unscored | harness S1–S2, D1–D9; `scoring-key-bridge` | — | NCAAF needs a scorer | Low (NFL) |
| Invites / team setup | ⚠️ Engine-proven | ⚠️ Same | harness seeds 2 rosters | — | Browser multi-user join proof | Med |
| Draft → finalization | ✅ Prod (type-agnostic) | ✅ Same Core | G12; `draft-finalize-contract` | — | Interactive browser draft proof | Med |
| Rosters / lineups / locks | ✅ Prod | ⚠️ Slots OK; DEF unscorable | harness 8–9, L1–L3, RC1 | — | NCAAF DST data | Low (NFL) |
| Schedule generation | ✅ Prod | ✅ Generic round-robin | `schedule-generator-ordering` | — | Week-0/irregular data-week mapping; manual editor unproven | Low |
| Waivers / FAAB | ✅ Prod | ⚠️ Engine OK, no pool | harness 14–16; `waiver-scoring` | — | Browser waiver proof | Low (NFL) |
| Trades | ✅ Prod (race guard) | ⚠️ Engine OK | harness 17–19; `trade-settlement` | — | Browser trade proof; assert trade-market audit event | Low (NFL) |
| Live scoring | ✅ Prod (NFL only) | ❌ No provider (skipped honestly) | harness LIVE1–3, MC1; G13 | — | **NCAAF live provider** | High (NCAAF) |
| Standings / tiebreakers | ✅ Prod | ✅ Core (needs scores) | harness 13; `standings-api` | — | Browser standings spot-check | Low |
| Playoffs — generation | ✅ Prod (settings-driven) | ✅ Core (needs scores) | generate route; harness 20–22 | — | **Consolation/3rd-place/toilet-bowl not generated**; pure `generatePlayoffBracket` is dead/test-only (duplication); generation is manual (not auto at playoffStartWeek) | Med |
| Playoffs — advance/champion | ✅ Prod (idempotent) | ✅ Core | harness 21–25; `playoff-advance/finalize` | — | Browser advance proof | Low |
| End of season / archive / renew | ⚠️ Champion proven; UI unverified | ⚠️ Same | harness 23–24; season-history route | — | Browser archive/renew proof; convert-to-keeper/dynasty | Med |
| AI (trade/waiver/commish) | ✅ Separate from txn engine | ⚠️ Beta | `lib/redraft/ai/*` | — | Keep AI advisory ≠ transaction | Low |

---

## Readiness Recommendation

**Do not raise readiness on this pass.** This audit *re-verified and broadened* the evidence
base but did not add net-new capability proof (interactive draft, multi-user, browser
waivers/trades/playoffs/archive).

- **NFL Redraft Engine — HOLD at 93%.** The full back-half lifecycle is engine-proven against
  a real DB (32/32) and unit-proven (383 tests); the front-half + live experience is
  browser-proven (G13). It is **capable of hosting a real NFL redraft season** with these
  honest caveats: interactive drafting, multi-user join, and the browser trade/waiver/playoff/
  archive *click paths* are engine-proven but not yet browser-proven. → 94 requires those
  browser proofs (start with the interactive draft-room flow + the existing
  waiver/trade walkthrough specs).
- **NCAAF Redraft — BETA (~73%), unchanged.** League structure, settings, roster, scoring
  config, and draft are usable; live scoring/standings/champion cannot complete because there
  is **no NCAAF stats provider** (honestly skipped, not faked) and the player pool is partial.
  Beta guardrails exist and are wired. → Production requires an NCAAF stats/player-pool
  provider; until then keep the beta label and extend the data warning to the
  Scoring/Standings surfaces.
- **Overall Platform — HOLD at 90%.**

### Recommended next milestone (G15)
1. **NFL browser-clicks proof**: run/repair `e2e/redraft-waiver-walkthrough.spec.ts` +
   `e2e/redraft-trade-walkthrough.spec.ts`, and add a browser playoff-advance + champion +
   archive flow. Closing these is the concrete path to NFL 94.
2. **Interactive draft-room browser proof** (the standing G13 gap).
3. **NCAAF provider spike**: scope an NCAAF weekly-stats provider; until delivered, extend the
   beta data warning to Scoring/Standings/Matchups surfaces.

### Architecture follow-ups (not bounded fixes — flagged, not done)
- Unify playoff bracket generation: make `app/api/redraft/playoffs/generate/route.ts` consume
  the Core `generatePlayoffBracket` (currently dead/test-only) instead of a second inline
  implementation.
- Implement consolation / 3rd-place / toilet-bowl brackets (params accepted but ignored).
- Decide whether playoff generation should auto-trigger at `playoffStartWeek` vs. remain
  commissioner-initiated.
