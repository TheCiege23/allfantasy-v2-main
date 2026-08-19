# Phase 7.23 — @allfantasy/sdk-contracts Package Preparation Checkpoint

Status: **SCAFFOLDING COMPLETE, LOCALLY BUILT AND VERIFIED — 2026-07-01**.
Implements the first package from `PHASE_7_22_SDK_PACKAGING_ADR.md`'s
recommended order (§12 of the packaging plan: "sdk-contracts, then
widget-core"). No publish, no external service writes, no runtime behavior
change to any existing file.

## What was built

```
sdk-runtime/sdk-contracts/
├── package.json     — private:true (the technical guardrail — see §3), 0.1.0
├── tsconfig.json     — ES2020, declaration-only, no rootDir (see §2)
└── src/
    └── index.ts       — the curated re-export barrel (the only new logic)
```

Plus `__tests__/sdk-runtime/sdk-contracts/import-boundary.test.ts` (22
tests) and this checkpoint. **Zero existing files changed** except one
additive export (`ALL_LICENSE_TIERS`, already added in Phase 7.20) — this
ticket does not touch it further.

## 1. Export curation (the actual design work)

`src/index.ts` re-exports from two source trees, both left exactly where
the Architecture Freeze already governs them (ADR D1 — no source
relocation):

- **`lib/decision-os/sdk/*` — full re-export**, types and values,
  identical to `PHASE_7_22_SDK_PACKAGING_PLAN.md` §2's already-specified
  list. Nothing new decided here.
- **`lib/decision-os/presentation/*` — curated, TYPE-ONLY except for
  the Phase 7.3 widget-contract operational functions.** This is the
  ticket's actual scope expansion beyond F7.22 (which never covered
  `presentation/` at all). Included: every graph/card/badge/
  recommendation/widget/API-presentation TYPE (what a partner's
  TypeScript code needs to type a `/api/v1/intelligence/*` response body)
  plus `validateWidgetConfig`/`mapWidgetModeToApiCall`/
  `resolveAllowedSections`/`filterSectionsByTier`/
  `resolveWidgetLayoutHints`/`resolveWidgetPrivacyRestrictions`/
  `buildWidgetDegradedState`/`buildWidgetTelemetryEvent` (already called
  client-side by `sdk-runtime/react` etc. — a partner building a custom
  integration needs them too). **Deliberately excluded**, by rule, not
  oversight (full rationale in `src/index.ts`'s own header comment):
  - `IpmEngagementDimension`/`IpmManagerInput`/`IpmLeagueInput`/
    `IpmPlatformInput`/`IpmCompanyInput` — the presentation layer's own
    doc comment calls these "7.0-local structural mirrors" of Phase 6
    behavioral intelligence; the closest thing to raw Phase 5/6
    intelligence inside `presentation/` at all.
  - Every `build*` assembler function (badges/graphs/cards/
    recommendations/widgets/api-presentation) and the token-resolution
    value layer — server-side-only assembly logic; a partner only ever
    RECEIVES an already-built object, never constructs one.
  - `WHITE_LABEL_CONFIGS`/`resolveColorToken`/`resolveIconToken`/
    `getWhiteLabelConfig`/`isSectionVisible` — hardcodes real platform
    names (`sleeper`, `yahoo`, `espn`, …) as config keys, forbidden by
    "no provider-specific logic." The `WhiteLabelConfig` TYPE itself
    (a generic shape, no baked-in names) IS included.
- **`sdk-runtime/*` shared types are explicitly NOT re-exported** —
  every `sdk-runtime/*` package DEPENDS ON `sdk-contracts` (ADR D2);
  pulling `sdk-runtime` types back in would invert that graph. The ticket
  asked for this "if approved by F7.22" — F7.22 never proposed it, so
  it is declined here explicitly, not merely omitted.

## 2. A real finding from the build: `emitDeclarationOnly`, and why

**"Type-only package if possible" (the ticket's own requirement) turned
out to be load-bearing, not just a style preference.** A first attempt at
a normal `tsc` build (declaration + `.js` output) revealed that
TypeScript's declaration emission includes the FULL transitive closure of
every type-referenced file — not just what `src/index.ts` re-exports.
Concretely: `lib/decision-os/sdk/auth.ts` and `partner-types.ts` import
`IntelligenceApiScope` from `lib/decision-os/behavioral/api/contracts.ts`
(a Phase 5.5-designed, ALREADY-curated "external contract" file — its own
header: "these are the EXTERNAL types for the hosted Intelligence API…
deliberately do NOT re-export internal types" — content-verified safe, no
internal terminology, no PII, no secrets, confirmed by this ticket's own
`dist/`-level leak-scan tests). But its canonical path is under
`lib/decision-os/behavioral/`, and a plain `tsc` build without a bundler
happily emitted a compiled copy of it at
`dist/lib/decision-os/behavioral/api/contracts.js` — a file living under a
`behavioral/` path in a published-package artifact, regardless of whether
its CONTENT was safe.

**Fix applied**: `tsconfig.json` sets `"emitDeclarationOnly": true` — zero
`.js` is emitted anywhere, by ANY file, eliminating this entire class of
concern (there is no compiled runtime code, safe or otherwise, from any
internal file). Verified as a real, testable property: one of the 22
import-boundary tests asserts `dist/` contains exactly zero `.js` files.

**Known, accepted limitation this creates**: `lib/decision-os/sdk`'s VALUE
exports (`validateSDKAuth`, `resolveSDKTheme`, `buildSDKError`, …) are
type-visible from this package but **not runtime-callable yet** — there is
no `.js` to import. This package is a genuine type-only artifact right
now, not yet the "types + pure functions" package
`PHASE_7_22_SDK_PACKAGING_PLAN.md` §2 ultimately wants. **Closing this gap
requires a real bundler** (tsup/rollup, per the ADR's own D7) that INLINES
`lib/decision-os/sdk`'s compiled logic directly into a single
`dist/index.js`, rather than leaving `tsc`'s raw per-file mirrored-path
emission (which is what created the `behavioral/`-path problem above in
the first place — a bundler solves BOTH the path-sprawl hygiene issue and
the callable-values gap in one step). Tracked as the next packaging
ticket's first requirement.

## 3. `rootDir` and the resulting nested dist path

Setting `rootDir: "./src"` (the natural choice) crashes `tsc` with
`TS6059` the moment declaration emission needs to reference a file outside
`src/` (which is every file this package re-exports from — `lib/decision-os/sdk`
and `lib/decision-os/presentation` both live well outside `sdk-runtime/sdk-contracts/src/`).
Removing `rootDir` lets TypeScript compute it automatically as the nearest
common ancestor of the whole transitive closure — the repo root — so this
package's own entry point currently lands at the (ugly but correct)
nested path `dist/sdk-runtime/sdk-contracts/src/index.d.ts`, and
`package.json`'s `"types"`/`"exports"` fields point there honestly rather
than lying about a clean top-level `dist/index.d.ts` that doesn't exist.
This resolves to the same bundler-shaped fix as §2 — a real bundler would
also flatten this to a clean top-level path.

## 4. Publish safety — the technical guardrail

`package.json` sets `"private": true`. This is not just documentation: npm's
`publish` command itself refuses to run against a `private: true` package,
regardless of who runs the command or what credentials they have — the
strongest available local guarantee that this ticket's "no npm publish"
rule cannot be accidentally violated, verified by one of the 22 tests
reading `package.json` and asserting `private === true`.

## 5. Verification results

- **Local build**: `npx tsc -p sdk-runtime/sdk-contracts/tsconfig.json` —
  clean, zero errors, zero warnings.
- **Scoped typecheck**: `npx tsc --noEmit -p sdk-runtime/sdk-contracts/tsconfig.json` — clean.
- **Import-boundary tests**: `__tests__/sdk-runtime/sdk-contracts/import-boundary.test.ts` —
  **22/22 GREEN**. Covers: source-level import allowlist (only the two
  approved trees) with a positive control; zero `sdk-runtime/*` imports
  (would invert the dependency graph); zero `behavioral`/`world`/Prisma
  references; zero excluded-name mentions in actual export statements
  (Ipm*Input, build* assemblers, white-label values, token-resolution
  values); zero known real-platform-name mentions outside comments; zero
  internal-terminology leakage (with a positive control); and, once
  `dist/` exists, six build-output checks (entry point exists, zero `.js`
  anywhere, spot-checked expected exports present, zero excluded names in
  the actual public `index.d.ts`, zero Prisma/provider-name/secret-shaped
  content anywhere in the whole `dist/` tree, `private:true` confirmed).
- **Full regression**: `__tests__/decision-os` + `__tests__/sdk-runtime` —
  **3084 tests GREEN** (3062 + 22 new, zero regressions; this ticket
  changed zero existing runtime behavior).
- **All 9 sdk-runtime scoped typechecks** (core, react, iframe
  main/browser/facade/reactChild, web-component, js-embed,
  **sdk-contracts**) — clean.
- **Main app typecheck** — stable (same 3 pre-existing unrelated
  `LeagueShell.tsx` errors, untouched).

## 6. Two debugging lessons this ticket re-confirms

Both already documented in earlier phases' memory, both bit this ticket's
own test suite during writing, worth restating because they recurred:

1. **`hasInternalLeakage`/provider-name/Prisma checks need comment-stripped
   input.** A file's own "Decision OS — Phase X…" header, or a doc comment
   like "never a Prisma model," legitimately CONTAINS the denylisted term
   as documentation, not a leak. Every text-scan check in the new test
   suite strips comments first.
2. **A file's own header comment documenting an EXCLUSION list will
   contain every excluded name as literal text** (this file has to NAME
   `IpmEngagementDimension` etc. to explain why it's absent) — declaration
   emission preserves that comment verbatim into `dist/index.d.ts`, so a
   naive "does the built output mention this name" check needs comment
   stripping too, or it false-positives on its own documentation.

## Next steps (not built in this ticket)

1. Add a real bundler (tsup, per the packaging ADR's own D7) to produce a
   flat, single-file `dist/index.js` + `dist/index.d.ts` — closes both the
   `behavioral/`-path sprawl (§2) and the callable-values gap (§2) in one
   change.
2. Once bundled, re-run this same 22-test suite against the new output
   shape (the tests are written to `skipIf(!distExists)` gracefully, but
   the nested-path assumptions in §3 will need updating).
3. Apply this exact pattern to `@allfantasy/widget-core` next, per the
   packaging plan's recommended order.
4. Actual `npm publish` remains explicitly out of scope until a human
   reviews the built artifact and removes `"private": true` deliberately.
