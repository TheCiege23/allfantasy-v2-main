# ADR-DOS-F1 — Real-League Conformance for Lineup, Waiver, Commissioner

**Status:** Accepted (2026-06-29). Branch `g15-event-foundation`.
**Scope:** validation only. NOT a feature, NOT a redesign, NOT a cutover, NOT enrichment, NO route changes.
**Builds on:** [[decision-os-roadmap]], `ADR_F0_NONPROD_IMPORTED_LEAGUE.md`, the trade conformance model
(`scripts/decision-os-trade-conformance.ts`).

---

## 1. Context

F.0 made one real imported Sleeper league available in non-prod ("KBI Smoke Black",
`50d5c56d-86e8-466d-ad3d-5f8a54ce1457`, provider=sleeper, 12/12 rosters with players). **Trade** already
validates against existing real leagues read-only and went GREEN on it. The other three slices do not:
`scripts/slice1-staging-parity.ts` (lineup), `slice2` (waiver), `slice4` (commissioner) each **seed a
throwaway league and clean it up** — they prove synthetic shadow behavior but take no `leagueId`, so they
**cannot target an existing real league** (imported or native). This ADR brings lineup/waiver/commissioner
up to the trade conformance model: read-only scripts that target an existing league by argv.

## 2. Decision

Add three read-only, DB-gated, prod-refusing conformance scripts that mirror
`decision-os-trade-conformance.ts` exactly in shape (gate → host-refuse → dynamic-import prisma after the
gate → resolve an existing league → run the slice shadow pipeline read-only → assert wrap-fidelity parity
+ telemetry + no mutation → print `*_CONFORMANCE_OK`):

- `scripts/decision-os-lineup-conformance.ts` → `LINEUP_CONFORMANCE_OK`
- `scripts/decision-os-waiver-conformance.ts` → `WAIVER_CONFORMANCE_OK`
- `scripts/decision-os-commissioner-conformance.ts` → `COMMISSIONER_CONFORMANCE_OK`

Each: refuses `ep-curly-block` (exit 0), skips without `DATABASE_URL` (exit 0), takes `[leagueId …]` by
argv (else auto-discovers most-recently-synced leagues, skipping any that don't fit the slice), and reads
ONLY through existing find\* ports + the existing shadow runners. **Rejected alternative:** extending the
seed-based `slice*-staging-parity.ts` to accept a leagueId — they are built around seed+cleanup (they
WRITE), and the goal is a strictly read-only real-league check. New scripts beside them keep the synthetic
proofs intact and the real-league proofs write-free.

## 3. How each slice runs read-only against an existing league (with the identity resolution)

The known risk (ticket): lineup/waiver need a viewer/manager identity, commissioner a commissioner
identity — and production resolves identity from the authenticated user, which isn't available headlessly.
Resolution per slice (all read-only, all derive identity FROM the league itself):

- **Commissioner** — cleanest, no identity blocker. Read the league row + rosters read-only (the exact
  select the hub assembler uses), call `buildCommissionerHealthSnapshot({league, source:'database',
  counts})` (counts passed as zeros — deterministic, fully read-only), then `runCommissionerHealthShadow
  ({userId, snapshot})` which feeds the snapshot as its own wrap-fidelity memo → parity passes. `userId`
  is telemetry attribution only (derived from a commissioner team's `managerUserId` when present, else any
  team's, else a literal). Asserts: ran, parity wrap_fidelity, `decider_scope='commissioner'`,
  `automation_capable=false`, telemetry, and league settings/lock UNCHANGED.

- **Waiver** — `loadWaiverWorldFacts(userId, leagueId)` resolves the unified `Roster` by
  `platformUserId ∈ linkedPlatformUserIds(userId)`. Headless has no authed user, so the script derives a
  **viewer read-only** (`prisma.roster.findFirst → platformUserId`) and injects it via the loader's
  `loadLinkedPlatformUserIds` dep (the ONLY override — every other read stays the real loader: real
  settings, FAAB, priority, roster size). A representative recommender input is staged (as trade stages a
  representative trade from real rosters); `runWaiverAIService` produces deterministic suggestions; the
  shadow is fed those same suggestions → **wrap-fidelity** parity proves the wrapper adds no drift on the
  real league's World facts. The Decision OS NEVER executes a claim — asserted by
  `waiverClaim`/`waiverTransaction` count deltas = 0.

- **Lineup** — `runLineupShadow` tries the redraft-native loader first, then the **Canonical World
  bridge** (`resolveCanonicalLineupInputs`, read-only, default-ON in shadow). For an IMPORTED league the
  native loader returns null (no `RedraftRoster`), so the bridge fires and resolves the viewer's roster
  via `team.managerUserId` (= `claimedByUserId ?? platformUserId`). The script derives the **viewer
  read-only** = a team's `managerUserId` from the resolved world, feeds a representative legacy summary as
  the recommender, and asserts the decision reproduces it (wrap-fidelity). `source` is provenance-only:
  imported ⇒ `canonical_world`, native AF redraft ⇒ `redraft_native` — both are valid PASSes.

## 4. Findings recorded by this ticket (identity is a finding, not a redesign)

- **F1-IDENTITY-1 (expected, benign):** real-league conformance for lineup + waiver must derive a viewer
  identity FROM the league read-only (a team's `managerUserId` / a roster's `platformUserId`) and inject
  it into the loader, because the production loaders resolve identity from the authenticated request
  (`resolveRedraftRosterLookupReadOnly`, `userProfile.sleeperUserId`) which has no headless analog. This
  is harness-side identity injection through the existing injectable deps — **production identity flow is
  unchanged**, and the override is read-only. Documented per the ticket ("if identity gaps surface,
  document them as real-data findings rather than redesigning around them").
- **F1-LINEUP-1 (by design):** imported-league lineup conformance proves the **Canonical World bridge**
  path (`source=canonical_world`), NOT the redraft-native loader — imported leagues have no
  `RedraftRoster`. Player metadata degrades honestly (`scanIncomplete` until the SportsPlayer cache
  resolves name/position); parity (wrapper fidelity) is independent of metadata completeness.

## 5. F0-1 disposition (provider-name leak in `scoringSettings`)

F0-1 (the opaque `League.settings` pass-through carrying `visualTheme.logoUrl = sleepercdn…`, surfaced by
`decision-os-world-conformance.ts`) does **NOT** break F.1 conformance: these scripts assert
parity/telemetry/no-mutation, not the strict no-provider-substring world check. The lineup bridge does
pass `scoringSettings` through as opaque `leagueSettings`, but no F.1 assertion inspects it for provider
strings. **Disposition: was DEFER; F0-1 has since been CLOSED in a parallel task** (`narrowScoringSettings`
allow-lists scoring keys + strips provenance keys, purpose-blind; world conformance now GREEN on the
imported league). F.1 never depended on it and the F.1 runs below were unaffected either way.

## 6. Tests & verification

- Static guard test (`__tests__/decision-os/realleague-conformance-scripts.test.ts`): all three scripts
  refuse the prod host marker, skip without `DATABASE_URL`, dynamic-import prisma AFTER the gate (no
  static `@/lib/prisma`/`../lib/prisma`), accept `leagueId` argv, and perform **no direct prisma writes**
  (no `prisma.*.{create,update,upsert,delete,…}`), and print the right sentinel.
- Real runs (non-prod `ep-winter-salad`): all three against KBI Smoke Black (imported) + ≥1 native AF
  league; results recorded in §7 after execution.

## 7. Real-run results (non-prod `ep-winter-salad`, 2026-06-29)

All three slices validated GREEN against **both** an imported Sleeper league and a native-AF league —
read-only, zero mutation. Lineup exercised **both** input paths (canonical bridge for imported, redraft
loader for native), which is the cross-origin proof.

| Slice | Imported — KBI Smoke Black (`50d5c56d…`, sleeper) | Native — `4a1853d7…` (manual) |
|---|---|---|
| **Commissioner** | `COMMISSIONER_CONFORMANCE_OK` — health=69, wrap_fidelity, scope=commissioner, automation_capable=false, settings/lock unchanged | `COMMISSIONER_CONFORMANCE_OK` — health=78 |
| **Waiver** | `WAIVER_CONFORMANCE_OK` — type=faab, wrap_fidelity, 0 claim/transaction rows created | `WAIVER_CONFORMANCE_OK` — type=faab, 0 rows |
| **Lineup** | `LINEUP_CONFORMANCE_OK` — `source=canonical_world` (bridge), wrap_fidelity, honest degrade (faab/bye/projection unavailable), roster counts unchanged | `LINEUP_CONFORMANCE_OK` — `source=redraft_native` (loader), no warnings |

**Implementation notes surfaced during the runs (folded into the scripts):**
- **Telemetry capture at the console boundary, not via the sink.** tsx splits the telemetry module into
  two instances (the script's import vs the shadow's internal `@/`-aliased chain), so a registered
  `registerDecisionTelemetrySink` never fires. With no sink the shadow's telemetry falls to
  `console.debug('[decision-os]', json)` — the scripts intercept exactly that (a true global), which is
  robust to the module-identity split. (Slice scripts that assert telemetry via the sink are subject to
  the same fragility under tsx; the console-boundary capture is the durable pattern.)
- **Prisma null-filter quirk:** this client rejects `{ not: null }` AND `NOT: { x: null }`; the waiver
  script reads candidate rosters and filters the owner in JS instead.
- **server-only under tsx:** the lineup chain pulls `lib/time-engine/serverClock.ts` → `server-only`,
  which throws under plain tsx; the lineup script is run with the existing `_audit-preload.cjs` shim
  (documented in its header). Commissioner/waiver don't need it.

## 8. Registry

No `DECISION_REGISTRY.md` row — validation tooling, not a decision slice.
