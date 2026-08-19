# Phase 7.22 — SDK Packaging ADR

## Status

Accepted (plan-only) — 2026-07-01. **No code, no `package.json` files, no build
tooling, and no publishing happen in this ticket** — mirrors
`PHASE_7_5_WIDGET_RUNTIME_BOUNDARY_ADR.md`'s own precedent of shipping a
pure design decision before any implementation ticket touches it.

## Context

`sdk-runtime/` (Phases 7.6–7.18) and `lib/decision-os/sdk/*` (Phases 7.4,
7.19, 7.20) are complete, tested, and typed — 76 source files across five
`sdk-runtime/*` directories plus the frozen `lib/decision-os/sdk/` contract
layer, all consumed today only via TypeScript path imports inside this one
Next.js app. Nothing outside this repository can install or use any of it.
This ticket designs — but does not build — how those pieces become six
independently-versioned, independently-installable npm packages a real
partner (or a future admin UI / partner sandbox) could `npm install`.

A background research pass (before writing this ADR) confirmed the
following facts about the CURRENT codebase, which every decision below is
grounded in:

- **Zero `package.json` files exist anywhere under `sdk-runtime/`.** No npm
  workspaces, no monorepo tool (turborepo/nx/lerna/pnpm-workspaces) is
  configured at the repo root.
- **Every `sdk-runtime/*` package already imports `lib/decision-os/sdk`
  directly** (and, in several files, `lib/decision-os/presentation/
  widget-contracts` / `types` too — always type-only imports).
- **Exactly three sanctioned cross-package imports exist**, all in one
  direction: `sdk-runtime/iframe/src/reactChild`, `sdk-runtime/
  web-component`, and `sdk-runtime/js-embed` each import `sdk-runtime/
  react` directly (composing its `useAllFantasyWidget`/
  `WidgetRenderBoundary`). No other cross-`sdk-runtime` import exists
  anywhere. `sdk-runtime/core` and the main `sdk-runtime/iframe/src/
  index.ts` barrel have zero dependency on any other `sdk-runtime/*`
  package.
- **`sdk-runtime/iframe`'s protocol/handshake layer (main `src/index.ts`)
  does NOT depend on `sdk-runtime/core`** — only its `reactChild`
  subfolder transitively does (via `sdk-runtime/react`, which does depend
  on `core`).
- **Every `sdk-runtime/*` package targets ES2020** (`target: "ES2020"`
  everywhere), and DOM lib is present only where a package genuinely
  touches `window`/`document`/custom elements (`react`, `iframe/browser`,
  `iframe/facade`, `iframe/reactChild`, `web-component`, `js-embed`) — the
  no-DOM packages (`core`, `iframe`'s main protocol layer) enforce this at
  COMPILE time via their scoped tsconfigs having no `"dom"` lib entry.
- **React `18.3.1` and TypeScript `5.6.3`** are the versions currently
  installed at the repo root.
- **`next.config.js` has no browserslist / legacy-target config** — the
  app itself already assumes modern browsers (no IE11/ES5 support), so
  ES2020 across `sdk-runtime/` is already consistent with what the rest of
  the codebase ships.

## Decisions

### D1 — Six packages, boundaries mirror the EXISTING directory structure exactly; no source relocation

```
@allfantasy/sdk-contracts       ← lib/decision-os/sdk/  (unchanged location — still Architecture-Freeze-governed)
@allfantasy/widget-core         ← sdk-runtime/core/
@allfantasy/widget-react        ← sdk-runtime/react/
@allfantasy/widget-iframe       ← sdk-runtime/iframe/  (src + browser + facade combined; reactChild is a SUBPATH — see D4)
@allfantasy/widget-web-component ← sdk-runtime/web-component/
@allfantasy/widget-js           ← sdk-runtime/js-embed/
```

Packaging is a **build-time-only concern**: each package gets its own
`package.json` + bundler config (a future ticket) that reads FROM the
existing `src/` trees and writes a `dist/` — the source files themselves
never move. This is the only design that satisfies "Preserve Architecture
Freeze" literally: `lib/decision-os/sdk/` stays exactly where the freeze
already governs it; publishing `@allfantasy/sdk-contracts` is a NEW
lens on that same, unmoved source tree, not a fork or a copy.

`@allfantasy/js-embed` is named `widget-js` (not `widget-js-embed`) to
match the ticket's own requested package list; internally it still refers
to the `js-embed` implementation directory — this is a published-name
choice, not a source rename.

### D2 — `sdk-contracts` is the ONLY zero-`@allfantasy`-dependency package; every widget-* package depends on it

Confirmed directly by the research: every `sdk-runtime/*` file that
imports Decision OS types imports `lib/decision-os/sdk` (never
`lib/decision-os/presentation` alone, never `lib/decision-os/behavioral`
or `lib/decision-os/world` — those remain completely unreachable from any
package in this plan, exactly as the existing import-boundary tests
already enforce). `sdk-contracts` sits at the root of the dependency
graph; nothing depends on any widget-* package from `sdk-contracts`.

### D3 — Dependency graph (regular deps only; peers documented separately in D6)

```
sdk-contracts   (no @allfantasy deps)
  ↑
widget-core     (dep: sdk-contracts)
  ↑
widget-react    (deps: sdk-contracts, widget-core)
  ↑ (sanctioned composition — see D4)
  ├── widget-iframe/react-child  (subpath; dep: widget-react)
  ├── widget-web-component       (dep: widget-react, bundles React — see D6)
  └── widget-js                  (dep: widget-react, bundles React — see D6)

widget-iframe   (dep: sdk-contracts only — its protocol layer needs nothing else)
```

`widget-iframe`'s BASE package (protocol + browser DOM bridge + host/child
facades) has no dependency on `widget-core` or `widget-react` at all —
confirmed by the research finding that `sdk-runtime/iframe/src/index.ts`
imports only `lib/decision-os/sdk`. Only the `reactChild` subpath (D4)
pulls in `widget-react`.

### D4 — `widget-iframe`'s `reactChild` composition ships as a SUBPATH export, not the main entry

`sdk-runtime/iframe/src/reactChild/` is ALREADY a separate barrel, never
re-exported from the main `sdk-runtime/iframe/src/index.ts` (established
in Phase 7.15 specifically so the no-DOM, no-React protocol layer stays
importable without pulling in React). Packaging preserves that boundary
exactly via `package.json`'s `"exports"` map:

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./browser": "./dist/browser/index.js",
    "./facade": "./dist/facade/index.js",
    "./react-child": "./dist/reactChild/index.js"
  }
}
```

A consumer embedding a non-React iframe widget (or building their own
renderer on the protocol layer) never installs a React dependency at all.
A consumer using the React child bridge imports
`@allfantasy/widget-iframe/react-child` and pulls in `widget-react`
(and therefore `react`/`react-dom` peers) only then.

### D5 — `sideEffects: false` everywhere; zero surprises for tree-shaking

Every package's `package.json` declares `"sideEffects": false`. This is
not aspirational — it is already a validated property of the current
source: `defineAllFantasyWidgetElement()` and `attachAllFantasyGlobal()`
are explicit, idempotent, caller-invoked functions (Phase 7.16/7.17's own
design notes: "explicit, idempotent registration — never a module-load
side effect"); no file anywhere in `sdk-runtime/` mutates `window`,
registers a global listener, or runs any effect merely by being imported.
A bundler can safely drop any unused export from any package.

### D6 — Peer dependencies split by CONSUMER expectation, not by uniform rule

Two deliberately different strategies, because the two audiences are
different:

- **`widget-react`** — `react`/`react-dom` are **peerDependencies**
  (`>=18.0.0 <19.0.0`, matching the installed `18.3.1`), never bundled.
  This package's consumer is, by definition, a React application that
  already has its own React instance — bundling a second copy would risk
  the classic "two React instances" runtime error (invalid hook call,
  broken context).

- **`widget-web-component`** and **`widget-js`** — `react`/`react-dom` are
  **regular (bundled) dependencies**, never peers. Both packages exist
  specifically so a partner site with NO React installed at all (a plain
  HTML/CSS/JS page, or any other framework) can still render a widget —
  requiring the consumer to separately `npm install react` would defeat
  the entire purpose of these two embed targets. Internally they still
  compose `widget-react`'s `useAllFantasyWidget`/`WidgetRenderBoundary`
  (D2's sanctioned exception), but that composition is an implementation
  detail bundled into `dist/`, invisible to the consumer.

- **`widget-core`, `widget-iframe` (base), `sdk-contracts`** — no React
  peer or dependency at all (confirmed zero-React by the research).

### D7 — ESM primary, CJS secondary, UMD only where a `<script>` tag is the actual use case

- `sdk-contracts`, `widget-core`, `widget-react`, `widget-iframe`,
  `widget-web-component`: dual ESM+CJS via conditional `"exports"`
  (`"import"`/`"require"` conditions), ESM as the primary/recommended
  build. No UMD — these targets assume a bundler (a partner's own React
  app, or a build step for the web component).
- `widget-js`: ESM+CJS **plus** a UMD/IIFE bundle
  (`dist/allfantasy-widget.umd.js`) exposing `window.AllFantasy` via the
  ALREADY-BUILT `attachAllFantasyGlobal()` — this is the one package whose
  entire purpose (per Phase 7.17's own design) is a partner dropping in a
  bare `<script>` tag with no build step. The UMD bundle is the only
  place `react`/`react-dom` get physically inlined into a single file
  (consistent with D6 — this package bundles React on purpose).

### D8 — Independent semver per package, gated by a compatibility table (not lockstep versioning)

Each of the six packages versions independently. Lockstep versioning
(one version number for all six) was rejected: `widget-core`,
`widget-iframe`'s protocol layer, and `sdk-contracts` change far less
often than the three composition packages, and forcing a release of all
six whenever any one changes creates release noise a partner has to
re-verify against every time.

Compatibility is instead governed by the ALREADY-EXISTING `SDKVersion`
contract (Phase 7.4 — `sdkVersion`/`presentationVersion`/
`widgetContractVersion`/`apiVersion`), which every runtime already
validates via `validateSDKConfig`. Packaging semver and that RUNTIME
version contract are two complementary layers, not a duplicate mechanism:
npm's dependency resolution keeps package versions compatible at install
time; `SDKVersion` keeps a running widget's config compatible with the
live Presentation API at request time, independent of what a consumer's
`node_modules` happens to contain.

## Consequences

- A future implementation ticket can package `sdk-contracts` first (see
  the packaging plan's recommended-first-package section) with the
  lowest risk of the six, since it has no other `@allfantasy` dependency
  and no DOM/React complexity.
- The `widget-iframe` subpath-export design (D4) means a future
  `react-child` change never forces a version bump on a consumer who only
  uses the base iframe protocol — genuinely reduces unnecessary churn for
  non-React iframe consumers.
- `widget-web-component`/`widget-js` bundling React internally (D6) means
  their `dist/` bundle size includes React — an explicit, accepted
  tradeoff for zero-build-step consumption, to be confirmed against a
  real bundle-size budget when those packages are actually built.

## Non-goals (explicitly out of scope, per the ticket's own rules)

- No `package.json` file is created by this ticket.
- No build tooling (tsup/rollup/tsc build config) is chosen or configured.
- No npm registry account, npm publish, or CI publish workflow.
- No production deployment of any kind.
- No new source code or feature behavior — every fact this ADR relies on
  was already true of `sdk-runtime/`/`lib/decision-os/sdk` before this
  ticket started.
