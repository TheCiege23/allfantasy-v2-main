# Phase 7.24 — @allfantasy/widget-core Package Preparation Checkpoint

Status: **SCAFFOLDING COMPLETE, LOCALLY BUILT AND VERIFIED — 2026-07-01**.
Second package from `PHASE_7_22_SDK_PACKAGING_ADR.md`'s recommended order
(§12: "sdk-contracts, then widget-core"). No publish, no external service
writes, no runtime behavior change to any existing file.

## What was built

```
sdk-runtime/core/
├── package.json     — NEW. private:true, 0.1.0
├── tsconfig.json     — NEW. Package-local build config (ES2020, no DOM, declaration-only)
├── tsconfig.json (root, sdk-runtime/tsconfig.json) — UNCHANGED, still the typecheck-only config
└── src/               — UNCHANGED. index.ts + 5 implementation files, all pre-existing (Phase 7.6/7.7)
```

Plus `__tests__/sdk-runtime/core/package-build.test.ts` (11 new tests) and
this checkpoint. **Zero existing source files changed at all** — this is
the cleaner case F7.23's checkpoint predicted: `sdk-runtime/core/` already
existed with a complete, correct barrel (`src/index.ts`, Phase 7.6/7.7),
so this ticket adds ONLY packaging metadata (`package.json` +
package-local `tsconfig.json`) around it. No new curation, no new `src/`
file, unlike `sdk-contracts` (Phase 7.23) which had to assemble a
brand-new re-export barrel from two source trees.

## 1. Why no new src/index.ts was needed

`PHASE_7_22_SDK_PACKAGING_ADR.md` D1: "boundaries mirror the EXISTING
directory structure exactly... `@allfantasy/widget-core ← sdk-runtime/core/`."
Unlike `sdk-contracts` (whose source, `lib/decision-os/sdk`, lives in a
completely different top-level tree and needed a NEW curated re-export
file), `widget-core`'s canonical source already lives at exactly
`sdk-runtime/core/`, and its `src/index.ts` barrel (Phase 7.6: HTTP
client types, `authPreCheck`; Phase 7.7: `RefreshEngine`) is already the
correct, complete, tested public surface — re-verified against the actual
current file rather than assumed. Packaging here is genuinely just adding
`package.json`/`tsconfig.json` around already-correct source, with zero
new logic — the cleanest possible instance of ADR D1's "packaging is a
build-time-only concern."

## 2. A DIFFERENT tsconfig than the existing `sdk-runtime/tsconfig.json`, deliberately

`sdk-runtime/tsconfig.json` (the pre-existing root config, unchanged by
this ticket) is `noEmit`-implicit (used only for typechecking `core/src`
via `npx tsc --noEmit -p sdk-runtime/tsconfig.json`, the command every
prior Phase 7 ticket has run). The NEW `sdk-runtime/core/tsconfig.json`
is package-local and adds `declaration: true` +
`declarationMap: true` + `emitDeclarationOnly: true` + `outDir: "./dist"`
— genuinely different purpose (producing a real build artifact, not just
verifying types), so a second, additive tsconfig is correct rather than
mutating the existing one (which several existing scripts/CI steps this
whole Phase 7 effort already depends on for its typecheck-only role).
Both configs agree on the requirements this ticket's rules restate:
`"lib": ["ES2020"]` — **no DOM** — in both, unchanged.

## 3. Same `emitDeclarationOnly` finding as Phase 7.23, re-confirmed independently

Re-ran the exact same experiment F7.23 already documented: a normal
declaration+JS build emits the full transitive closure. For
`widget-core` specifically, this again surfaces
`dist/lib/decision-os/behavioral/api/contracts.d.ts` (via
`lib/decision-os/sdk/auth.ts`'s `IntelligenceApiScope` import) — the SAME
already-curated, content-verified-safe Phase 5.5 "external contract" file
F7.23 found. This ticket's own test suite re-verifies the content-safety
claim independently (not just citing F7.23) by asserting the file's
header text is present and that none of `warnings`/`derivedFrom`/
`lookbackDays`/`provenance` appear as actual field declarations (code,
comments stripped) — a real, positive, re-run check, not an assumption
carried over from the sibling package's checkpoint.

`emitDeclarationOnly: true` applied identically: zero `.js` anywhere in
`dist/`, verified as a test property. Same accepted limitation as
`sdk-contracts`: `widget-core`'s value exports (`authPreCheck`,
`fetchPresentation`, `RefreshEngine`, …) are type-visible but not yet
runtime-callable from the built package — closes with the same future
bundler ticket.

## 4. The `@allfantasy/sdk-contracts` dependency gap — documented, not papered over

`PHASE_7_22_SDK_PACKAGING_PLAN.md`'s dependency table lists `widget-core`
as depending on `sdk-contracts` (ADR D3). This ticket's `package.json`
does **NOT** declare that dependency. Reason: `sdk-runtime/core/src/*.ts`'s
ACTUAL current imports go directly to `lib/decision-os/sdk/*` and
`lib/decision-os/presentation/widget-contracts` (unchanged, per this
ticket's "no runtime behavior changes" rule) — they do not import
`@allfantasy/sdk-contracts` at all, because rewiring them to do so would
be a real source change this ticket is not authorized to make. Declaring
a `dependencies` entry for a package nothing actually imports would be
dishonest packaging metadata. **This is the same gap F7.23 flagged from
the other side** (sdk-contracts has no widget-core dependent yet either) —
both checkpoints agree the fix is the same future ticket: adding a real
bundler, which is also the natural point to decide whether `core/`'s
source imports get rewritten to point at the packaged `sdk-contracts`
output, or whether the bundler resolves the relationship without a
source change at all (e.g. via a build-time path alias). Verified via a
test: `package.json`'s `dependencies`/`peerDependencies` are checked to
contain no React/DOM/other-widget-package entries (what the ticket DOES
require), without asserting a `sdk-contracts` dependency that would be
untrue of the actual source right now.

## 5. Verification results

- **Local build**: `npx tsc -p sdk-runtime/core/tsconfig.json` — clean,
  zero errors.
- **Scoped typecheck**: `npx tsc --noEmit -p sdk-runtime/core/tsconfig.json` —
  clean. The pre-existing `npx tsc --noEmit -p sdk-runtime/tsconfig.json`
  (root, unchanged) also re-verified clean.
- **Import-boundary (source)**: the pre-existing
  `__tests__/sdk-runtime/core/import-boundary.test.ts` (Phase 7.6/7.7,
  unmodified) re-run and still green — no React, no DOM, no behavioral/
  world/Prisma, no bare fetch/timer calls, no writes, no soak-flag
  references.
- **Import-boundary (package + build)**:
  `__tests__/sdk-runtime/core/package-build.test.ts` — **11/11 GREEN**
  (new this ticket). `package.json` checks (private:true, sideEffects:false,
  no React/DOM/adapter dependency, correct name) + six build-output
  checks (entry point exists, zero `.js` anywhere, expected exports
  spot-checked, zero React/DOM/postMessage references anywhere in the
  built `.d.ts` tree, zero Prisma/secret-shaped content, and an
  independent re-verification of the known `behavioral/api/contracts.d.ts`
  content-safety finding).
- **Full regression**: `__tests__/decision-os` + `__tests__/sdk-runtime` —
  **3095 tests GREEN** (3084 + 11 new, zero regressions — this ticket
  changed zero existing runtime behavior; the math is exact: 129
  pre-existing `sdk-runtime/core` tests + 11 new = 140 in that directory,
  matching the standalone directory run).
- **All 10 sdk-runtime scoped typechecks** (core root + core package +
  react + iframe main/browser/facade/reactChild + web-component +
  js-embed + sdk-contracts) — clean.
- **Main app typecheck** — stable (same 3 pre-existing unrelated
  `LeagueShell.tsx` errors, untouched).

## Next steps (not built in this ticket)

1. Add a real bundler (tsup) to BOTH `sdk-contracts` and `widget-core` —
   closes the `behavioral/`-path sprawl, the callable-values gap, AND
   decides how `widget-core`'s source relates to the packaged
   `sdk-contracts` (§4).
2. `@allfantasy/widget-react` is the natural #3 (per the packaging plan's
   dependency graph — it needs both `sdk-contracts` and `widget-core` to
   exist as real packages first, which they now do).
3. Actual `npm publish` remains explicitly out of scope until a human
   reviews the built artifact and removes `"private": true` deliberately.
