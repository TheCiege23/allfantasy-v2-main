# Feature Flag and Rollout Audit (Phase 39, Part 6)

## Mechanism 1: Centralized DB-driven flags — `FeatureToggleService` + `PlatformConfigResolver`

Real, backed by `prisma.platformConfig`, with a 30-second in-memory cache. Allows real runtime flag changes without a redeploy. **Confirmed gap**: no admin UI write-path was found — only a script/direct-DB-write path. This means flipping one of these flags today requires either direct DB access or running a script, not a UI action a non-engineer could safely perform.

## Mechanism 2: Ad hoc dual client/server `NEXT_PUBLIC_*_ENABLED` env-var pairs

Example: `MANAGER_REPLAY_INSIGHTS_DASHBOARD_ENABLED` + `NEXT_PUBLIC_MANAGER_REPLAY_INSIGHTS_DASHBOARD_ENABLED`. The component's own comment explicitly discloses "both must be on" — a real, self-acknowledged client/server-disagreement risk (if only one of the pair is set, behavior is inconsistent between server-rendered and client-rendered paths). Changing one of these requires a Vercel env var change + redeploy, unlike Mechanism 1's live DB flags.

## Mechanism 3: `ALL_ACCESS_USERNAMES` allowlist

A real, separate mechanism gating certain surfaces to specific known usernames — orthogonal to both flag systems above, used for staged/internal-only rollout of a feature to specific accounts rather than a percentage or environment-wide toggle.

## Rollout-path assessment for this session's recent fixes

| Fix | Phase | Safe rollout path available? |
|---|---|---|
| Manager Hub retention-risk logic (`insufficient_data` bucket) | 36 | No feature flag wraps this — it's a pure logic correction to an existing computation (fixing `atRiskLeagueCount` overcounting), not new UI. Rollout is "ship the fix," not "gate behind a flag," since the prior behavior was simply wrong (8/8 always-critical), not a deliberate variant. |
| Matchup Center bye/unavailable truthfulness fix | 34 | Same category — a correctness fix to existing logic, not new functionality. No flag exists or is warranted; the fix corrects a factual misrepresentation (conflating "no data" with "bye"). |
| Provider `roster_positions` normalization fix (ESPN/Yahoo/MFL bench-slot counting) | 38 | Same category — a correctness fix inside `canonicalImportNormalizer.ts`'s existing bench-slot computation, applied to all imports of those 3 providers uniformly. No flag exists; none is warranted for a pure bug fix with no plausible "old behavior was actually fine for some users" case (the old exact-match filter never matched aggregated `"SLOT:count"` strings — the bug affected 100% of ESPN/Yahoo/MFL imports uniformly, not a subset). |
| Decision OS schema-dependent functionality (3 recovered tables) | 35 | This was a `.env.test`-only database migration (applying missing migrations to a non-prod validation DB). **Production's own database was not touched or verified this phase** — whether production's DB already has these 3 tables (via its own separate migration history) or is missing them too was not re-checked this phase. This is a real, disclosed open question the Controlled Rollout Plan flags explicitly. |
| Non-Sleeper provider imports (ESPN/Yahoo/Fantrax/MFL/Fleaflicker) | 38 | These are live, ungated production code paths already — there is no flag hiding them from real users today. The Provider Truthfulness Report (Phase 38) already recommended, but did not implement, adding honest `coverage`-block disclosures for ESPN's IDP gap and MFL's scoring-rule weakness. |

## Real gap this Part surfaces

None of this session's real, validated correctness fixes (Phases 33, 34, 36, 38) were gated behind either flag mechanism — and, per the assessment above, that's largely appropriate (they are bug fixes to existing, already-live logic, not new features needing staged exposure). The one genuine rollout risk is Phase 35's database migration: **it is unknown, and unverified this phase, whether production's database already has the 3 Decision OS tables this phase applied to `.env.test`.** If production is missing them too, any code path depending on them (Manager OS, Decision OS real-execution paths) would fail in production today independent of anything else in this session.

**Classification: Absent** (no admin-UI-driven flag write path) for Mechanism 1; **Implemented but unverified** for whether production's DB schema matches `.env.test`'s post-migration state.

## What this Part did not do

No new flag was created for any of this session's fixes (per the assessment above, none needed one). No admin UI was built for Mechanism 1 (a real gap, but building one is a substantial new feature, out of "smallest justified corrections" scope).
