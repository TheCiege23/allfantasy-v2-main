# Phase 7.29 — Final SDK Packaging Verification

Status: **VERIFICATION COMPLETE — 2026-07-01**. Cross-package audit of all
six `@allfantasy/*` SDK packages scaffolded across F7.23-F7.28. No package
behavior, runtime behavior, or Decision OS behavior changed. No publish.
This slice concludes Phase 7.

## Step 1 — Package inventory

| Package | Version | Private | Type | Entry points | React strategy |
| --- | --- | --- | --- | --- | --- |
| `@allfantasy/sdk-contracts` | 0.1.0 | true | module | 1 | none |
| `@allfantasy/widget-core` | 0.1.0 | true | module | 1 | none |
| `@allfantasy/widget-react` | 0.1.0 | true | module | 1 | peer (`^18.0.0`) |
| `@allfantasy/widget-iframe` | 0.1.0 | true | module | 4 (`.`, `./browser`, `./facade`, `./react-child`) | peer, **optional** (only `./react-child`) |
| `@allfantasy/widget-web-component` | 0.1.0 | true | module | 1 | real dependency (`^18.3.1`) |
| `@allfantasy/widget-js` | 0.1.0 | true | module | 1 | real dependency (`^18.3.1`) |

Consistent across all six: `sideEffects: false`, `files: ["dist"]`,
`engines.node: ">=18"`, `publishConfig.access: "restricted"`, a top-level
`"types"` field mirroring `exports["."].types` exactly (redundant by
design, for older `moduleResolution` settings that don't read `exports`),
an `"./package.json"` export, `devDependencies.typescript: "^5.6.3"`
(matches the root app's pinned version exactly), and an
`exports["<subpath>"].types`-only shape (no `"import"`/`"require"`
conditions yet — declaration-only builds, no real JS emitted).

**Inconsistencies found (all cosmetic, none functional):**

1. **`peerDependencies` field presence.** `sdk-contracts` and
   `widget-core` explicitly declare `"peerDependencies": {}` (empty
   object) even though they have none. `widget-web-component` and
   `widget-js` omit the key entirely (they use `dependencies` instead).
   Functionally identical to npm — recommend standardizing on "omit when
   empty" before publish, purely for readability.
2. **Build script shape** differs by whether a package had a
   pre-existing typecheck-only `tsconfig.json` to preserve:
   `sdk-contracts`/`widget-core` run `tsc -p tsconfig.json` directly (no
   prior config to protect); the other four run `tsc -p
   tsconfig.build.json` (a new file, leaving an existing typecheck config
   untouched). This is a deliberate, documented difference from each
   package's own scaffolding ticket, not a defect — flagged here only so
   it isn't mistaken for drift.
3. **No `license` field** on any of the six packages. Not a blocker while
   `private: true` (never published), but should be set before any real
   `npm publish` is considered.
4. **`widget-iframe`'s `typecheck` script is a 4-command chain**
   (`&&`-joined, one per entry point's isolation-enforcing tsconfig);
   every other package uses a single `tsc --noEmit -p tsconfig.json`.
   Expected — matches `widget-iframe`'s unique four-entry-point design,
   not an inconsistency to fix.

No other inconsistencies found. Descriptions, `exports["./package.json"]`
export, and file-whitelist shape are otherwise uniform.

## Step 2 — Dependency graph verification

**Actual graph, constructed by grepping every import line in all six
packages' `src/`:**

```
lib/decision-os/sdk + lib/decision-os/presentation/widget-contracts   (frozen, Architecture-Freeze-governed)
        │
        ├──▶ @allfantasy/sdk-contracts        (thin re-export wrapper, package root)
        │
        ├──▶ @allfantasy/widget-core           (imports lib/decision-os/sdk + presentation only)
        │        │
        │        └──▶ @allfantasy/widget-react (imports core + lib/decision-os/sdk + presentation)
        │                  │
        │                  ├──▶ @allfantasy/widget-iframe/react-child   (composes react + core)
        │                  ├──▶ @allfantasy/widget-web-component        (composes react + core)
        │                  └──▶ @allfantasy/widget-js                  (composes react + core)
        │
        └──▶ @allfantasy/widget-iframe (., /browser, /facade)   (imports lib/decision-os/sdk + presentation directly — bypasses core/react entirely)
```

Matches `PHASE_7_22_SDK_PACKAGING_ADR.md`'s dependency-graph diagram
exactly, including the two intentional bypasses: `widget-iframe`'s
base/browser/facade entry points depend on `sdk-contracts` alone (never
`widget-core`), and `widget-core` has zero dependency on anything React.

**No circular dependencies** — verified by grepping `sdk-runtime/core/src`
and `sdk-runtime/react/src` for any import of a downstream package
(iframe/web-component/js-embed): zero matches in either direction. The
graph is a clean DAG.

**No Decision OS internals exposed** — every package's built `dist/`
touches only two `lib/decision-os/` subtrees: `sdk/` and
`presentation/widget-contracts.ts` (+ `presentation/types.ts`,
`presentation/tokens.ts` for shared token types), both explicitly frozen,
external-facing contracts per `PHASE_7_5_WIDGET_RUNTIME_BOUNDARY_ADR.md`.
The one recurring mirror — `lib/decision-os/behavioral/api/contracts.d.ts`
— is itself self-labeled `EXTERNAL types for the hosted Intelligence API`
in its own header, and has been content-verified (no `warnings`/
`derivedFrom`/`lookbackDays`/`provenance` field declarations) independently
in every one of the five packaging tickets that pulled it in transitively
(F7.24-F7.28). Zero `lib/decision-os/world/*` anywhere. Zero Prisma
anywhere (checked in every package-boundary suite). Zero secret-shaped
field names or credential-looking strings anywhere (same).

**The single most important cross-package finding**: **none of the six
`package.json` files declare an `@allfantasy/*` dependency on any
sibling package**, even though four of them (`widget-react` →
`widget-core`; `widget-iframe/react-child`, `widget-web-component`,
`widget-js` → both `widget-core` and `widget-react`) genuinely compose a
sibling's source at the TypeScript level via real relative imports (e.g.
`../../react/src/index`), not by package name. This is why every
sibling-composing package's `dist/` mirrors the full transitive closure
of its dependencies' source trees rather than referencing a real
published dependency — documented individually five times
(F7.24/25/26/27/28) and now stated once, comprehensively, here. **This is
the single blocking issue before a real `npm publish` of any
sibling-composing package**: publishing `widget-web-component` today
would ship a `dist/` containing a full copy of `widget-react`'s and
`widget-core`'s compiled output with no `package.json` dependency edge
recording that relationship — works today (single-repo, file: linked,
non-published), would NOT work correctly as an independently versioned,
independently published npm package.

## Step 3 — Cross-package build verification

All six packages cleaned and rebuilt independently, from a clean `dist/`
state, in isolation (each package's own `npm run build`, no shared
build step, no cross-package build ordering required — a real property
of the current no-declared-dependencies shape, ironic given the finding
above): **all six exit 0, zero errors, zero warnings.**

| Package | `.js` files in `dist/` | Entry-point `.d.ts` files present |
| --- | --- | --- |
| `sdk-contracts` | 0 | 1/1 |
| `widget-core` | 0 | 1/1 |
| `widget-react` | 0 | 1/1 |
| `widget-iframe` | 0 | 4/4 |
| `widget-web-component` | 0 | 1/1 |
| `widget-js` | 0 | 1/1 |

Every package is `emitDeclarationOnly: true` — genuinely type-only builds
across the board, no accidental JS drift in any of the six.

## Step 4 — Consumer verification

A temporary, non-repo consumer workspace was created outside the repo
(`<scratchpad>/sdk-consumer-check/`, never committed) with its own
`package.json` declaring all six packages as **local `file:`
dependencies** (absolute paths, e.g.
`"@allfantasy/widget-iframe": "file:F:/allfantasy-v2-main/sdk-runtime/iframe"`)
plus `react`/`react-dom` matching the root app's exact pinned version.

- `npm install` — **16 packages added, 0 vulnerabilities.** npm resolved
  every `file:` reference as a **directory junction** (Windows' local-link
  mechanism) pointing straight back at each package's real source
  directory under `sdk-runtime/` — genuine local linking, no copy, no
  registry, no publish.
- A consumer `src/index.ts` imports one real VALUE export and one real
  TYPE export from **every one of the nine public entry points** across
  all six packages (including all four `widget-iframe` subpaths:
  `.`, `./browser`, `./facade`, `./react-child`), exclusively through
  each package's declared `exports` map — never a deep/internal path.
- `npx tsc --noEmit` against that consumer file — **exit 0, zero
  errors.** Confirms every public export (value and type) resolves
  correctly end-to-end through real `node_modules` package resolution,
  for an external-style consumer, not just via source-relative imports
  inside this repo.

**Scoping note**: because every package is currently `emitDeclarationOnly`
(no JS shipped), this consumer check proves TYPE resolution and package
boundary integrity — not runtime `require()`/`import()` execution. A real
runtime consumer smoke test is blocked on the queued bundler work (see
Recommendations).

## Step 5 — Export surface audit

Every one of the nine built entry-point `.d.ts` files was compared
against its source barrel. All nine are **exact 1:1 re-export mirrors**
of their source `index.ts` — no additions, no omissions. This holds
structurally, not by luck: every barrel across all six packages uses
explicit named `export { x, y } from './z'` / `export type { ... }`
syntax exclusively — **zero use of `export *` anywhere in
`sdk-runtime/`** — combined with `isolatedModules: true` on every
tsconfig (which forbids the ambiguous re-export patterns that could let
an unintended symbol leak through). Spot-checked directly:
`widget-js`'s and `widget-iframe`'s `facade` barrels both compile to
byte-for-byte re-export lists matching their source.

No accidental exports, no duplicate exports across packages (each
package's exported symbol names are unique to it — no two packages
export a colliding top-level name, verified during F7.26-7.28's
cross-adapter denylist checks), no internal Decision OS runtime exposed,
no private helper functions exposed (every barrel exports only the
subset of its module's functions that the module itself chose to
export from its own file — verified against each source file's own
`export` statements during Step 1's audit reads across all six
packages' scaffolding tickets).

## Step 6 — Tree-shaking / bundle audit

**Structurally ready, not yet bundle-verified.**

- `sideEffects: false` on all six — a bundler is free to drop any
  unused export from any package. This is not aspirational: every
  module-scope side effect in the whole `sdk-runtime/` tree is
  explicit and caller-invoked (`defineAllFantasyWidgetElement()`,
  `attachAllFantasyGlobal()`), never a module-load effect — verified
  directly from source in F7.16/F7.17's own design notes and
  re-confirmed in F7.27/F7.28's package-boundary tests.
- `widget-iframe`'s four-subpath `exports` map is the one package that
  gets real import-level tree-shaking benefit TODAY, even without a
  bundler: a consumer who only imports `.` never triggers module
  resolution of `./react-child` at all, so React-touching code is never
  even loaded into the consumer's type-checker or (once real JS ships)
  its module graph.
- **What can't be verified yet**: real bytecode/module-level
  tree-shaking (dead-export elimination inside a bundled `.js` file)
  requires an actual JS bundle to inspect. Every package is
  `emitDeclarationOnly` — there is no JS to run a tree-shaking analysis
  against. This is an honest gap, not a failure: the packages are
  correctly *positioned* for tree-shaking (metadata, export granularity,
  subpath structure), but the property itself is unverifiable until the
  queued bundler work lands.

## Step 7 — Regression verification

- **Full `__tests__/sdk-runtime` + G24 League Pulse test**: **835/835
  green across 53 files** — unchanged from the end of F7.28 (this ticket
  added zero new source files and zero new package-boundary tests; it is
  a verification-only slice, so an unchanged total IS the expected,
  correct outcome).
- **All nine scoped typecheck configs** (`sdk-contracts`, `widget-core`,
  `widget-react`, `widget-iframe`'s four chained configs,
  `widget-web-component`, `widget-js`) — all clean, zero errors.
- **Main app typecheck**: same 3 pre-existing, unrelated
  `LeagueShell.tsx` parse errors seen in every Phase 7 checkpoint since
  F7.9 — unchanged.
- **Unrelated repository state**: as documented in F7.26/F7.27/F7.28,
  this branch continues to carry a large amount of unrelated,
  already-in-progress work outside the SDK packaging series. None of it
  was touched, staged, or inspected further here — isolated exactly as
  done in the three prior packaging slices.

## Recommendations before any real `npm publish`

1. **Declare real `@allfantasy/*` dependency edges** for the four
   sibling-composing packages (`widget-react`→`widget-core`;
   `widget-iframe`'s `react-child`, `widget-web-component`, `widget-js`
   →`widget-core`+`widget-react`) — currently undeclared because the
   source uses relative imports, not package names. Requires either (a)
   a real bundler that resolves siblings by package name, or (b)
   rewriting the relative imports to package-name imports even before a
   bundler exists (riskier — would need `node_modules` symlinks to
   resolve locally, more invasive for a "packaging only" ticket).
   **This is the single most consequential open item** — everything else
   in this report is verified clean.
2. **A real bundler (tsup, queued since F7.25)** would resolve #1 AND
   close the `behavioral/api/contracts.d.ts` mirror-into-dist gap AND
   make Step 6's tree-shaking audit actually verifiable at the bundle
   level, in one coordinated change across all six packages.
3. **Add a `license` field** to all six `package.json` files before
   publish (currently absent — fine while `private: true`).
4. **Standardize the `peerDependencies: {}` vs. omitted-key** stylistic
   difference (cosmetic only, listed in Step 1).
5. **A real runtime consumer smoke test** (not just `tsc --noEmit`) once
   #2 ships real JS — actually instantiate `createAllFantasyWidget`,
   mount `<allfantasy-widget>`, render the React component, etc., inside
   the temporary consumer workspace pattern established in Step 4.

None of these block continued Phase 7/8 work — they are the concrete,
scoped list to work through specifically when/if a real `npm publish` of
any package becomes a near-term goal.
