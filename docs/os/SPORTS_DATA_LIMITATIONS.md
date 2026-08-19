# Sports Data — Known Limitations (Phase 5G, honest disclosure)

Every limitation is documented; none are hidden. These are accepted as part of certification.

## Identity coverage
- **IDP / defensive player identities are unresolved (~21% gap).** Certified statistics resolve at **78.5% of stat rows / 75.4% of unique athletes** deterministically. The remainder are almost entirely defensive/IDP (and a few deep-roster) players. **Both** trusted deterministic sources (Sleeper, FantasyCalc) are fantasy-skill-focused and lack ESPN ids for these players; the only source with espn ids for IDP is ESPN itself, which has **no canonical anchor** (name matching is prohibited). **This is a conclusively external provider-coverage gap, not a code gap.** Closing it requires an IDP-inclusive deterministic espn crosswalk not present in the current provider ecosystem.
- **Some non-IDP players also lack a Sleeper `espn_id`** (e.g. Justin Fields, Sleeper id 7591, `espn_id: null`) — FantasyCalc recovers many of these, but not all.

## Statistics
- **Certified statistics are NOT yet a production scoring input.** The scoring engine still uses `PlayerWeeklyScore` / `PlayerGameLogCache`. Switching requires: (a) closing the IDP identity gap or scoping to resolved players, (b) reconciling resolved canonical ids against the certified players snapshot, (c) a backtest vs existing scoring — all deliberately deferred to a later, separately-proven phase.
- **Statistics certification for a given week requires completed games.** Unplayed/scheduled weeks have empty box scores and are (correctly) not certifiable.

## Not-certified capabilities
- **Injuries:** not certified — no verified provider feed (Sleeper's coarse `injury_status` is not a full availability feed; ESPN injuries endpoint unused; Rolling Insights unverified).
- **Projections:** not certified — no verified provider.
- **Player availability:** not certified — no verified provider.

## Providers
- **Rolling Insights & API-Sports are `configured_not_verified`** — credentials may exist in non-prod but no verified request was performed; they contribute nothing to certification and their declared capabilities are **not** counted.
- **ESPN box-score athlete ids are provider-native** and depend on the deterministic identity map for canonicalization.

## Environment / proving
- **Proving runs use non-production Neon (`cool-lab-87438174`).** The certified legacy players snapshot (5B) is teamless, so player↔game *lock* demonstrations for the lineup/waiver reject paths are unit-proven rather than shown live (the game/identity/statistics plane resolves live at the game and athlete level).
- **Windows local build** always ends in a post-compile `readlink EISDIR` (exFAT/collect-build-traces); `✓ Compiled successfully` is the real signal and it passes on Vercel Linux CI.

## Operational
- **Decision evidence is emitted, not persisted.** Persisting `sportsDataDecision` to an audit table would require an approved production migration (out of scope for the default-off, additive posture).
- **Per-source identity contribution is reported by the population run**, not persisted (no audit table / migration).

## Provider certification limits (Phase 5H-d, 2026-07-13)
- **ClearSports is BLOCKED** — the `api-keys/me` auth probe returns HTTP 500 (provider-side); capabilities are unproven and it must not be presented as connected.
- **Rolling Insights is REQUIRES_WIRING** — its legacy client is DB-coupled and cannot be probed cleanly; a dedicated `providers/rolling-insights.ts` gateway adapter is required before any capability can be verified.
- **TheSportsDB / CFBD / API-Sports are VERIFIED at the request+canonical-normalization level only** — they do NOT yet write certified `sports_data` snapshots (they write legacy Prisma tables), and certified persistence for each is REQ-MIGRATION. Soccer (API-Sports) has no canonical contract yet (REQ-NORMALIZE).
- **NCAAF↔NFL identity continuity is NOT assumed** — a governed college→pro transition mapping is required before CFBD players are linked to NFL identities; name matches alone are rejected.
- **Only ESPN + Sleeper feed the certified plane.** All other verified providers are canonical-ready but not yet persisted certified.

## Canonical persistence limits (Phase 5H-e)
- The 5 canonical tables exist in **non-production only** — production rollout is unauthorized; do not describe them as production-backed.
- **No legacy table was removed or altered**; legacy image/value/stat paths remain the production authority (default-on).
- **No consumer was switched to canonical reads** — all domain gates are default-off; only shadow comparison + minimum proving rows were exercised.
- **No bulk backfill** was run — only the required proving minimum (2 images, 1 value, 1 evidence, 3 events, 1 health).
- Player-table and statistics-table consolidation remain **DESIGN-ONLY** (not authorized).

## Factual-domain limits (Phase 5H-f)
- **Injuries are PROVIDER-VERIFIED (API-Sports)** but api-sports player ids are not yet canonical (identity `unresolved`); production persistence is REQ-MIGRATION.
- **Availability, depth charts, projections are FIXTURE-ONLY** in non-prod — no gateway-certified provider source exists (availability is a merged legacy token; RI depth charts REQUIRES_WIRING; `FantasyProjection` UNPOPULATED, live projections are heuristic/ADP-derived). The database model or a legacy provider path existing does NOT constitute certification.
- **History gaps filled additively:** legacy `PlayerTeamHistory` has a dead writer (unpopulated) and there is no legacy position-history table — the canonical history tables are new (non-prod).
- **Scoring authority UNCHANGED** — certified statistics/projections/values/injuries/availability never change fantasy points; the future scoring-authority migration is design-only with unmet target thresholds.
- Pre-existing caveat (not introduced here): three `PlayerWeeklyScore` writers disagree on `isFinalized` authority.

## Explicitly NOT done (by design, not oversight)
Weakening deterministic identity rules; name/fuzzy/LLM matching; switching production scoring; changing scoring authority; touching production; running production migrations; removing legacy tables; enabling any gate by default; presenting a provider as connected without a real successful request; inferring an injury from inactivity; fabricating provider facts to satisfy minimum counts.
