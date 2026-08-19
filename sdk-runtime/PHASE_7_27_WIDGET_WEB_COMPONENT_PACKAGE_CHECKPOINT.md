# Phase 7.27 — @allfantasy/widget-web-component Package Scaffolding Checkpoint

Status: **SCAFFOLDING COMPLETE, LOCALLY BUILT AND VERIFIED — 2026-07-01**.
Fifth package from `PHASE_7_22_SDK_PACKAGING_ADR.md`'s dependency graph, and
the first package where React is a REAL dependency rather than a peer
(ADR D6 — the opposite bundling strategy from `widget-react`/
`widget-iframe`). No publish, no external service writes, no runtime
behavior change to any existing file.

## Step 1 — Audit of the existing runtime

`sdk-runtime/web-component/src/` has exactly **one public entry point**
(`src/index.ts`) — a much simpler shape than `widget-iframe`'s four
subpaths, matching `widget-core`'s single-entry-point precedent instead.

| File | Exports | Depends on |
| --- | --- | --- |
| `AllFantasyWidgetElement.tsx` | `AllFantasyWidgetElement` (the custom element class) | `react`, `react-dom/client`, `sdk-runtime/react` (real relative path), `sdk-runtime/core` (real relative path), `lib/decision-os/sdk/{errors,theme,types}`, `lib/decision-os/presentation/widget-contracts` |
| `register.ts` | `defineAllFantasyWidgetElement`, `DEFAULT_TAG_NAME` | `./AllFantasyWidgetElement` only |
| `attributes.ts` | attribute parsing | `lib/decision-os/presentation/widget-contracts` |
| `config.ts` | config assembly/validation | `lib/decision-os/sdk/auth`, `lib/decision-os/sdk/types` |
| `shadowMount.ts` | Shadow DOM mount boundary | nothing outside the package |
| `credentials.ts` | credential storage | `lib/decision-os/sdk/types` |
| `defaults.ts` | default fetch/clock | `sdk-runtime/core` (real relative path) |

All within the already-established allowed boundary (`lib/decision-os/sdk`,
`lib/decision-os/presentation`, `sdk-runtime/core`, `sdk-runtime/react`) —
zero `lib/decision-os/behavioral/*`, zero `lib/decision-os/world/*`, zero
Prisma anywhere in `src/`. No duplicate exports.

**This is the one package where React is imported by real PACKAGE NAME**
(`import { useEffect } from 'react'`, `import { createRoot } from
'react-dom/client'`), not just transitively via a sibling — confirming
ADR D6's framing that `widget-web-component` "bundles React internally":
a host page embeds `<allfantasy-widget>` via a plain `<script>` tag and
should never need to `npm install react` itself. `sdk-runtime/core` and
`sdk-runtime/react` are still real-relative-path composition (same
"sanctioned adapter-depends-on-adapter" pattern already established for
`widget-iframe`'s `react-child`), not by package name.

`register.ts`'s own header comment ("Explicit, idempotent registration —
never a module-load side effect... Importing this module does NOT
register anything") independently confirms `sideEffects: false` is safe —
`customElements.define` only ever fires inside the caller-invoked
`defineAllFantasyWidgetElement()` function.

## Step 2 — Package design

One pre-existing typecheck-only `tsconfig.json` (Phase 7.16, `noEmit:
true`, DOM+`react-jsx`, covers all of `src/**`) — **left completely
untouched**, matching the `widget-react`/`widget-iframe` precedent
(create a new `tsconfig.build.json` rather than mutate the existing
config other tooling might reference) rather than `widget-core`'s
single-dual-purpose-file approach (which was only viable there because
`widget-core` had no PRE-EXISTING typecheck config to preserve).

`tsconfig.build.json` — same superset shape as the sibling packages'
build configs (`declaration`/`declarationMap`/`emitDeclarationOnly`/
`outDir`), agreeing with the existing config on `jsx`/`lib` (verified by
a test, not just asserted).

```json
"exports": {
  ".": { "types": "./dist/sdk-runtime/web-component/src/index.d.ts" },
  "./package.json": "./package.json"
}
```

**Dependency declaration, the key departure from every prior package in
this series:** `react`/`react-dom` are declared as REAL `dependencies`
(pinned to `^18.3.1`, matching the root app's exact installed version —
verified by a test comparing the two `package.json` files directly), not
`peerDependencies`. This is accurate to the actual source (real
package-name imports, not relative paths) and matches ADR D6's stated
intent for this package specifically. No `peerDependencies` block at all.

`@allfantasy/widget-core`/`@allfantasy/widget-react` are, as with every
prior sibling-composing package, **not** declared as dependencies — same
reasoning as F7.24/F7.25/F7.26: nothing imports them by package name,
only by real relative path.

## Step 3 — Build verification

`npx tsc -p tsconfig.build.json` — clean, zero errors, zero `.js` files
anywhere in `dist/` (`emitDeclarationOnly: true`). The single entry point
`.d.ts` spot-checked for its expected exports (`AllFantasyWidgetElement`,
`defineAllFantasyWidgetElement`, `DEFAULT_TAG_NAME`,
`parseElementAttributes`, `buildWidgetConfigFromAttributes`,
`attachShadowMountRoot`, `setElementCredentials`, `defaultFetchImpl`).

**Confirmed web-component runtime only — no cross-contamination:**
- Zero iframe-adapter concept (`IframeEmbedConfig`,
  `IFRAME_PROTOCOL_VERSION`) or js-embed-specific concept
  (`createAllFantasyWidget` exact name, `attachAllFantasyGlobal`)
  anywhere in the built tree. Unlike `widget-iframe`'s equivalent check,
  a plain substring match is safe here — this package's own exports
  don't collide with either forbidden term.
- Zero Prisma references, zero secret-shaped field names, zero
  credential-looking strings anywhere in `dist/`.

**Known limitation, re-confirmed a fifth time.** Same transitive closure
sprawl as every prior package: `dist/` mirrors
`lib/decision-os/behavioral/api/contracts.d.ts` (via `sdk-runtime/core`/
`sdk-runtime/react`, not directly imported), plus the full
`sdk-runtime/core/src/*` and `sdk-runtime/react/src/*` trees. Content-
safety of the behavioral mirror independently re-verified here exactly as
every prior checkpoint did.

## Step 4 — Package boundary tests

`__tests__/sdk-runtime/web-component/package-boundary.test.ts` — **16 new
tests**, all green. Does not duplicate the pre-existing
`__tests__/sdk-runtime/web-component/import-boundary.test.ts` (Phase
7.16, source-level, unmodified, still passing). Covers: package.json
shape (private, sideEffects, single-entry export map, react/react-dom as
REAL dependencies with no peerDependencies block, version match against
root `package.json`, no other-adapter dependency, correct name), build
config (new file, existing config untouched and still `noEmit: true`,
agreement on jsx/lib), and six build-output checks (entry point present,
zero `.js`, export spot-check, zero iframe/js-embed cross-contamination,
zero Prisma/secret leakage, the known transitive-mirror finding
re-confirmed).

## Step 5 — Validation

- **Local build**: `npx tsc -p sdk-runtime/web-component/tsconfig.build.json` — clean.
- **Scoped typecheck**: `npm run typecheck` inside `sdk-runtime/web-component/` — clean, unchanged from before this ticket.
- **Package-boundary tests**: 16/16 green (new this ticket).
- **Full `sdk-runtime/web-component` test directory**: 8 files, 111 tests green (existing runtime tests + new package-boundary suite; zero regressions).
- **Targeted regression proof**: all sdk-runtime test directories (core, react, iframe, web-component) + the G24 League Pulse test together — **819 tests GREEN** across 52 files (up from 803 at the end of F7.26 — the 16 new tests account for the delta exactly).
- **Sibling package typechecks** (`widget-core`, `widget-react`, `widget-iframe`'s 4 chained configs): all clean, confirming this ticket didn't disturb any of them.
- **Main app typecheck**: same 3 pre-existing, unrelated `LeagueShell.tsx` parse errors seen in every Phase 7 checkpoint this whole series; untouched by this ticket.
- **Unrelated repository state**: as in F7.26, this branch continues to carry a large amount of unrelated, already-in-progress work (dashboard/decision-os UI surfaces, e2e specs) outside this ticket's scope. None of it was touched, staged, or committed here — isolated exactly as done in the prior packaging slice.

## Browser proof

Same reasoning as F7.26: this is a type-only packaging slice
(`emitDeclarationOnly: true`), zero JavaScript emitted, zero new UI or
runtime surface. The actual `<allfantasy-widget>` custom-element runtime
behavior (attribute parsing, shadow mount, credential storage, React
render via `sdk-runtime/react`) is already covered by the pre-existing
jsdom-based `element.test.tsx`/`shadow-mount.test.ts`/etc., unmodified and
still green. Local browser validation would not add verification value
for a packaging-only change with no new runtime code — not performed,
documented per the same judgment call as the prior slice.

## Lessons for `widget-js` and final packaging verification

1. **React-as-dependency (not peer) is the correct default for any
   package whose consumer explicitly should not need React installed.**
   `widget-js` bundles React internally per the same ADR D6 as this
   package — expect an identical `dependencies.react`/`react-dom` shape
   (pinned to the root app's version), not a `peerDependencies` block.
2. **Single-entry-point packages don't need the multi-config machinery
   `widget-iframe` needed.** This package (like `widget-core`) has one
   barrel, one existing tsconfig, one new build config — no exports-map
   complexity. `widget-js` is also single-entry per the ADR, so expect
   the same simple shape.
3. **Denylist substring-vs-word-boundary choice is per-package, not
   universal.** `widget-iframe` needed a word-boundary regex for
   `createAllFantasyWidget` because its own exports collided with that
   substring; this package's exports don't collide, so a plain
   `.includes()` check was safe and simpler. `widget-js` should verify
   its own export names against the full cross-adapter denylist before
   picking either style — `widget-js`'s own factory IS expected to be
   named `createAllFantasyWidget` (per the term's origin in
   `sdk-runtime/js-embed/src/createWidget.ts`), so `widget-js`'s
   PACKAGE-BOUNDARY test will need to check for the four OTHER adapters'
   terms while deliberately not forbidding its own.
4. **The `sdk-runtime/core` + `sdk-runtime/react` mirror-into-dist gap is
   now confirmed from four different entry angles** (`widget-react`
   itself, `widget-iframe`'s `react-child`, and now
   `widget-web-component`'s single entry point). `widget-js` will almost
   certainly be the fifth. A real bundler (tsup, still queued) would
   resolve this uniformly — worth prioritizing once `widget-js` lands,
   rather than documenting the same gap a sixth time.

## Next steps (not built in this ticket)

1. `@allfantasy/widget-js` — packaging plan's final (6th) package, single
   entry point, bundles React internally per ADR D6 (same strategy as
   this package).
2. SDK packaging verification (the ADR's final checklist item) once all
   six packages are scaffolded.
3. A real bundler (tsup) across all five scaffolded packages — closes the
   `sdk-runtime/core`/`sdk-runtime/react` undeclared-dependency gap and
   the `behavioral/api/contracts.d.ts` mirror uniformly.
