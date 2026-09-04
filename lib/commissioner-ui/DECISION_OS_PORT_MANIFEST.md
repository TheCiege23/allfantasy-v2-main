# Decision OS Selective Port — Manifest (Dry Run)

Date: 2026-07-03. **No files have been copied.** `port/decision-os-backend`
was created from `main`'s current tip and left uncommitted-to and
un-checked-out — a container for the port, not the port itself. Every
finding below came from reading file contents and import statements
directly off the `g15-event-foundation` ref (`git show <ref>:<path>`,
`git ls-tree`, `git diff --stat`) — nothing was checked out anywhere,
nothing in this worktree or the live `g15-event-foundation` checkout was
touched.

## Method note

Rather than deciding what to include by directory name alone, I traced
the **actual import graph** starting from the three files the task
requires (`app/api/v1/intelligence/{platform,league,manager}/route.ts`)
all the way down, and separately scanned every file under
`lib/decision-os/behavioral/` for any import reaching outside that
directory. This is why the manifest below can state inclusion/exclusion
with real confidence rather than a guess based on what a directory *sounds*
like it's for.

---

## Decision OS Port Manifest

### Included files

**`lib/decision-os/behavioral/` — all 27 files, in full.** Verified by
direct import trace: `route.ts` → `intelligence-handlers.ts` +
`provider-selector.ts` → `real-data-provider.ts`/`resolvers.ts`/`contracts.ts`/`gate.ts` →
`manager-intelligence.ts`/`league-intelligence.ts`/`platform-intelligence.ts`/`assemble.ts` →
`events/types.ts`/`events/taxonomy.ts`/`facts.ts`. Every one of these
stays inside `behavioral/`, with exactly one exception (next item) and
one external, already-existing dependency (`@/lib/prisma`, no new
package, no schema conflict — see Schema Impact).

**`lib/decision-os/presentation/tokens.ts`** (and whatever single
sibling type file it imports from within `presentation/` — one more
`import type` line, not yet individually named but confirmed small: 306
lines, "pure deterministic mapping functions... no UI imports, no side
effects"). Required because `intelligence-handlers.ts` statically imports
`presentation-adapters.ts` to support an optional `?view=presentation`
query parameter — even though Commissioner OS would use the default
`?view=raw` path, the file won't typecheck without this dependency
present. **Not** the other 13 files in `presentation/` (Widget/IPM
embedding, theming — unrelated to this one token-mapping utility).

**`app/api/v1/intelligence/{platform,league,manager}/route.ts`** — the
three routes named in the task. Each is a ~15-line wrapper; verified
their only imports are the two `behavioral/api/` files above.

**4 Prisma migrations** (purely additive, zero collision — see Schema
Impact): `20260627010000_add_event_foundation`,
`20260627020000_add_event_projections`, `20260627030000_add_outbox_claim`,
`20260627040000_add_intelligence_read_models`.

**9 confirmed-relevant test files** (of the 74 under `__tests__/decision-os/`):
`behavioral-event-ports.test.ts`, `behavioral-event-schema.test.ts`,
`intelligence-api-provider-selection.test.ts`,
`intelligence-api-real-provider.test.ts`, `intelligence-api-resolvers.test.ts`,
`intelligence-api-routes.test.ts`, `league-behavioral-intelligence.test.ts`,
`manager-behavioral-intelligence.test.ts`, `platform-behavioral-intelligence.test.ts`.
Plus **`phase7/intelligence-api-presentation.test.ts`**, which
specifically exercises the `presentation-adapters.ts` dependency above.

### Excluded files

Confirmed absent from the entire traced import graph, and matching the
task's own exclusion list:

| Directory/file | Files | Why excluded |
|---|---|---|
| `lib/decision-os/world/` | 16 | Canonical World fact layer — feeds the *older* dashboard/commissioner-hub consumer surfaces directly; the Intelligence API path never imports it |
| `lib/decision-os/core/` | 11 | Same — foundational primitives for the Canonical World / shadow-validation slices, not for the Intelligence API |
| `lib/decision-os/trade/` | 16 | Trade shadow-validation slice (parity-checks the *existing* trade feature) — "unrelated production route changes," not needed here |
| `lib/decision-os/lineup/` | 14 | Lineup shadow-validation slice (parity-checks the *existing* lineup optimizer) — "draft runtime," out of scope |
| `lib/decision-os/waiver/` | 11 | Waiver shadow-validation slice — same reasoning |
| `lib/decision-os/commissioner-health/` | 10 | Backend counterpart of the **old, separate** `commissioner-hub` health-scoring feature (`lib/commissioner-hub/commissionerHubHealth.ts`) — explicitly excluded per "commissioner-hub UI," and its backend counterpart serves no one else |
| `lib/decision-os/sdk/` | 24 | Widget SDK / partner embedding — a different consumer (third-party widgets), not Commissioner OS; "old decision-os UI surfaces" territory |
| `lib/decision-os/phase6/` (minus 1 uncertain — see below) | 19 | League Archetype Classifier, Platform Benchmarking, Manager DNA/Identity, Recommendation Engine, Company Intelligence — richer classifiers layered *above* the base behavioral intelligence; confirmed not imported by `intelligence-handlers.ts`/`real-data-provider.ts`/`resolvers.ts` |
| `lib/decision-os/phase7/` (minus the 1 presentation-tokens file already included) | ~13 | Widget SDK & Embed Specification, Partner Sandbox API, Presentation Model *foundation* (the broader IPM system `presentation/tokens.ts` is one small piece of) |
| Root-level `dashboard-intelligence.ts`, `draft-runtime-intelligence.ts`, `league-pulse.ts`, `manager-dna.ts`, `recommendations.ts`, `runtime-event-derivation.ts` | 6 | Dashboard- and draft-runtime-specific glue code (matches `components/decision-os/*` → `app/dashboard/*` wiring found in the prior Discovery Report) — not imported anywhere in the traced Intelligence API path |
| `components/decision-os/*`, `app/dashboard/*` wiring, `app/commissioner-hub/*` wiring | — | Explicitly named exclusions in this task; confirmed to be the *old decision-os UI surfaces* and *commissioner-hub UI* respectively |
| `app/api/v1/sandbox/partner/*` (6 routes) | 6 | Widget partner sandbox — serves the excluded SDK, not the Intelligence API |
| `app/api/decision-os/manager-intelligence/route.ts`, `app/api/admin/decision-os/telemetry/route.ts`, `app/api/dev/decision-os/telemetry/route.ts` | 3 | Admin/dev tooling and an older, narrower manager-intelligence route superseded by the `v1/intelligence/manager` route already included — not required for Commissioner OS |
| ~65 non-decision-os test files, ~85 unrelated commits (NFL redraft, draft runtime, canonical league runtime, staging infra) | — | Explicitly out of scope per the task |
| 3 modified pre-existing production routes (`app/api/redraft/trade-proposals/route.ts`, `app/api/today/lineup-actions/route.ts`, `app/api/waiver-ai/engine/route.ts`) | — | "unrelated production route changes unless required" — not required, since the Intelligence API doesn't touch them |

### Uncertain files

- **`lib/decision-os/phase6/behavioral-patterns.test.ts`** and its
  corresponding source (part of the 19 "phase6" files marked excluded
  above) — named similarly to the included `behavioral/` work and
  conceivably a richer input to manager/league intelligence, but **not**
  found anywhere in the direct import trace from the routes down.
  Recommend a one-file confirmation (does `manager-intelligence.ts` or
  `assemble.ts` reference a "behavioral pattern" concept anywhere, even
  indirectly) before finalizing — flagged rather than guessed either way.
- **The exact sibling file `presentation/tokens.ts` itself imports** — I
  confirmed it's a single `import type { ... }` line and that the file
  is a small, pure, side-effect-free leaf, but did not individually name
  which sibling file that type comes from. Trivial to resolve (one more
  `git show`) before the port executes, not a blocker to reviewing this
  manifest.

### Dependency impact

**None.** `package.json` diff between `main` and `g15-event-foundation`
adds zero new npm dependencies (only new `scripts` entries, e.g.
`dev:staging-lite`, none of which the included files need). Every
included file's only external dependency is `@/lib/prisma`, which already
exists identically on this branch.

### Schema impact

**Two new models, purely additive, zero collision.** `DomainEvent` and
`EventOutbox` (real event-sourcing/outbox pattern) do not exist anywhere
in this branch's or `main`'s `prisma/schema.prisma` today (`grep -c "model DomainEvent\|model EventOutbox"` → `0`).
This branch's own `schema.prisma` is otherwise byte-identical to `main`'s
(zero diff outside the new models), so the 4 migrations listed above
would apply cleanly with no merge conflict. Applying a schema migration
to any shared database is still a normal, real operational step requiring
its own review — see Risk Assessment.

### API route impact

Three new routes, all under a namespace (`app/api/v1/intelligence/`) that
doesn't exist on this branch or `main` today — zero collision with any
existing route. Each route is gated by `DECISION_OS_INTELLIGENCE_API_ENABLED`
+ an `X-AllFantasy-API-Key` header per its own source comments, meaning
even once ported and deployed, it does nothing unless separately enabled
— it will not silently start serving traffic.

### Test impact

9-10 test files (see Included Files), all under the already-isolated
`__tests__/decision-os/` directory — zero naming collision with any
existing test file on this branch (including Commissioner OS's own 22
`__tests__/commissioner-os-*.test.*` files). **Not independently
re-executed as part of this manifest** — per the prior Discovery Report's
Risk Assessment, the live `g15-event-foundation` checkout currently has
238 uncommitted paths (apparent concurrent work), so no test run was
attempted against it. This remains a hard prerequisite before the port
is applied, not before this manifest is reviewed.

---

## Exclusion List (consolidated)

- `lib/decision-os/{world,core,trade,lineup,waiver,commissioner-health,sdk}/` — 102 files total
- `lib/decision-os/phase6/` except the one uncertain file noted above — 19 files
- `lib/decision-os/phase7/` except `presentation/tokens.ts`'s home directory — ~13 files
- `lib/decision-os/{dashboard-intelligence,draft-runtime-intelligence,league-pulse,manager-dna,recommendations,runtime-event-derivation}.ts` — 6 root-level files
- `components/decision-os/*`, `app/dashboard/*` Decision OS wiring, `app/commissioner-hub/*` wiring — old UI surfaces, per the task's own exclusion list
- `app/api/v1/sandbox/partner/*` — 6 routes (Widget SDK partner sandbox)
- `app/api/decision-os/manager-intelligence/route.ts`, `app/api/admin/decision-os/telemetry/route.ts`, `app/api/dev/decision-os/telemetry/route.ts` — 3 routes
- 3 modified pre-existing production routes (redraft trade-proposals, today lineup-actions, waiver-ai engine)
- ~65 non-relevant `__tests__/decision-os/*` test files
- All ~85 non-decision-os commits (NFL redraft, draft runtime, canonical league runtime, staging infrastructure)
- ADR/architecture markdown files **not** part of the included scope (e.g. `ADR_F0_*`, `ADR_F1_*`, `ADR_F2_*`, `ADR_PHASE4_*`, `ARCHITECTURE_FREEZE.md`, `PHASE_E_TRADE_BRIDGE_ARCHITECTURE.md`, etc.) — these document the *excluded* subsystems' history; not porting the code makes porting their docs misleading context to carry along

---

## Risk Assessment

| Risk | Severity | Notes |
|---|---|---|
| `g15-event-foundation` is under active/concurrent development (last commit this morning, 238 uncommitted paths on its live checkout) | Medium-High | Same finding as the prior Discovery Report — still unresolved. Confirm with whoever's working there and get a specific commit hash before the actual port, not "whatever HEAD is at that moment." |
| Decision OS test suite not re-executed live | Medium | Structural test coverage (9-10 relevant files) is confirmed; current pass/fail status is not. Hard prerequisite before applying the port, per the Required Review Checklist below. |
| One confirmed cross-directory dependency (`presentation/tokens.ts`) means the "port" isn't 100% contained to `behavioral/` alone | Low | Already identified and scoped precisely to one small, pure file — not a surprise dependency discovered mid-port. |
| One uncertain file (`phase6/behavioral-patterns`) | Low | Flagged, not guessed. A single one-file check resolves it before applying. |
| Applying a schema migration to any real, shared database | Low-Medium (standard) | Purely additive and conflict-free technically, but schema migrations always warrant a normal review/rollout process regardless of technical cleanliness. |
| Newly-ported Intelligence API routes are inert until `DECISION_OS_INTELLIGENCE_API_ENABLED` is set | Low | Confirmed via the routes' own gating logic — landing this code changes no runtime behavior anywhere until deliberately enabled. |

## Required Review Checklist

Before this manifest's port is applied:

- [ ] Confirm with whoever is currently working on `g15-event-foundation` that porting from it now is safe, and get an exact commit hash to port from
- [ ] Resolve the one uncertain file (`phase6/behavioral-patterns.test.ts` + source) — include or confirm exclude
- [ ] Name the exact sibling file `presentation/tokens.ts` imports its one type from, and include it
- [ ] Check out that exact commit hash in an isolated worktree (not the live, dirty checkout) and run the 9-10 relevant `__tests__/decision-os/*` files to confirm current pass/fail state
- [ ] Confirm the 4 Prisma migrations apply cleanly against this branch's/`main`'s current schema in a real (non-prod) database, not just via a text diff
- [ ] Have whoever owns `app/api/redraft/trade-proposals`, `app/api/today/lineup-actions`, and `app/api/waiver-ai/engine` confirm they're fine being *excluded* from this port (i.e., their existing behavior on `main`/this branch is unaffected either way, since this port doesn't touch them)
- [ ] Decide who reviews the port PR against `main` — this is infrastructure work independent of the Commissioner OS branch and should get its own reviewer(s)

## Recommendation

**Proceed — with the Review Checklist completed first, in order.** The
manifest is precise, evidence-based (traced import-by-import, not
guessed from directory names), technically clean (zero dependency
conflicts, zero schema collisions, zero Commissioner OS overlap, inert
until explicitly enabled), and small (behavioral/'s 27 files + 1
presentation file + 3 routes + 4 migrations + 9-10 tests — a small
fraction of the 192-file `lib/decision-os/` tree and a tiny fraction of
the 870-file full branch diff). The only two items standing between
"reviewed" and "safe to apply" are coordination (the branch is actively
worked on) and a live test run against an isolated checkout of the exact
commit chosen — both are process steps, not architectural concerns. Do
not revise the scope; do not stop.
