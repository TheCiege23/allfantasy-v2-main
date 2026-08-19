# Phase 7.26 — @allfantasy/widget-iframe Package Scaffolding Checkpoint

Status: **SCAFFOLDING COMPLETE, LOCALLY BUILT AND VERIFIED — 2026-07-01**.
Fourth package from `PHASE_7_22_SDK_PACKAGING_ADR.md`'s dependency graph —
the structurally most complex of the six (four independent entry points,
per ADR D4), and the first package whose composition subpath
(`./react-child`) depends on another already-packaged sibling
(`@allfantasy/widget-react`, Phase 7.25). No publish, no external service
writes, no runtime behavior change to any existing file.

## Step 1 — Audit of the existing runtime

`sdk-runtime/iframe/src/` has exactly **four public entry points**, each its
own barrel, none re-exporting another (a boundary already established in
Phase 7.11/7.15, preserved exactly as-is):

| Entry point | Barrel | DOM? | React? | Depends on |
| --- | --- | --- | --- | --- |
| `.` (base protocol) | `src/index.ts` | No | No | `lib/decision-os/sdk` only |
| `./browser` | `src/browser/index.ts` | Yes | No | nothing outside the package |
| `./facade` | `src/facade/index.ts` | Yes | No | `lib/decision-os/sdk` only |
| `./react-child` | `src/reactChild/index.ts` | Yes | Yes | `lib/decision-os/sdk`, `lib/decision-os/presentation`, `sdk-runtime/core`, `sdk-runtime/react` |

Confirmed by reading every barrel and grepping the whole `src/` tree for
cross-boundary imports:

- The base index (`src/index.ts`) exports the versioned postMessage
  protocol (types, builders, validators), config validation, origin
  validation, sandbox/CSP helpers, lifecycle/error mapping, the
  `WindowLike` contracts, `safePostMessage`, message listeners, and the
  `IframeHostBootstrap`/`IframeClientBootstrap` classes. Zero DOM, zero
  React — matches the design note already in `browser/index.ts`'s own
  header comment ("that main index is typechecked with no 'dom' lib...
  re-exporting DOM-typed symbols through it would break that guarantee").
- `./browser` wires real `window`/`document`/`HTMLIFrameElement`/Web Crypto
  (`createBrowserWindowBridge`, `createIframeContentWindowBridge`,
  `generateNonce`, `mountIframeWidget`, `teardownIframeWidget`). No
  imports outside the package at all.
- `./facade` exposes the two top-level factories a partner actually calls —
  `createAllFantasyWidgetHost` (parent page) and
  `createAllFantasyWidgetIframeClient` /
  `createAllFantasyWidgetIframeClientFromUrl` (code running inside the
  iframe). Depends only on `lib/decision-os/sdk` types.
- `./react-child` is the one adapter-depends-on-adapter composition
  (documented in the file's own header as "the one sanctioned exception"):
  `mountReactIframeChildBridge` wires `sdk-runtime/react`'s
  `useAllFantasyWidget`/`WidgetRenderBoundary` into the facade's iframe
  client. This is the ONLY entry point requiring React.

No duplicate exports across the four barrels (each name appears in exactly
one). No `lib/decision-os/behavioral/*`, no `lib/decision-os/world/*`, no
Prisma import anywhere in `src/`.

## Step 2 — Package design

Four pre-existing, typecheck-only tsconfigs already existed
(`tsconfig.json`, `tsconfig.browser.json`, `tsconfig.facade.json`,
`tsconfig.reactChild.json` — all `noEmit: true`, scoped `include` per
entry point, established across Phase 7.9-7.15). **None of the four were
modified.** Rather than create four parallel `tsconfig.*.build.json`
files (one per entry point), a single new `tsconfig.build.json` compiles
the full `src/**/*.ts`+`src/**/*.tsx` superset in one `tsc` pass — using
the union of what the four existing configs need (`DOM` lib +
`react-jsx`) — since declaration EMISSION doesn't need the same
architectural-purity isolation the four TYPECHECK configs enforce (that
enforcement is unchanged and still runs via `npm run typecheck`, which
chains all four). This is the simplest design that produces one `dist/`
tree covering all four entry points, matching ADR D4's exports map
structure directly:

```json
"exports": {
  ".": { "types": "./dist/sdk-runtime/iframe/src/index.d.ts" },
  "./browser": { "types": "./dist/sdk-runtime/iframe/src/browser/index.d.ts" },
  "./facade": { "types": "./dist/sdk-runtime/iframe/src/facade/index.d.ts" },
  "./react-child": { "types": "./dist/sdk-runtime/iframe/src/reactChild/index.d.ts" },
  "./package.json": "./package.json"
}
```

**Peer dependencies, refined beyond the ADR's literal text.** D4 says a
react-child consumer "pulls in `widget-react` (and therefore
`react`/`react-dom` peers) only then" — but `package.json` has no
per-subpath peer-dependency mechanism; `peerDependencies` applies to the
whole package. Rather than force every base/browser/facade-only consumer
to also see an unconditional `react`/`react-dom` peer requirement, this
ticket adds `peerDependenciesMeta` marking both `optional: true`. This is
a real, meaningful packaging-metadata correctness improvement (npm/pnpm
will not warn a non-React consumer for missing peers they never need) —
not a feature or behavior change, purely dependency-declaration semantics
consistent with the ADR's own stated intent.

`@allfantasy/widget-react` and `@allfantasy/widget-core` are **not**
declared as dependencies, for the same reason F7.24/F7.25 didn't declare
their own sibling-package edges: nothing in `reactChild`'s actual source
imports them by package name — `IframeChildWidgetBridge.tsx` imports
`../../../react/src/index` (a real relative path). Declaring a
`dependencies` entry that doesn't correspond to an actual package-name
import would be aspirational, not accurate; the gap is documented (again)
below instead.

## Step 3 — Build verification

`npx tsc -p tsconfig.build.json` — clean, zero errors, zero `.js` files
anywhere in `dist/` (`emitDeclarationOnly: true`). All four entry-point
`.d.ts` files present and spot-checked for their expected exports
(protocol builders/validators, browser DOM wiring, facade factories,
`mountReactIframeChildBridge`).

**Confirmed iframe runtime only — no cross-contamination in either
direction:**
- Base/browser/facade `.d.ts` output contains no `from 'react'` reference
  at all (verified directly against the built files, not just the
  source).
- No web-component-specific concept (`AllFantasyWidgetElement`,
  `attachShadowMountRoot`) or js-embed-specific concept anywhere in the
  built tree. One naming subtlety: js-embed's exact factory name
  `createAllFantasyWidget` (no suffix) is a literal PREFIX of this
  package's own legitimate `createAllFantasyWidgetHost`/
  `createAllFantasyWidgetIframeClient` exports, so the check uses a
  `\bcreateAllFantasyWidget\b` word-boundary regex rather than a plain
  substring match — a plain `.includes()` would have false-positived on
  this package's own facade exports.
- Zero Prisma references, zero secret-shaped field names, zero
  credential-looking strings anywhere in `dist/`.

**Known limitation, re-confirmed a fourth time.** The same transitive
closure sprawl documented in F7.23/7.24/7.25 recurs here, now from a third
angle: `dist/` mirrors `lib/decision-os/behavioral/api/contracts.d.ts`
(pulled in transitively via `sdk-runtime/core`/`sdk-runtime/react`, not
directly imported by `sdk-runtime/iframe`), plus the full
`sdk-runtime/core/src/*` and `sdk-runtime/react/src/*` trees (needed by
`react-child`). Content-safety of the behavioral mirror was independently
re-verified here exactly as the three prior checkpoints did (header-text
+ no-field-declarations check), not merely cited.

## Step 4 — Package boundary tests

`__tests__/sdk-runtime/iframe/package-boundary.test.ts` — **20 new tests**,
all green. Does not duplicate the pre-existing
`__tests__/sdk-runtime/iframe/import-boundary.test.ts` (Phase 7.9-7.15,
source-level boundary coverage, unmodified and still passing). Covers:
package.json shape (private, sideEffects, exact four-subpath exports map,
optional peer deps, no other-adapter dependency, correct name), build
config (new file, four existing typecheck configs untouched and still
`noEmit: true`, superset build config has the right libs/jsx/include), and
nine build-output checks (all four entry points present, zero `.js`,
per-entry-point export spot-checks, zero web-component/js-embed
cross-contamination, zero Prisma/secret leakage, the known transitive-
mirror finding re-confirmed, and zero React references in the
non-react-child entry points' built output).

## Step 5 — Validation

- **Local build**: `npx tsc -p sdk-runtime/iframe/tsconfig.build.json` —
  clean.
- **Scoped typechecks**: `npm run typecheck` inside `sdk-runtime/iframe/`
  (chains all four existing per-entry-point configs) — clean, unchanged
  from before this ticket.
- **Package-boundary tests**: 20/20 green (new this ticket).
- **Full `sdk-runtime/iframe` test directory**: 25 files, 348 tests green
  (existing runtime tests + the new package-boundary suite; zero
  regressions).
- **Sibling package typechecks** (`widget-core`, `widget-react`): both
  clean, confirming this ticket didn't disturb either.
- **Full regression suite**: see commit report for the exact total; no
  new failures attributable to this ticket.
- **Main app typecheck**: same 3 pre-existing, unrelated `LeagueShell.tsx`
  parse errors seen in every Phase 7 typecheck this whole series;
  untouched by this ticket.

## Browser proof

This is a type-only packaging slice with `emitDeclarationOnly: true` — it
emits zero JavaScript and introduces zero new UI or runtime surface. There
is nothing new for a Playwright/browser session to observe: the actual
`react-child` runtime behavior (mount, init handshake, resize/error
reporting) is already covered by the pre-existing jsdom-based
`__tests__/sdk-runtime/iframe/end-to-end.test.ts`, unmodified and still
green, and the unrelated dashboard Playwright suite (fixed in the prior
G24 slice) has no dependency on this package. Judgment: local browser
validation would not add verification value here, so it was not performed
— documented per the ticket's own "if it benefits" framing rather than run
pro forma.

## Lessons for `widget-web-component` and `widget-js`

1. **Multi-entry-point packages don't need N build configs.** One
   superset build config (union of libs/jsx across all entry points) is
   simpler and just as correct as N parallel ones, as long as the N
   existing purity-enforcing typecheck configs stay untouched and keep
   doing the isolation job. `widget-web-component` and `widget-js` are
   each single-entry-point per the ADR, so this lesson is more about
   `widget-iframe` itself than a forward pointer — but if either package
   grows a second entry point later, prefer this pattern over duplicating
   tsconfigs.
2. **`peerDependenciesMeta.optional` is the right tool whenever a
   dependency is needed by only one subset of a multi-entry-point
   package's consumers.** `widget-web-component` and `widget-js` bundle
   React internally (ADR D6 — opposite strategy from `widget-iframe`/
   `widget-react`), so this specific pattern won't recur for them, but the
   underlying principle (don't force a peer requirement on consumers of
   subpaths that don't need it) generalizes to any future subpath split.
3. **Word-boundary checks, not substring checks, for cross-adapter
   denylist terms that could collide with a package's own legitimate
   names.** `widget-iframe`'s own `createAllFantasyWidgetHost`/
   `createAllFantasyWidgetIframeClient` share a prefix with js-embed's
   `createAllFantasyWidget`. `widget-web-component` and `widget-js`
   package-boundary tests should double-check their own forbidden-term
   lists against this package's actual export names (and each other's)
   before reusing them verbatim.
4. **The `sdk-runtime/core` + `sdk-runtime/react` mirror-into-dist gap is
   now confirmed from three different entry angles** (`widget-react`
   itself, and now `widget-iframe`'s `react-child` subpath). A real
   bundler (tsup, still queued from F7.25's "Next steps") would resolve
   this uniformly across all packages that compose siblings via relative
   imports — worth doing before `widget-web-component`/`widget-js`, since
   both also bundle `widget-react` per ADR D6 and would otherwise repeat
   the same undeclared-dependency documentation a fifth and sixth time.

## Next steps (not built in this ticket)

1. `@allfantasy/widget-web-component` and `@allfantasy/widget-js` remain —
   both bundle React internally per ADR D6, the opposite strategy from
   this package and `widget-react`.
2. SDK packaging verification (the ADR's final checklist item) once all
   six packages are scaffolded.
3. A real bundler (tsup) across all four scaffolded packages — closes the
   `sdk-runtime/core`/`sdk-runtime/react` undeclared-dependency gap and
   the `behavioral/api/contracts.d.ts` mirror uniformly, per F7.25's
   already-queued recommendation.
