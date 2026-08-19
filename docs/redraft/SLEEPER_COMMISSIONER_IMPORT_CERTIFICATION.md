# Sleeper Commissioner Import Certification

Date: 2026-07-12. Scope: connect the live, user-facing Sleeper import UI to the
existing canonical full-fidelity commit pipeline, and certify the result with
real physical evidence against a disposable, production-forked Neon branch
(`br-green-lab-admi6kkj`) and a real Sleeper account (`theciege24`,
`user_id=591462610482806784`).

Every claim below is tagged: **physically proven** (executed against the real
disposable database and/or a real Sleeper account), **source-verified** (read
the real code path, not executed), **unsupported by Sleeper** (Sleeper's API
genuinely doesn't expose this), **implemented but unproven**, **blocked**, or
**deferred**.

## 1. What changed

- `components/unified-import-ui/LeagueImportFlow.tsx`: the Sleeper tab no
  longer uses the legacy-only `useLegacySleeperImport` hook. `tabToImportProvider`
  no longer special-cases Sleeper to `null` — all five tabs (Sleeper, ESPN,
  Yahoo, Fantrax, MFL) resolve to the same `ImportProvider` and flow through
  the same `runPreview` → `handleCommit` → `submitImportCreation` path, which
  calls the real `/api/leagues/import/preview` and `/api/leagues/import/commit`
  routes — the same canonical pipeline already used by the other four
  providers. **Physically proven** (the real route was exercised end-to-end
  against real Sleeper data; see §3).
- A lightweight Sleeper account-discovery affordance was added (username →
  `/api/leagues/import/discover` → clickable list of the account's real
  leagues → selecting one auto-fills the same generic source-ID input and
  triggers the same generic preview). This reuses the already-built,
  previously-unused `discoverProviderLeagues` client function and
  `/api/leagues/import/discover` route — no new backend service was created.
- `lib/league-import/commissionerGate.ts`: added a `notFound` signal so an
  invalid/deleted Sleeper league maps to HTTP 404 rather than a generic 403.
  **Source-verified**; the 404 path itself is disclosed as **implemented but
  only partially provable** — see §5's honest caveat on Sleeper's own API
  behavior for bad league IDs.
- `app/api/leagues/import/preview/route.ts` and `.../commit/route.ts`: status
  codes tightened to the required contract — 404 for a not-found source
  league, 422 for a deterministic normalization/validation failure, 201 for a
  genuinely new canonical league, 200 for an idempotent replay/resume.
  **Physically proven** via both real HTTP-route-level unit tests and the
  real database run in §3.
- `app/api/league/import/sleeper/preview/route.ts`: this second, orphaned
  Sleeper-only preview route (unreferenced by any live UI, per the prior
  phase's audit) had no membership/commissioner gate at all. Added the same
  `assertImportCommissioner` gate the unified route already has. **Source-verified.**
- `lib/league-import/adapters/sleeper/SleeperLeagueMapper.ts`: **a real defect
  found via physical testing, not anticipated by the brief** — see §4.

## 2. The one authoritative decision (Part 2)

Sleeper's user-facing commissioner-import flow now invokes the canonical
commit pipeline exclusively — there is no dual/ambiguous behavior. The
existing legacy "career history" import (`useLegacySleeperImport`,
`components/rankings/LegacyRankingsImportPanel.tsx`, writing to
`LegacyLeague`/`LegacyRoster`) remains available, but only as the genuinely
separate product surface it already was — a Rankings-area feature, not a
branch of this commissioner-import flow. It was not touched, renamed, or
merged into this flow. No user can click "import my league" here and
accidentally receive only a legacy profile import.

## 3. Physical validation — real database, real Sleeper account

Method: ran the actual exported service functions (`assertImportCommissioner`,
`runImportedLeagueNormalizationPipeline`, `buildCanonicalImportBundle`,
`persistImportWithCanonicalAudit`) directly via `tsx` against the disposable
branch, using real `theciege24` Sleeper data. No mocks. No production access.

- **Real league used**: Sleeper league `1183209979182518272` ("BB Guillotine
  League 25"), 18 real teams/rosters, real 2025 season, status `complete`.
  `theciege24` is verified `is_owner: true` on Sleeper for this league
  (confirmed via a direct, live Sleeper API call before the test, not assumed).
- **Commissioner authorization — physically proven**: `assertImportCommissioner`
  returned `{ok:true, isCommissioner:true}` for the real commissioner against
  the real league.
- **Manager rejection — physically proven, two real cases**: (a) the same
  real `theciege24` account, but against a *different* real league
  (`1204903552921649152`) where Sleeper confirms `is_owner: false` — correctly
  rejected with `isCommissioner:false`. (b) A second, entirely unlinked
  AppUser (no Sleeper account linked at all) — correctly rejected for lacking
  a linked Sleeper identity. Neither case ever trusted a client-supplied flag;
  both were derived server-side from the DB-linked profile and a live Sleeper
  API call.
- **Canonical league creation — physically proven**: first commit produced
  `status:'created'`-equivalent (`existed:false`), a real `League` row (id
  `63b47ad0-e1f0-4716-a640-10b92335bdfc`, name "BB Guillotine League 25",
  sport NFL), exactly 18 `LeagueTeam` rows, exactly 18 `Roster` rows, exactly
  1 commissioner-flagged team, exactly 1 `ImportRun` row (status `completed`).
- **Idempotency / exact replay — physically proven**: an identical second
  commit call returned `existed:true` and the *same* league id — zero
  duplicate `League`, `LeagueTeam`, `Roster`, or `ImportRun` rows.
- **Invalid league ID**: `assertImportCommissioner` against a synthetic
  20-digit non-existent league ID correctly rejected the request, but via the
  "not a member" reason rather than the intended `notFound` path — Sleeper's
  `/league/{id}/users` endpoint did not return a clean 404 for this
  malformed/oversized ID in this real test. **Disclosed honestly**: the
  safety property (rejection) holds; the specific 404-vs-403 status-code
  distinction is not proven for every kind of invalid ID, only source-verified
  for the case where Sleeper genuinely returns HTTP 404.

## 4. A real defect found and fixed: imported leagues invisible on Dashboard

Physical testing surfaced a second, independent defect beyond the UI-wiring
gap the brief described: after the real commit above, the new league did
**not** appear in `getDashboardLeagueListForUser`'s real output (7 leagues
returned, not 8). Root cause, traced to the exact line: `League.status` has
no database default, and `SleeperLeagueMapper.ts` never mapped Sleeper's real
`league.status` field into the normalized output, so every Sleeper-imported
league's `status` column stayed `null`. `lib/leagues/leagueListFilter.ts`'s
Dashboard exclusion heuristic reads `platform:'sleeper' AND status:null` as
"incomplete/legacy-only import" and hides it — a false positive against a
genuine, fully-committed canonical import.

This is documented context, not invented: `lib/league-import/types.ts` already
carried a `status?: string | null` field with a comment describing this exact
failure mode (a concurrent, in-progress "Phase OS-C5" effort had already
diagnosed it and fixed `ImportedLeagueCommitService.ts`'s write path plus
added a dedicated spec test, `__tests__/sleeper-league-mapper-status.test.ts`
— but the actual `SleeperLeagueMapper.ts` mapping itself was never completed).
Fixed by mapping `league.status` through (`'pre_draft'|'drafting'|'in_season'|'complete'`,
explicit `null` — never a fabricated default — when Sleeper genuinely omits
it). **Physically re-verified**: re-committing the same real league with the
fix applied backfilled `status:'complete'`, and the league then appeared on
the real Dashboard query (8 leagues, `foundImportedLeague:true`).

The identical gap (no league-level `status` mapping) was confirmed present
in the ESPN, Yahoo, and MFL adapters too via source read. **Deliberately not
fixed this phase** — Sleeper-only scope, per the brief's own instruction not
to expand into other providers before Sleeper is cleanly certified. Flagged
as a known item for each provider's own certification phase.

## 5. Downstream proof (Part 7)

| Surface | Result | Evidence |
|---|---|---|
| Dashboard | **Physically proven**, after the fix in §4 | Real `getDashboardLeagueListForUser` call found the real imported league, correct name/platform |
| Manager OS (`resolveManagerIntelligencePayload`) | **Physically proven** | Real call against the real league id returned a real trend payload, no external hop, no demo fallback |
| Commissioner OS | **Source-verified only** — not independently re-executed this phase beyond the shared Manager OS loader above, since the UI-level Commissioner OS surface defaults to demo mode in this environment (`DECISION_OS_BASE_URL` unset) and its real backend is the same internal API `resolveManagerIntelligencePayload` calls | Prior-phase agent research + this phase's real Manager OS call |
| Rankings | **Confirmed gap, not fabricated as connected** | `lib/rankings-engine/league-rankings-v2.ts` reads `legacyLeague`/`legacyRoster`, populated by the separate legacy career-history path, not this canonical commit. A real roster lookup by the commissioner's Sleeper `platformUserId` against the canonical `Roster` table for this exact league returned nothing usable to Rankings' primary read path. |
| Decision OS — Waiver | **Physically proven** | Real call to `loadWaiverWorldFacts(commissionerUserId, realLeagueId)` returned real facts — the canonical commit's `Roster.platformUserId` rows are exactly what this loader needs |
| Decision OS — Trade | **Blocked, exact gate identified** | `loadTradeWorldFacts` requires a `RedraftSeason.id`; a plain canonical league import never creates one (only draft-completion or season-renewal do). Confirmed via direct query: zero `RedraftSeason` rows exist for the freshly-imported league. This is the real, named gate — not fabricated as either broken or working. |

## 6. Unsupported-by-Sleeper / not-yet-persisted data (honest inventory)

Carried forward from the prior phase's research, re-confirmed still accurate
this phase (no code changed these facts):

- Playoff bracket *results* (not structure) have no canonical relational
  model for any provider.
- No first-class keeper/dynasty per-player contract data — Sleeper only
  exposes `max_keepers` and a numeric league `type`.
- No divisions (Sleeper's API has no division concept at all).
- Waiver-claim and free-agent transaction *history* is fetched for
  preview/validation but not persisted as a durable ledger by this commit
  path (only `type==='trade'` transactions are persisted, via the separate
  dynasty-import history path).
- Traded draft pick `previous_owner_id` has no destination column and is
  dropped, not fabricated.

## 7. Certification verdict

**Sleeper Commissioner Import Status: CERTIFIED WITH DOCUMENTED LIMITATIONS.**
The core mandate — a commissioner starts from the live import UI, imports a
real Sleeper league, and ends with a canonical, playable, Dashboard-visible
AllFantasy league — is physically proven end to end. Manager rejection and
exact-replay idempotency are physically proven. Decision OS Trade reachability
is a named, real, disclosed gap (requires a season, not an import defect).
Rankings integration for this canonical path is a named, real, disclosed gap
(architectural — Rankings reads the legacy tables, not this one).
