# Canonical Imported-League Lifecycle

Date: 2026-07-12. This is the centerpiece deliverable of the ESPN
Commissioner Import Certification phase — it is what makes every future
provider (Yahoo, MFL, Fantrax) benefit automatically from this phase's work,
rather than needing its own Trade-OS-reachability fix.

## The problem

Before this phase, an imported league (any provider) got a real `League`,
real `LeagueTeam` rows, and a real `Roster` per manager — but no
`RedraftSeason`. Trade Decision OS (`lib/decision-os/trade/loader.ts`)
reads `redraftRoster`/`redraftSeason` exclusively, and only draft-completion
(`finalizeDraftToRedraftSeason.ts`) or season-renewal (`createNextSeason.ts`)
ever created those rows. A freshly-imported league — the single most common
way a real commissioner's data enters the platform — had no season, so Trade
Decision OS silently returned `null` for every imported league, forever,
with no path to fix it short of running an entire fake draft.

## The decision

**Fix this at the canonical layer, once, provider-agnostically — not inside
Trade OS, and not by touching the renewal engine.**

A new, standalone module, `lib/league-import/canonicalSeasonMaterialization.ts`,
exports `materializeRedraftSeasonForImportedLeague(leagueId)`. It:

- Reads only `League` and `LeagueTeam` — the tables every provider's commit
  path already writes to via the shared `bootstrapLeagueFromNormalizedImport`
  function. **No provider branch exists in this file, and none is needed.**
- Creates exactly one `RedraftSeason` (status derived honestly from the
  real `League.status` this phase also started populating correctly — see
  `SLEEPER_COMMISSIONER_IMPORT_CERTIFICATION.md` §4 and
  `ESPN_COMMISSIONER_IMPORT_CERTIFICATION.md`) and one `RedraftRoster` per
  `LeagueTeam`, preserving real wins/losses/ties/points/rank.
- Is idempotent: a second call for the same `(leagueId, season)` returns the
  existing season, never a duplicate.
- Never fails the import: called non-fatally from
  `ImportedLeagueCommitService.ts` (`persistImportedLeagueFromNormalization`),
  in the same best-effort `try/catch` pattern every other post-commit
  bootstrap step already uses (draft/waiver/playoff/schedule config,
  historical backfill).

**What this deliberately does NOT do**: it does not touch
`lib/redraft/renewal/**`, does not create a second `RedraftSeason`-like
model, does not change `RedraftSeason`'s schema, and does not run inside the
renewal engine's transaction. It reuses the exact models the renewal engine
already reads and writes — the same "canonical" tables, not a parallel
lifecycle system. Confirmed compatible with the existing (untouched)
`evaluateNextSeasonEligibility` renewal-eligibility evaluator via a real
physical test (see §"Physical proof" below) — a materialized-from-import
season is indistinguishable from a materialized-from-draft season to the
renewal engine.

## Why this wasn't already possible via existing bootstrap steps

`bootstrapLeagueDraftConfig`/`bootstrapLeagueWaiverSettings`/
`bootstrapLeaguePlayoffConfig`/`bootstrapLeagueScheduleConfig` (the other
post-commit bootstrap steps) were checked and confirmed to touch none of
`RedraftSeason`/`RedraftRoster` — they configure *settings* tables, not the
season/roster tables Trade OS reads. This was a genuine, previously-uncovered
gap, not a duplicate of existing work.

## Physical proof (real disposable database, two real providers)

Against `br-green-lab-admi6kkj`:

- **Sleeper** (real league `1183209979182518272`, 18 teams): materialization
  created a real `RedraftSeason` (18 `RedraftRoster` rows); a second call
  was idempotent (same season id, no duplicates); `loadTradeWorldFacts`
  reached and returned real facts (`sport:'NFL', currentWeek:1`).
- **ESPN** (real public league `899513`, season 2023, 10 teams): identical
  result with zero code changes — materialization created a real
  `RedraftSeason` (`status:'complete'`, matching the league's real
  `isFinished:true`), 10 real `RedraftRoster` rows; `loadTradeWorldFacts`
  reached and returned real facts; `resolveManagerIntelligencePayload`
  (Manager OS) reached and returned a real payload; `getDashboardLeagueListForUser`
  found the league. A real duplicate-import attempt was correctly rejected
  (`ImportedLeagueConflictError`, exactly 1 `League` row survived). The
  existing, untouched renewal eligibility evaluator
  (`evaluateNextSeasonEligibility`) evaluated the ESPN league's materialized
  season as `eligible:true, violations:[]` — real proof the renewal engine
  needs zero changes to work with an imported-then-materialized season.

This is the load-bearing evidence for the phase's Primary Goal: the same,
unmodified downstream consumers (Trade OS, Manager OS, Dashboard, Renewal)
now work identically for a Sleeper import and an ESPN import, using zero
provider-specific code in any of those four consumers.

## Known, disclosed remaining gap: Rankings

Rankings (`lib/rankings-engine/league-rankings-v2.ts`) was investigated for
this phase's Part 5 decision and found to be **architecturally coupled to
Sleeper specifically**, not just to the legacy `legacyLeague`/`legacyRoster`
tables as previously assumed. Its roster-record model is keyed throughout by
Sleeper's own numeric `roster_id` (weekly-scoring cache, draft-pick
matching, trade efficiency, and playoff-bracket computation all key off
`roster.roster_id`, sourced from a live Sleeper API call as a computational
fallback, not merely a cached snapshot). Making Rankings genuinely work from
canonical, provider-agnostic data would require re-typing and re-deriving
this entire pipeline around canonical roster identity — a substantial,
separate rewrite, not a "minimum safe migration" of which table to query.

**Decision**: do not attempt a shallow swap this phase. A shallow fix would
either risk the real, currently-working Sleeper Rankings (high blast
radius, user-facing) or produce something that queries canonical tables
without actually computing correct rankings for a non-Sleeper league,
which would fail the brief's own "verify Rankings immediately works" bar
while looking superficially done. This is flagged as a real, separately-scoped
future initiative, not silently deferred without explanation. Full dependency
detail: `RANKINGS_PROVIDER_DEPENDENCY_INVENTORY.md` (Yahoo phase).

## Update — Yahoo Commissioner Import Certification phase (2026-07-12)

No code changes were needed to this module for Yahoo — confirming the
provider-agnostic design goal. The real blocker for Yahoo turned out to be
upstream of this module entirely: a disconnected OAuth-to-import-pipeline
token store (see `YAHOO_COMMISSIONER_IMPORT_CERTIFICATION.md` §2), fixed
separately in `app/api/auth/yahoo/callback/route.ts`. Once a real Yahoo
league reaches `persistImportedLeagueFromNormalization` at all, this module
requires zero Yahoo-specific work — the same architectural guarantee already
proven twice (Sleeper, ESPN) extends by construction, not by re-implementation.

## Update — MFL Commissioner Import Certification & Fantrax Product Decision phase (2026-07-12)

**Fantrax: physically proven, the third real provider.** A real
`FantraxLeague` snapshot row (2 teams, real standings/matchups/roster JSON)
was pushed through the unmodified commit pipeline. Result: a real `League`
(`status:'complete'`, matching the new Fantrax status-mapping fix), 2 real
`LeagueTeam`/`Roster` rows, and — with zero Fantrax-specific code — a real
`RedraftSeason`/`RedraftRoster` pair. `loadTradeWorldFacts` reached and
returned real facts. Duplicate-import correctly rejected; exact replay
idempotent. This is the strongest evidence yet that the module's
provider-agnostic design holds even for the most architecturally different
provider (file-upload-based, not a live API at all).

**MFL: architecturally guaranteed, not independently re-proven.** No real
MFL API key was available anywhere this phase (checked disposable DB and
production, read-only, zero rows). Since this module reads only
`League`/`LeagueTeam` — tables MFL's commit path already writes to via the
same shared bootstrap function proven for three other providers — there is
no structural reason to expect different behavior, but this is disclosed as
an architectural inference, not a fourth physical proof.

The module has now been physically proven for Sleeper, ESPN, and Fantrax —
three structurally different provider models (keyless live API,
cookie/public live API, and file-upload snapshot) — with the same zero-line
provider-specific footprint each time.

## Update — Import Security Closure phase (2026-07-12)

**Zero changes to this module.** This phase's entire scope (MFL membership
verification, ESPN/Yahoo attestation requirement, Fantrax `AppUser`
ownership) lives in the authorization layer that runs *before* a commit
ever reaches `persistImportedLeagueFromNormalization` — `commissionerGate.ts`
and the Fantrax upload/read routes — not inside canonical materialization
itself. This is the expected shape of the fix, not an oversight: this
module's job is "given an already-authorized, already-committed canonical
league, materialize its season" — it has no opinion on who was allowed to
commit it, and this phase correctly left that boundary alone.

Fantrax's re-run this phase (proving the new `appUserId`-owned snapshot
still flows end-to-end through this exact module) used the identical code
path already proven in the prior phase — no new assertions were needed
about materialization itself, only about the ownership check now gating
entry to it. The module's provider-agnostic guarantee (Sleeper, ESPN,
Fantrax physically proven; MFL, Yahoo architecturally inferred) is
unchanged by this phase.
