# ADR-DOS-F0 — Non-Prod Imported League Validation Prerequisite

**Status:** Accepted (2026-06-29). Branch `g15-event-foundation`.
**Scope:** validation prerequisite only. NOT a feature, NOT a redesign, NOT a cutover, NOT enrichment.
**Builds on:** [[canonical-world-substrate]], `ADR_CANONICAL_WORLD_REDRAFT_COVERAGE.md`.

---

## 1. Context

Decision OS real-data validation has been proven against **native-AF** staging leagues (world +
trade conformance GREEN on `ep-winter-salad`), but the **imported-provider** path is unvalidated on
real data: `theciege24`'s real Sleeper leagues exist only in **prod** (`ep-curly-block`), which is
hard-refused by every Decision OS script. The first real-data validation (`63732511a`) surfaced this
explicitly as finding #1.

The next ticket — "validate lineup / waiver / commissioner / trade shadow parity on imported-provider
staging data" — is therefore **blocked**: there is no real imported league in non-prod to target.

This ADR resolves that single blocker: make **one real imported Sleeper league for `theciege24`**
available in the non-prod (staging) database so the existing read-only Decision OS validation scripts
can target it.

## 2. Key architectural facts established by recon

- **Sleeper import sources from the PUBLIC API** (`https://api.sleeper.app/v1`, no auth) —
  `lib/league-import/sleeper/SleeperLeagueFetchService.ts` + `lib/sleeper/user-lookup` +
  `lib/sleeper-client`. **Prod data is NOT the source of an imported league; Sleeper is.** Verified:
  `theciege24` → user_id `591462610482806784` → 67 NFL 2024 leagues resolvable read-only from the API.
- **The import commit is three plain library calls** — `runImportedLeagueNormalizationPipeline({provider:'sleeper', sourceId})` → `buildCanonicalImportBundle(normalized)` → `persistImportWithCanonicalAudit({userId, provider, normalized, canonical, allowUpdateExisting})`. Auth + the commissioner gate live in the **route** (`app/api/leagues/import/commit/route.ts`), **not** the services. So a headless runner can invoke the exact same pipeline prod uses, minus the HTTP/auth shell.
- **Sleeper normalization needs no `userId`** (public fetch). `userId` is needed only to own the audit `ImportRun` row at persist time (idempotency key = `userId:provider:sourceLeagueId:season`).
- **Imported leagues populate the canonical `Roster.playerData` path** (commit service writes `League.platform='sleeper'`, `LeagueTeam`, `Roster.playerData`), which the Canonical World port already reads. So once seeded, an imported league is immediately resolvable by `resolveCanonicalWorld` with **no substrate change** (unlike native redraft, which needed `ADR_CANONICAL_WORLD_REDRAFT_COVERAGE`).
- **The import is idempotent + re-runnable** (`persistImportWithCanonicalAudit` short-circuits a completed run; `allowUpdateExisting` re-imports over an existing league), so a runner is safe to re-invoke.

## 3. Options evaluated

| # | Option | Verdict |
|---|---|---|
| 1 | **Seed/snapshot sanitized prod data into staging.** | **Rejected.** Requires prod READ access + a bespoke sanitizer; violates "do not migrate production data blindly"; lower fidelity than a real import; couples staging data to a prod snapshot. |
| 2 | **Controlled non-prod import runner for Sleeper.** | **ACCEPTED.** Re-runs the *real* import pipeline against the **public** Sleeper API into staging. Zero prod read/write. Highest fidelity (byte-for-byte the prod path). Idempotent. Validatable by the existing conformance scripts. |
| 3 | Point a validation script at a read-only "imported data source." | **Rejected as standalone.** There is no separate imported data store; Decision OS reads through the DB-backed ports, so the data must physically exist in the non-prod DB. This option reduces to "first seed it" — i.e. Option 2. |
| 4 | Use an existing repo-supported path. | **Partially.** The only existing path is the HTTP route (needs a running server, a verified user session, and the commissioner gate). The runner **reuses the same services** that route uses — it *is* the supported path, minus the HTTP/auth shell. No standalone headless importer exists, so a thin runner is the minimal addition. |

## 4. Decision

**Option 2 — a controlled, non-prod, idempotent Sleeper import runner** (`scripts/decision-os-import-sleeper-nonprod.ts`) that:

1. **Refuses prod** (`PROD_HOST_MARKER = 'ep-curly-block'`, exit 0) and **SKIPs cleanly** without
   `DATABASE_URL` (exit 0) — same gating contract as `scripts/decision-os-*-conformance.ts`.
2. Resolves `theciege24` via the **public** Sleeper API (`lookupSleeperUser`) → user_id; discovers
   leagues (`getUserLeagues`) or accepts an explicit `--league=<sourceId>` (and `--season`, `--sport`).
3. Ensures a dedicated **non-prod importer app user** exists (idempotent upsert of a clearly-named
   validation user) to own the `ImportRun` audit row.
4. Runs the **real pipeline verbatim**: normalize → canonical bundle → `persistImportWithCanonicalAudit`
   (`allowUpdateExisting` so re-runs are safe).
5. Immediately **proves discoverability read-only**: calls `resolveCanonicalWorld(leagueId)` (find* port
   only) and prints provider/teams/rosters/completeness — provider non-null confirms an *imported* world.
6. Prints the resulting `leagueId` so the existing `decision-os-world-conformance.ts <leagueId>` and
   `decision-os-trade-conformance.ts <leagueId>` can target it.

A companion **read-only discover helper** (`scripts/decision-os-imported-leagues-nonprod.ts`) lists the
imported leagues already present in non-prod (`platform NOT IN ('manual','allfantasy', test-seeds)`) and
resolves each via the read-only port — the standing "is an imported league discoverable?" proof.

## 5. The read-only / write boundary (critical — what this ticket does and does NOT write)

This is a **validation prerequisite**, so a one-time *seed* of non-prod **source** rows is the explicit,
unavoidable deliverable ("make one real imported league available in non-prod"). The boundary:

- **WRITES (non-prod source tables ONLY, via the existing, audited import services):** `League`
  (`platform='sleeper'`), `LeagueTeam`, `Roster` (`playerData`), rank rows, and the import audit trail
  (`ImportRun`, `ImportWarning`, `ExternalEntityMapping`, optional `ImportReviewTask`) + one importer
  `User`. These are the *source-of-truth* tables the product itself writes on every real import.
- **NEVER WRITTEN — Canonical World** (`lib/decision-os/world/`): it is a **derived, read-only fact
  layer with no storage of its own** (structurally enforced — pure layer imports no prisma; the port
  exposes only `find*`). The runner imports **zero** `lib/decision-os/world` write surface (there is
  none) and produces canonical facts only by *reading* through `resolveCanonicalWorld`.
- **NEVER WRITTEN — production:** host-refusal aborts before any prisma call if the resolved host is
  `ep-curly-block`.
- **NO dual-write, NO migration, NO schema change:** the runner uses existing tables and the existing
  Prisma schema. No `prisma migrate`, no new columns.
- **NO provider-specific decision logic:** the runner lives in `scripts/`; it touches the import layer
  and the read-only world resolver only. Decision OS slices are untouched. Sleeper-specificity is
  confined to the import adapter that already exists — nothing provider-aware enters Decision OS.

So: the *runner* seeds non-prod (legitimate, audited, idempotent); the *Decision OS validation* that
follows is read-only. Canonical World and prod are inviolate.

## 6. Testing & validation strategy

- **Runner gating tests** (static source scan, no DB): the runner refuses the prod host marker and
  skips without `DATABASE_URL` — mirrors the conformance scripts' gating tests.
- **No-Canonical-World-write test** (static scan): the runner source imports no
  `lib/decision-os/world` write surface and contains no `prisma.*.{create,update,upsert,delete}` against
  any `world`/decision table; it only *reads* via `resolveCanonicalWorld`.
- **Discoverability proof:** after a real run against staging, `resolveCanonicalWorld(leagueId)` returns
  a world with `provenance.provider === 'sleeper'`, `teams.length > 0`, `rosters.length > 0` — recorded
  in the Final Report. When no DB is configured, a **hermetic fixture** (imported Sleeper world) proves
  the discover/resolve shape without a DB.
- **Downstream read-only validation is already proven** by `canonical-world-architecture.test.ts` (port
  is read-only) + the conformance scripts' own skip/refuse gating tests — unchanged by this ticket.

## 7. Success criteria (from the ticket)

- ✅ Non-prod resolves ≥1 imported Sleeper league for `theciege24` (runner seeds it; `resolveCanonicalWorld` proves it).
- ✅ The league is readable through the existing read-only ports (`resolveCanonicalWorld`, find* only).
- ✅ Decision OS validation scripts can target it (`decision-os-world/trade-conformance.ts <leagueId>`).
- ✅ No prod writes, no schema migration (host refusal + existing tables only).
- ✅ Unlocks imported-provider parity validation for lineup / waiver / commissioner / trade (next ticket).

## 8. Risks & mitigations

- **Import weight** (large/multi-season dynasty leagues fetch 18wk matchups+transactions ×N prior
  seasons + full player map). → Pick a modest league (≈10–12 team) for the first seed; the runner takes
  an explicit `--league` so the operator controls scope.
- **Staging drift / re-runs.** → Idempotent persist (idempotency key + `allowUpdateExisting`); safe to
  re-run.
- **Bypassing the commissioner gate** (the runner calls services directly, skipping the route's gate).
  → Justified: this is a controlled, operator-run, non-prod validation seeder, not a user-facing path;
  the gate is an authorization control for end users, irrelevant to an operator seeding their own
  validation DB. Documented here so it is a conscious, auditable decision.
- **Sleeper API availability.** → Fetch helpers already fail soft (return null); the runner reports a
  clean error and exits non-zero without partial Canonical World effects (there are none to have).

## 9. Rollback

Delete the seeded league from non-prod (`League` + cascade) — no prod or Canonical World state to undo.
The runner and its tests are additive `scripts/` + `__tests__/` files; reverting the commit removes them.

## 10. First real run — results & findings (2026-06-29, non-prod `ep-winter-salad`)

Ran `scripts/decision-os-import-sleeper-nonprod.ts --league=1096853585905799168 --season=2024` against
staging. **Outcome: SUCCESS** — one real imported Sleeper league is now resolvable in non-prod:

- Seeded **"KBI Smoke Black"** (`50d5c56d-86e8-466d-ad3d-5f8a54ce1457`), 12-team redraft, importer
  AppUser `decision_os_nonprod_importer`. `resolveCanonicalWorld` (read-only) returns
  `provider=sleeper, teams=12, rosters=12 (all 12 with players), completeness=90, warnings=1`.
- **`decision-os-trade-conformance.ts <leagueId>` → `TRADE_CONFORMANCE_OK`** (GREEN) — first imported-
  provider trade-pipeline proof on real data: identity join direct/direct, deterministic re-run parity,
  enrichment `source=sports_player_cache`, memo `completeness=75 uncertainty=1` (projection still the
  honest unsourced gap, as expected pre-Phase F enrichment).

### Finding F0-1 (NEW, real-data-only) — provider-name leak through the opaque `scoringSettings` blob
`decision-os-world-conformance.ts` returned `WORLD_CONFORMANCE_FAILED (1)`: the **"provider name does
not leak into league/roster facts"** check failed. Probe result: the leak is in
`world.league.scoringSettings`, which is the **opaque pass-through of `League.settings`** and carries
chrome that is not scoring data — including `visualTheme.logoUrl = https://sleepercdn.com/avatars/...`.
So `"sleeper"` appears as a substring of a **preserved logo URL**, NOT via any decision-logic branch on
the provider (assembly is still structurally origin-blind: fact KEYS are identical across origins and
the engine never branches on provider — `canonical-world-architecture.test.ts` still GREEN).

- **Why it only surfaced now:** the leak check is guarded `if (provider)`, so it never ran against
  native-AF leagues (`provider=null`) and the hermetic `makeImportedProviderWorld` fixture uses a clean
  settings blob with no CDN URL. A **real** imported league was required to expose it — which is exactly
  what F.0 was built to do.
- **Disposition: DOCUMENTED, not fixed here** (F.0 is "validation prerequisite only; do NOT redesign").
  This is a real-data finding handed to the next ticket. Candidate fixes (for that ticket, not this one):
  (a) narrow `scoringSettings` to actual scoring keys instead of passing the whole `settings` object
  (it currently carries `name`/`avatar`/`visualTheme`/`leagueSize` — league chrome, not scoring); or
  (b) treat opaque-preserved provider URLs as out-of-scope for the strict no-substring leak check and
  refine the check to target derived facts only. Option (a) is the cleaner origin-blindness improvement
  and must stay purpose-blind (no hardcoded provider strings in the substrate). The world-conformance
  script is intentionally **left RED** so the finding is not masked.

## 11. Registry

No `DECISION_REGISTRY.md` row — this is tooling/validation infrastructure, not a decision slice
(consistent with substrate/script changes).
