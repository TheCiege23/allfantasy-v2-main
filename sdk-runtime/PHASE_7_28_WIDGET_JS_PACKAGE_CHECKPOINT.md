# Phase 7.28 — @allfantasy/widget-js Package Scaffolding Checkpoint

Status: **SCAFFOLDING COMPLETE, LOCALLY BUILT AND VERIFIED — 2026-07-01**.
Sixth and FINAL package from `PHASE_7_22_SDK_PACKAGING_ADR.md`'s
dependency graph. No publish, no external service writes, no runtime
behavior change to any existing file.

## Step 1 — Audit of the existing runtime

Source lives in `sdk-runtime/js-embed/` (the ADR's mapping table names it
`@allfantasy/widget-js ← sdk-runtime/js-embed/`; the ticket's shorthand
`sdk-runtime/js/` path doesn't exist on disk — confirmed by directory
listing before writing anything). Exactly **one public entry point**
(`src/index.ts`) — same shape as `widget-core` and `widget-web-component`,
not `widget-iframe`'s four subpaths.

| File | Exports | Depends on |
| --- | --- | --- |
| `createWidget.ts` | `createAllFantasyWidget` (the public factory: `AllFantasy.createWidget({container, config, auth, apiKey, baseUrl})`) | `react-dom/client`, `sdk-runtime/react` (real relative path), `lib/decision-os/sdk/errors`, local modules |
| `namespace.ts` | `AllFantasy`, `attachAllFantasyGlobal`, `SDK_JS_EMBED_VERSION` | `./createWidget` only |
| `containerValidation.ts` | `validateContainer` | nothing outside the package |
| `config.ts` | `buildWidgetConfigWithCredential`, `validateCreateWidgetInputs` | `lib/decision-os/sdk/auth`, `lib/decision-os/sdk/types` |
| `defaults.ts` | default fetch/clock | `sdk-runtime/core` (real relative path) |
| `AllFantasyWidgetBridge.tsx` | render helpers (not re-exported from index) | `react`, `sdk-runtime/react` (real relative path), `lib/decision-os/presentation/widget-contracts`, `lib/decision-os/sdk/types`, `sdk-runtime/core` (real relative path) |
| `types.ts` | config/instance/callback types | `lib/decision-os/presentation/widget-contracts`, `lib/decision-os/sdk/types`, `sdk-runtime/core`, `sdk-runtime/react` (all real relative paths) |

**Dependency graph answer to the ticket's explicit question**: this
package depends on `sdk-runtime/core` + `sdk-runtime/react` (the
"sanctioned adapter-depends-on-adapter" composition, same pattern as
`widget-iframe`'s `react-child` and `widget-web-component`'s single
entry) and the frozen `lib/decision-os/sdk`/`lib/decision-os/presentation`
contracts. It does **NOT** depend on `sdk-runtime/iframe` or
`sdk-runtime/web-component` at all — confirmed by grepping every import
line in the package; no browser-bridge-specific code (`window`,
`HTMLIFrameElement`, `customElements`, Shadow DOM) appears anywhere. All
within the already-established allowed boundary — zero
`lib/decision-os/behavioral/*`, zero `lib/decision-os/world/*`, zero
Prisma anywhere in `src/`. No duplicate exports.

`namespace.ts`'s own header comment confirms `sideEffects: false` is
safe, independently of the four prior packages' equivalent findings:
`attachAllFantasyGlobal` is explicit/caller-invoked, sets exactly ONE
property on its target, never a module-load effect.

## Step 2 — Package design

Same shape as `widget-web-component` (F7.27), the closest sibling
precedent: one pre-existing typecheck-only `tsconfig.json` (Phase 7.17,
`noEmit: true`, DOM+`react-jsx`) left completely untouched; a new
`tsconfig.build.json` added alongside it (declaration/declarationMap/
emitDeclarationOnly/outDir, agreeing with the existing config on
jsx/lib — verified by a test).

```json
"exports": {
  ".": { "types": "./dist/sdk-runtime/js-embed/src/index.d.ts" },
  "./package.json": "./package.json"
}
```

**`react`/`react-dom` as REAL `dependencies`** (pinned to `^18.3.1`,
matching root exactly, verified by a test comparing the two
`package.json` files), no `peerDependencies` block — same D6 strategy as
`widget-web-component`: a `<script>`-tag consumer calling
`AllFantasy.createWidget(...)` should never need to `npm install react`
themselves. `@allfantasy/widget-core`/`@allfantasy/widget-react` still
not declared as dependencies (same reasoning as every prior
sibling-composing package: relative-path imports, not by package name).

## Step 3 — Build verification

`npx tsc -p tsconfig.build.json` — clean, zero errors, zero `.js` files
anywhere in `dist/`. The single entry point `.d.ts` spot-checked for its
expected exports (`createAllFantasyWidget`, `AllFantasy`,
`attachAllFantasyGlobal`, `SDK_JS_EMBED_VERSION`, `validateContainer`,
`buildWidgetConfigWithCredential`, `defaultFetchImpl`).

**Confirmed js-embed runtime only — no cross-contamination:**
- Zero iframe-adapter concept (`IframeEmbedConfig`,
  `IFRAME_PROTOCOL_VERSION`) or web-component-specific concept
  (`AllFantasyWidgetElement`, `attachShadowMountRoot`,
  `defineAllFantasyWidgetElement`) anywhere in the built tree.
- **Deliberately does NOT forbid `createAllFantasyWidget` or
  `attachAllFantasyGlobal`** — exactly the naming collision flagged as a
  predicted lesson in F7.27's checkpoint: these ARE this package's own
  legitimate exports (the term `widget-iframe`'s package-boundary test
  needed a word-boundary regex to avoid false-positiving on). This
  package's denylist test forbids the four OTHER adapters' terms while
  deliberately not self-forbidding — the mirror image of the
  `widget-iframe` situation, confirmed exactly as predicted.
- Zero Prisma references, zero secret-shaped field names, zero
  credential-looking strings anywhere in `dist/`.

**Known limitation, re-confirmed a sixth time.** Same transitive closure
sprawl as every prior package: `dist/` mirrors
`lib/decision-os/behavioral/api/contracts.d.ts` (via `sdk-runtime/core`/
`sdk-runtime/react`), plus the full `sdk-runtime/core/src/*` and
`sdk-runtime/react/src/*` trees. Content-safety re-verified here exactly
as every prior checkpoint did — this is the LAST package that will need
this individual re-confirmation; the bundler follow-up (queued since
F7.25) should close it for all six packages at once.

## Step 4 — Package boundary tests

`__tests__/sdk-runtime/js-embed/package-boundary.test.ts` — **16 new
tests**, all green. Does not duplicate the pre-existing
`__tests__/sdk-runtime/js-embed/import-boundary.test.ts` (Phase 7.17,
source-level, unmodified, still passing). Covers: package.json shape
(private, sideEffects, single-entry export map, react/react-dom as REAL
dependencies with no peerDependencies block, version match against root
`package.json`, no other-adapter dependency, correct name), build config
(new file, existing config untouched and still `noEmit: true`, agreement
on jsx/lib), and six build-output checks (entry point present, zero
`.js`, export spot-check, zero iframe/web-component cross-contamination
— with the self-export exception documented above, zero Prisma/secret
leakage, the known transitive-mirror finding re-confirmed).

## Step 5 — Validation

- **Local build**: `npx tsc -p sdk-runtime/js-embed/tsconfig.build.json` — clean.
- **Scoped typecheck**: `npm run typecheck` inside `sdk-runtime/js-embed/` — clean, unchanged from before this ticket.
- **Package-boundary tests**: 16/16 green (new this ticket).
- **Full `sdk-runtime/js-embed` test directory**: 6 files, 86 tests green (existing runtime tests + new package-boundary suite; zero regressions).
- **Targeted regression proof**: all sdk-runtime test directories (core, react, iframe, web-component, js-embed) + the G24 League Pulse test together — **835 tests GREEN** across 53 files (up from 819 at the end of F7.27 — the 16 new tests account for the delta exactly).
- **Sibling package typechecks** (`widget-core`, `widget-react`, `widget-iframe`'s 4 chained configs, `widget-web-component`): all clean, confirming this ticket didn't disturb any of them.
- **Main app typecheck**: same 3 pre-existing, unrelated `LeagueShell.tsx` parse errors seen in every Phase 7 checkpoint this whole series; untouched by this ticket.
- **Unrelated repository state**: as in F7.26/F7.27, this branch continues to carry a large amount of unrelated, already-in-progress work outside this ticket's scope. None of it was touched, staged, or committed here — isolated exactly as done in the two prior packaging slices.

## Browser proof

Same reasoning as F7.26/F7.27: type-only packaging slice
(`emitDeclarationOnly: true`), zero JavaScript emitted, zero new UI or
runtime surface. The actual `AllFantasy.createWidget(...)` runtime
behavior (container validation, config assembly, React render via
`sdk-runtime/react`, global namespace attachment) is already covered by
the pre-existing jsdom-based `createWidget.test.tsx`/
`containerValidation.test.ts`/`namespace.test.ts`, unmodified and still
green. Not performed — same judgment call as the two prior slices.

## Lessons for final SDK packaging verification (F7.29)

1. **All six packages now exist** with a consistent, validated shape:
   `sdk-contracts`, `widget-core` (no React), `widget-react` (React
   peer), `widget-iframe` (4 subpaths, React peer only on
   `./react-child`), `widget-web-component` (React dependency, single
   entry), `widget-js` (React dependency, single entry). The
   peer-vs-dependency split exactly matches ADR D6 in all four
   React-touching packages.
2. **The `sdk-runtime/core`/`sdk-runtime/react` mirror-into-dist gap now
   has FIVE confirmations** (widget-react, widget-iframe's react-child,
   widget-web-component, widget-js — four different entry angles). F7.29
   or a dedicated follow-up should either (a) add a real bundler (tsup,
   queued since F7.25) that declares real `@allfantasy/widget-core`/
   `@allfantasy/widget-react` dependencies and eliminates the mirroring,
   or (b) explicitly accept the current declaration-only shape as the
   long-term design and stop re-flagging it — a decision, not another
   re-confirmation, is the right next step.
3. **Final packaging verification should be a cross-package suite**, not
   six more individual package-boundary files: e.g. one test asserting
   all six `package.json` names/versions/private flags are consistent,
   one asserting the six packages' declared (or intentionally
   undeclared) dependency edges collectively match the ADR's dependency
   graph diagram, one confirming zero package accidentally declares a
   dependency on a package that doesn't exist.
4. **`createAllFantasyWidget`/`attachAllFantasyGlobal` naming collision
   is now fully documented from both sides** (widget-iframe's
   word-boundary regex avoiding a false positive on its own
   `createAllFantasyWidgetHost`/`createAllFantasyWidgetIframeClient`;
   widget-js's deliberate non-self-forbidding of its own factory name).
   Worth keeping as a standing note if any future adapter ever needs a
   name close to either.

## Next steps (not built in this ticket)

1. **F7.29 — final SDK packaging verification** (the ADR's last
   checklist item) — a cross-package suite per lesson 3 above, now that
   all six packages are scaffolded.
2. A real bundler (tsup) across all six packages — closes the
   `sdk-runtime/core`/`sdk-runtime/react` undeclared-dependency gap and
   the `behavioral/api/contracts.d.ts` mirror uniformly (or F7.29
   explicitly defers this — see lesson 2).
