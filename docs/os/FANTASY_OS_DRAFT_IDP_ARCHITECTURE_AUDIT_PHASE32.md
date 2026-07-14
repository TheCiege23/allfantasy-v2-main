# IDP Architecture Audit (Phase 32)

## Fresh audit: where does defensive-player data actually live?

Per this phase's explicit instruction, prior audits were not trusted — every claim below was independently re-verified this phase.

| Layer | Real IDP support found |
|---|---|
| `SportsPlayer` | **Yes** — 6,712 real NFL rows across DE/DT/LB/CB/DB/DL/S position values (measured directly). |
| `lib/sport-teams/SportPlayerPoolResolver.ts` (frozen shared resolver) | **Yes, already IDP-aware.** `NFL_IDP_GROUP_MAP` (DL→[DE,DT], DB→[CB,S], IDP_FLEX→[DE,DT,LB,CB,S]) and `NFL_IDP_POSITION_ALIASES` (EDGE→DE, OLB/ILB/MLB→LB, SS/FS→S, NT→DT) already exist. `getPlayerPoolForLeague()` returns defensive players by default (no position filter applied unless explicitly requested) — Draft OS's own pool query already includes them today, unfiltered. |
| `lib/multi-sport/RosterTemplateService.ts` | **Yes, already IDP-aware.** Real `NFL_IDP_EXTRA_SLOTS` (DE:2, DT:1, LB:2, CB:2) and `NFL_IDP_FLEX_SLOTS` (DL, DB, IDP_FLEX) define a complete default IDP roster template — but this branch only activates when `formatType === 'IDP'` is explicitly passed in. |
| `lib/idp/` (15+ files) | **Yes, extensive.** A dedicated `IdpLeagueConfig` Prisma model (`positionMode`, `rosterPreset`, `slotOverrides`, `scoringPreset`, `scoringOverrides`), `isIdpLeague()`, `getRosterDefaultsForIdpLeague()`, scoring presets (`balanced`/`tackle_heavy`/`big_play_heavy`), eligibility services, and an AI chat integration (`idpChimmy`) already exist. |
| `AllFantasyAdpSnapshot` | **Thin.** 21 real CB entries, 0 for DE/DT/LB/S. See Part 2/3 below for the real-data caveat on these 21 entries. |
| `lib/draft-helper/RecommendationEngine.ts` (before this phase) | **No.** `FOOTBALL_POSITION_TARGETS` had no DE/DT/LB/CB entries; `FLEX_SLOT_NAMES` was missing `DL`/`DB`/`IDP_FLEX` (present in `RosterTemplateService.ts`'s own copy of this concept, but not mirrored here). |
| `lib/shared-services/draft/DraftContextAssembler.ts` (before this phase) | **No — a real, previously undetected bug.** Both `buildDraftDecisionContext` and `buildHistoricalContext` called `getRosterTemplate(league.sport, 'standard', leagueId)` with a **hardcoded** `'standard'` format string, making `RosterTemplateService.ts`'s real IDP branch (gated on `formatType === 'IDP'`) permanently unreachable from Draft OS — even for a real IDP league. |

## The real bug and the real fix

`lib/league/getEffectiveLeagueRosterTemplate.ts` (docstring: "Draft, waivers, lineup, and AI should consume this... not ad hoc slot strings") already establishes `isIdpLeague(leagueId)` as the canonical, real, reusable IDP detector — used by 6+ other real callers (`idpChimmy.ts`, `idpCapChimmy.ts`, `idpChimmyLeagueChat.ts`, etc.). Draft OS never called it. This phase's fix is narrow and surgical: resolve `rosterFormatType = (await isIdpLeague(leagueId)) ? 'IDP' : 'standard'` and pass it into the existing `getRosterTemplate()` call — no redesign, no new resolver, reuse of an already-real function.

## Scope boundary: what this phase does NOT do

Per the explicit guardrail "do not invent defensive player values": this phase adds real ROSTER-CONSTRUCTION awareness (position targets, flex-slot eligibility) to `RecommendationEngine.ts`, mirroring the exact same position-level scope discipline established for PPR/Dynasty/2QB/TE Premium in Phases 29-31. It does **not** attempt to build a stat-based defensive player valuation system (sack/tackle-point-driven relative value) — that would require real per-player projected defensive stats, which the engine has no access to (same class of gap disclosed for offensive receiving-role differentiation in Phase 29). The real `IdpLeagueConfig.scoringPreset`/`scoringOverrides` exist but are not read by this phase's fix; 0 real leagues populate them anyway (see Part 2).
