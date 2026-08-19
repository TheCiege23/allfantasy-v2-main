# Phase 7.25 — @allfantasy/widget-react Package Preparation Checkpoint

Status: **SCAFFOLDING COMPLETE, LOCALLY BUILT AND VERIFIED — 2026-07-01**.
Third package from `PHASE_7_22_SDK_PACKAGING_ADR.md`'s dependency graph —
the first FIRST-CLASS RENDERING package (previous two, `sdk-contracts` and
`widget-core`, are both DOM-free contract/utility layers). No publish, no
external service writes, no runtime behavior change to any existing file.

## What was built

```
sdk-runtime/react/
├── package.json         — NEW. private:true, react/react-dom as PEER deps, 0.1.0
├── tsconfig.json          — UNCHANGED (Phase 7.8, typecheck-only, noEmit)
├── tsconfig.build.json     — NEW. Package-local build config (declaration-only, jsx: react-jsx)
└── src/                     — UNCHANGED. index.ts + 8 implementation files, all pre-existing (Phase 7.8/7.18)
```

Plus `__tests__/sdk-runtime/react/package-boundary.test.ts` (16 new tests)
and this checkpoint. **Zero existing source files changed.** Same clean
case as F7.24 (`widget-core`): `sdk-runtime/react/src/index.ts` (Phase
7.8, extended by Phase 7.18's theming work) was already the complete,
correct barrel.

## 1. Two tsconfigs, same reasoning as F7.24, one new wrinkle

Unlike `sdk-runtime/core/` (which only had the ROOT `sdk-runtime/tsconfig.json`
before this ticket), `sdk-runtime/react/` already had its OWN package-local
`tsconfig.json` (Phase 7.8, `noEmit: true`, DOM+JSX enabled). This ticket
could not reuse that filename for the new build config without overwriting
it, so the new build config is `tsconfig.build.json` — a genuinely new
file, distinct name, same additive relationship: the existing
`tsconfig.json` keeps its typecheck-only role (still what
`npx tsc --noEmit -p sdk-runtime/react/tsconfig.json` runs, unchanged,
re-verified clean), `tsconfig.build.json` adds
`declaration`/`declarationMap`/`emitDeclarationOnly`/`outDir` for the real
build. Both configs agree on `"jsx": "react-jsx"` and
`"lib": ["ES2020", "DOM", "DOM.Iterable"]` — verified as a test property
(the new config isn't silently drifting from the existing one).

## 2. React as a PEER dependency — the ticket's own explicit requirement, matching ADR D6

`PHASE_7_22_SDK_PACKAGING_ADR.md` D6: `widget-react`'s consumer is, by
definition, a React application that already has its own React instance —
bundling a second copy risks the classic "two React instances" runtime
error. `package.json` declares:

```json
"peerDependencies": { "react": "^18.0.0", "react-dom": "^18.0.0" }
```

with `react`/`react-dom` explicitly absent from `dependencies` — verified
by a dedicated test, since accidentally bundling them (rather than peer-
depending) would be exactly the mistake this design decision exists to
prevent. This is the OPPOSITE strategy from what `widget-web-component`/
`widget-js` will need when their own packaging tickets come up (ADR D6
again: those two bundle React internally, since THEIR consumer explicitly
should not need React installed at all) — worth restating here because
it's easy to accidentally copy this ticket's `peerDependencies` pattern
onto those two later without re-reading why they're different.

## 3. Same `emitDeclarationOnly` finding, re-confirmed a third time, plus a new mirror

Re-ran the same experiment F7.23/F7.24 already documented. For
`widget-react`, the transitive closure now ALSO mirrors in
`sdk-runtime/core/src/*` (not just `lib/decision-os/behavioral/api/contracts.ts`)
— because `useAllFantasyWidget.ts` imports `LifecycleController`/
`RefreshEngine` from `../../core/src/index` via a REAL relative path, not
a package reference. This is the SAME "not yet a real npm dependency,
just a relative import" gap F7.24 flagged from `widget-core`'s side (no
`sdk-contracts` dependency declared there either) — now confirmed from
`widget-react`'s side too: `package.json` does not declare a
`@allfantasy/widget-core` dependency, because nothing in the actual
source imports it by package name. Verified by a test asserting the
`sdk-runtime/core/src/index.d.ts` file IS present in the built transitive
closure (documenting the gap exists) rather than asserting its absence
(which would be false).

`emitDeclarationOnly: true` applied identically: zero `.js` anywhere in
`dist/`. Content-safety of the mirrored `behavioral/api/contracts.d.ts`
re-verified independently for a third time (same header-text +
no-field-declarations check as the two prior checkpoints — not merely
cited).

## 4. No embed-adapter concepts leak into the built package

A NEW check this ticket adds (not present in F7.23/F7.24, since neither
of those packages could accidentally reference iframe/web-component/js-embed
terms — `widget-react` is the first package a FUTURE bundler-driven
rewrite could plausibly cross-contaminate, since it's the one package all
three OTHER embed adapters compose): the built `.d.ts` tree is scanned for
`IframeEmbedConfig`, `postMessage`, `AllFantasyWidgetElement`,
`attachShadowMountRoot`, `createAllFantasyWidget`, `attachAllFantasyGlobal`
— all clean. Confirms this package's dependency direction stays correct
even in compiled output, not just in `src/`.

## 5. Verification results

- **Local build**: `npx tsc -p sdk-runtime/react/tsconfig.build.json` —
  clean, zero errors.
- **Scoped typechecks**: both `npx tsc --noEmit -p sdk-runtime/react/tsconfig.json`
  (existing, unchanged) and `npx tsc --noEmit -p sdk-runtime/react/tsconfig.build.json`
  (new) — clean.
- **Import-boundary (source)**: the pre-existing
  `__tests__/sdk-runtime/react/import-boundary.test.ts` (Phase 7.8,
  unmodified) re-run and still green.
- **Package-boundary (package + build)**:
  `__tests__/sdk-runtime/react/package-boundary.test.ts` — **16/16 GREEN**
  (new this ticket): package.json shape (private, sideEffects, React as
  peer not bundled, peer-range matches installed 18.x, no embed-adapter
  dependency, correct name), JSX-aware build config (jsx: react-jsx, DOM
  libs present, agrees with the pre-existing tsconfig), and seven
  build-output checks (entry point, zero `.js`, expected exports, zero
  embed-adapter references anywhere in the built tree, zero Prisma/secret
  content, independent re-verification of the known behavioral-file +
  core-mirror findings).
- **Full regression**: **3111 tests GREEN** (3095 + 16 new, zero
  regressions — this ticket changed zero existing runtime behavior; the
  math is exact).
- **All 11 sdk-runtime scoped typechecks** — clean.
- **Main app typecheck** — stable (same 3 pre-existing unrelated
  `LeagueShell.tsx` errors, untouched).

## Next steps (not built in this ticket)

1. `@allfantasy/widget-iframe` is the natural #4 — the packaging plan's
   most structurally complex package (four entry points: base protocol,
   `./browser`, `./facade`, `./react-child` per ADR D4), needing
   `widget-react` (now scaffolded) for its subpath composition.
2. Add a real bundler (tsup) to `sdk-contracts`, `widget-core`, and
   `widget-react` together — closes all three packages' documented
   limitations (behavioral-path sprawl, non-callable values, and the
   currently-undeclared `widget-core`/`sdk-contracts` dependency edges)
   in one coordinated change, since all three share the same root cause.
3. Actual `npm publish` remains explicitly out of scope until a human
   reviews the built artifact and removes `"private": true` deliberately.
