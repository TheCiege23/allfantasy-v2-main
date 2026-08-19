# Phase 7.22 — SDK Packaging Plan

Companion to `PHASE_7_22_SDK_PACKAGING_ADR.md` (read that first for the
"why"). This document is the "what": the package boundary matrix, the
full export map, versioning/semver rules, browser/build targets, security
constraints, and the checklists a future implementation ticket executes
against. **Nothing in this document has been built** — every export list
below reflects the CURRENT, already-shipped `src/` barrels, verified
against the actual source during a research pass immediately before
writing this plan.

## 1. Package boundary matrix

| Package | Source | `@allfantasy` deps | React peer/bundled | DOM required | Target | Subpath exports |
|---|---|---|---|---|---|---|
| `@allfantasy/sdk-contracts` | `lib/decision-os/sdk/` | none | no | no | ES2020 | none |
| `@allfantasy/widget-core` | `sdk-runtime/core/` | `sdk-contracts` | no | no | ES2020 | none |
| `@allfantasy/widget-react` | `sdk-runtime/react/` | `sdk-contracts`, `widget-core` | **peer** (`react`, `react-dom` ^18) | yes | ES2020 | none |
| `@allfantasy/widget-iframe` | `sdk-runtime/iframe/` | `sdk-contracts` (base); `widget-react` (react-child subpath only) | none (base); peer, transitively, via react-child | partial* | ES2020 | `.`, `./browser`, `./facade`, `./react-child` |
| `@allfantasy/widget-web-component` | `sdk-runtime/web-component/` | `sdk-contracts`, `widget-core`, `widget-react` | **bundled** (`react`, `react-dom`) | yes | ES2020 | none |
| `@allfantasy/widget-js` | `sdk-runtime/js-embed/` | `sdk-contracts`, `widget-core`, `widget-react` | **bundled** (`react`, `react-dom`) | yes | ES2020 | none |

\* `widget-iframe`'s main entry (protocol) and `./browser`/`./facade`
subpaths need DOM (the browser bridge, `<iframe>` mounting); the base
protocol contract types (message shapes, origin/sandbox validators) do
not — this is why `sdk-runtime/iframe/src/index.ts` itself has no `"dom"`
lib entry today even though `browser/`/`facade/` do. The published package
still needs a DOM-capable build target overall since two of its four
entry points require it.

## 2. Export map proposal

Every export below is copied from the CURRENT barrel file, verbatim (see
the ADR's Context section for the verification method). Nothing is added
or removed by this plan — packaging repackages exactly what already
exists.

### `@allfantasy/sdk-contracts` ← `lib/decision-os/sdk/index.ts`

Types: `SDKVersion`, `SDKSupportedLocale`, `SDKLocale`, `SDKThemeMode`,
`SDKThemeTokens`, `SDKTheme`, `SDKAuthMethod`, `SDKAuth`, `SDKEmbedTarget`,
`SDKEmbedCapabilities`, `SDKRefreshTrigger`, `SDKRefreshStrategyConfig`,
`SDKCapabilities`, `SDKLifecycleState`, `SDKConfig`, `SDKWidgetInstance`,
`SDKTelemetryEventType`, `SDKEvent`, `SDKTelemetry`, `SDKErrorCode`,
`SDKError`, `SDKCallbacks`, `SDKExtensionPoint`, `SDKLicenseTier`,
`SDKEnterpriseExtension`, `PartnerStatus`, `PartnerProfile`,
`PartnerAllowedOrigins`, `PartnerApiKeyEnvironment`, `PartnerApiKeyStatus`,
`PartnerApiKeyMetadata`, `PartnerEmbedPermissions`,
`PartnerPrivacyPreferences`, `PartnerBrandingConfig`, `PartnerTenantConfig`,
`SDKAuthValidationResult`, `EventSequenceValidationResult`,
`RefreshValidationResult`, `SDKConfigValidationResult`,
`PartnerValidationResult`, `PartnerThemeNormalizationResult`.

Values: `SDK_VERSION`, `LIFECYCLE_TRANSITIONS`, `ALL_LIFECYCLE_STATES`,
`TERMINAL_LIFECYCLE_STATES`, `isValidLifecycleTransition`,
`nextLifecycleStates`, `isTerminalLifecycleState`,
`validateLifecycleSequence`, `VALID_THEME_MODES`, `resolveSDKTheme`,
`validateSDKTheme`, `AUTH_METHOD_REQUIREMENTS`, `ALL_AUTH_METHODS`,
`validateSDKAuth`, `isPublicAuthMethod`, `EMBED_CAPABILITIES`,
`ALL_EMBED_TARGETS`, `getEmbedCapabilities`, `isFullyIsolatedEmbed`,
`ALL_SDK_EVENT_TYPES`, `obfuscateTenantIdForTelemetry`, `buildSDKEvent`,
`validateEventSequence`, `SDK_ERROR_SPECS`, `ALL_SDK_ERROR_CODES`,
`buildSDKError`, `isRetryableErrorCode`, `REFRESH_DEFAULTS`,
`ALL_REFRESH_TRIGGERS`, `resolveRefreshStrategy`, `validateRefreshStrategy`,
`INTERNAL_FIELD_DENYLIST`, `INTERNAL_TERMINOLOGY_DENYLIST`,
`stripInternalFields`, `findInternalLeakage`, `hasInternalLeakage`,
`validateSDKConfig`, `EXTENSION_POINT_MIN_TIER`, `isExtensionPointAllowed`,
`buildEnterpriseExtension`, `PARTNER_ONBOARDING_VERSION`,
`ALL_PARTNER_STATUSES`, `ALL_LICENSE_TIERS`, `isValidPartnerOriginFormat`,
`isValidApiKeyPrefixFormat`, `validatePartnerProfile`,
`validateApiKeyMetadata`, `validatePartnerTenantConfig`,
`WIDGET_MODE_MIN_TIER`, `isWidgetModeAllowedForTier`,
`isWidgetModeAllowedForPartner`, `isEmbedTargetAllowedForPartner`,
`resolveDefaultWidgetCatalog`, `RATE_LIMIT_PER_MINUTE_BY_TIER`,
`resolveRateLimitPerMinute`, `resolveEffectivePartnerPrivacySettings`,
`normalizePartnerBranding`, `SANDBOX_PARTNER_TENANT_CONFIG`,
`ENTERPRISE_PARTNER_TENANT_CONFIG`.

**Not published**: `lib/decision-os/sdk/partner-sandbox-handlers.ts`
(Phase 7.20) and the `app/api/v1/sandbox/partner/*` route files are
SERVER-SIDE application code, not SDK contracts — they are never part of
any package's export surface, published or otherwise. Also not published:
anything under `lib/decision-os/behavioral/*` or `lib/decision-os/world/*`
(never imported by any `sdk-runtime` package, and the import-boundary
tests already prove this).

### `@allfantasy/widget-core` ← `sdk-runtime/core/src/index.ts`

Types: `RuntimeFetchRequestInit`, `RuntimeFetchResponse`, `RuntimeFetch`,
`HttpClientConfig`, `PresentationMetaWire`, `PresentationDataWire`,
`PresentationEnvelopeWire`, `PresentationFetchSuccess`,
`PresentationFetchFailure`, `PresentationFetchResult`, `ExpectedEntity`,
`AuthPreCheckSuccess`, `AuthPreCheckFailure`, `AuthPreCheckResult`,
`RuntimeTimerHandle`, `RuntimeClock`, `HttpFailureReason`,
`RefreshAttemptInfo`, `RefreshOutcome`, `RefreshResultListener`,
`RefreshStrategyOverrides`, `RefreshEngineDeps`.

Values: `buildQueryString`, `buildRequestUrl`, `buildRequestHeaders`,
`fetchPresentation`, `authPreCheck`, `LifecycleController`,
`InvalidLifecycleTransitionError`, `classifyHttpStatus`,
`classifyFailureReason`, `mapHttpFailureToSDKError`, `RefreshEngine`,
`computeBackoffDelayMs`.

### `@allfantasy/widget-react` ← `sdk-runtime/react/src/index.ts`

Types: `WidgetPresentationData`, `WidgetRenderState`,
`UseAllFantasyWidgetOptions`, `UseAllFantasyWidgetResult`,
`InitialLoadDeps`, `InitialLoadResult`, `WidgetHeadline`,
`WidgetChromeHex`, `AllFantasyWidgetProps`, `WidgetRenderBoundaryProps`.

Values: `mapLifecycleToRenderState`, `runInitialLoad`, `extractHeadline`,
`DEFAULT_COLOR_HEX`, `DEFAULT_COLOR_HEX_DARK`, `DEFAULT_COLOR_HEX_LIGHT`,
`resolveColorTokenHex`, `resolveThemedColorTokenHex`,
`resolveWidgetChromeHex`, `useAllFantasyWidget`, `WidgetRenderBoundary`,
`AllFantasyWidget`.

### `@allfantasy/widget-iframe` — four entry points

**`.`** ← `sdk-runtime/iframe/src/index.ts` (protocol; no DOM, no React)

Types: `IframeEmbedConfig`, `MessageDirection`,
`ParentToChildMessageType`, `IframeInitPayload`,
`IframeVisibilityChangePayload`, `IframeThemeUpdatePayload`,
`IframeRefreshRequestPayload`, `IframeDisposePayload`,
`ParentToChildPayloadMap`, `ParentToChildMessage`,
`ChildToParentMessageType`, `IframeLifecycleState`, `IframeReadyPayload`,
`IframeLifecycleChangePayload`, `IframeDegradedPayload`,
`IframeErrorPayload`, `IframeInteractionPayload`, `IframeResizePayload`,
`ChildToParentPayloadMap`, `ChildToParentMessage`, `IframeMessage`,
`MessageValidationResult`, `IframeEmbedConfigValidationResult`,
`OriginValidationResult`, `SandboxValidationResult`,
`MessageRejectionReason`, `MessageListenerConfig`, `IframeHostDeps`,
`IframeClientDeps`, `MessageEventLike`, `WindowMessageListener`,
`WindowLike`, `IframeWidgetUrlParams`, `BuildIframeWidgetUrlOptions`,
`ParseIframeWidgetUrlParamsResult`.

Values: `IFRAME_PROTOCOL_VERSION`, `validateIframeEmbedConfig`,
`PARENT_TO_CHILD_MESSAGE_TYPES`, `CHILD_TO_PARENT_MESSAGE_TYPES`,
`isValidNonceFormat`, `buildInitPayloadFromSdkConfig`,
`buildParentToChildMessage`, `buildChildToParentMessage`,
`validateParentToChildMessage`, `validateChildToParentMessage`,
`isValidOriginFormat`, `validateOriginFormat`, `isOriginAllowed`,
`assertExplicitTargetOrigin`, `IFRAME_SANDBOX_TOKENS`,
`IFRAME_SANDBOX_ATTRIBUTE`, `IFRAME_FORBIDDEN_SANDBOX_PAIR`,
`containsForbiddenSandboxCombination`, `validateSandboxTokens`,
`buildCspFrameAncestors`, `mapLifecycleToIframeState`,
`mapErrorToIframePayload`, `safePostMessage`, `createMessageListener`,
`createParentWindowListener`, `createChildWindowListener`,
`IframeHostBootstrap`, `IframeClientBootstrap`, `URL_HANDSHAKE_PARAM_NAMES`,
`isValidWidgetIdFormat`, `buildIframeWidgetUrl`,
`parseIframeWidgetUrlParams`.

**`./browser`** ← `sdk-runtime/iframe/src/browser/index.ts`

Types: `BrowserWindowSource`, `IframeElementSource`, `RandomSource`,
`DocumentSource`, `MountIframeWidgetOptions`, `MountedIframeWidget`,
`RemovableElement`.

Values: `createBrowserWindowBridge`, `createIframeContentWindowBridge`,
`generateNonce`, `mountIframeWidget`, `teardownIframeWidget`.

**`./facade`** ← `sdk-runtime/iframe/src/facade/index.ts`

Types: `AllFantasyWidgetHostCallbacks`, `AllFantasyWidgetHostConfig`,
`AllFantasyWidgetHost`, `AllFantasyWidgetIframeClientCallbacks`,
`AllFantasyWidgetIframeClientConfig`, `AllFantasyWidgetIframeClient`,
`AllFantasyWidgetIframeClientFromUrlConfig`.

Values: `createAllFantasyWidgetHost`, `createAllFantasyWidgetIframeClient`,
`createAllFantasyWidgetIframeClientFromUrl`.

**`./react-child`** ← `sdk-runtime/iframe/src/reactChild/index.ts`

Types: `ReactIframeChildBridgeConfig`, `MountedReactIframeChildBridge`.

Values: `mountReactIframeChildBridge`.

### `@allfantasy/widget-web-component` ← `sdk-runtime/web-component/src/index.ts`

Types: `ParsedElementAttributes`, `ParseElementAttributesResult`,
`AttributeGetter`, `WidgetShadowMode`, `ElementConfigValidationResult`,
`ElementCredentials`.

Values: `AllFantasyWidgetElement`, `defineAllFantasyWidgetElement`,
`DEFAULT_TAG_NAME`, `ELEMENT_ATTRIBUTE_NAMES`, `OBSERVED_ATTRIBUTES`,
`parseElementAttributes`, `buildWidgetConfigFromAttributes`,
`validateElementConfig`, `attachShadowMountRoot`, `mountShadowContainer`,
`unmountShadowContainer`, `setElementCredentials`,
`getElementCredentials`, `clearElementCredentials`, `defaultFetchImpl`,
`defaultClock`.

**Private internal (never exported, stays that way)**: the module-private
`WeakMap` inside `credentials.ts` itself — only the three accessor
functions above are public. This is already the exact shape a published
`.d.ts` would produce with zero changes.

### `@allfantasy/widget-js` ← `sdk-runtime/js-embed/src/index.ts`

Types: `JsEmbedTenantConfig`, `JsEmbedWidgetConfig`, `CreateWidgetOptions`,
`CreateWidgetLifecycleCallbacks`, `AllFantasyWidgetInstance`,
`ValidateCreateWidgetInputsResult`, `ContainerValidationResult`.

Values: `createAllFantasyWidget`, `AllFantasy`, `attachAllFantasyGlobal`,
`SDK_JS_EMBED_VERSION`, `validateContainer`,
`buildWidgetConfigWithCredential`, `validateCreateWidgetInputs`,
`defaultFetchImpl`, `defaultClock`.

**Private internal**: the module-private container-tracking `WeakSet` in
`containerValidation.ts` — same pattern as web-component's credential
WeakMap, never exported.

## 3. Versioning strategy

All six packages start at **`0.1.0`** (pre-1.0) when first packaged —
`0.x` signals "API may still shift" honestly, since none of the six has
ever been consumed outside this repository yet. **`1.0.0` is reserved for
the first package that has actually been used successfully in a real
partner sandbox integration** (Phase 7.21's future runnable-environment
follow-up), not merely "code exists and is tested" — internal test
coverage and external validation are different bars.

Independent versioning per package (ADR D8) — no lockstep release train.
`sdk-contracts` is expected to release LEAST often (it is the frozen
contract layer); the three composition packages
(`widget-web-component`/`widget-js`/`widget-iframe`'s `react-child`
subpath) are expected to release most often as new widget modes/embed
targets are added.

## 4. Semantic versioning rules

| Change | Bump |
|---|---|
| Remove or rename any export listed in §2 | **MAJOR** |
| Change a function's parameter types/order incompatibly | **MAJOR** |
| Raise a peerDependency's minimum version (e.g. require React 19) | **MAJOR** |
| Add a new export | **MINOR** |
| Add a new optional field to an existing config/options type | **MINOR** |
| Add a new subpath export | **MINOR** |
| Bug fix with no export-surface change | **PATCH** |
| Internal refactor, no export-surface change, no behavior change | **PATCH** |
| `sdk-contracts` MAJOR bump | Every dependent widget-* package's `sdk-contracts` dependency range MUST be re-validated before its own next release (does not force an immediate release, but blocks claiming compatibility) |

## 5. Browser compatibility

**ES2020** across every package — chosen because it is what EVERY
`sdk-runtime/*` tsconfig already targets today (see the ADR's Context),
and the app itself (`next.config.js`) has no legacy-browser transpilation
config, meaning the wider AllFantasy product already assumes the same
floor. Concretely: Chrome 80+, Firefox 74+, Safari 13.1+, Edge 80+ (all
released before mid-2020). No IE11, no ES5 fallback, no core-js polyfills
shipped. Recommended `package.json` `browserslist` entry for all six
packages, kept identical across the set for consistency:

```json
"browserslist": ["chrome >= 80", "firefox >= 74", "safari >= 13.1", "edge >= 80"]
```

`widget-web-component` additionally requires native Custom Elements v1 +
closed Shadow DOM support — already covered by the same browser floor
above (both shipped well before Chrome 80/Safari 13.1).

## 6. Build targets / ESM-CJS strategy (detail on ADR D7)

| Package | ESM | CJS | UMD |
|---|---|---|---|
| `sdk-contracts` | ✅ primary | ✅ | — |
| `widget-core` | ✅ primary | ✅ | — |
| `widget-react` | ✅ primary | ✅ | — |
| `widget-iframe` (all 4 entries) | ✅ primary | ✅ | — |
| `widget-web-component` | ✅ primary | ✅ | — |
| `widget-js` | ✅ primary | ✅ | ✅ (`dist/allfantasy-widget.umd.js`, exposes `window.AllFantasy`) |

`package.json` `"exports"` conditional map (illustrative, applies to every
package except `widget-iframe`'s multi-entry shape from ADR D4):

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs"
    }
  },
  "sideEffects": false
}
```

## 7. Tree-shaking expectations

Every package ships `"sideEffects": false` (ADR D5) — a bundler consuming
e.g. `@allfantasy/sdk-contracts` for only `validateSDKTheme` can drop the
partner-onboarding exports entirely; a consumer of `@allfantasy/
widget-iframe` who never imports `./react-child` never pulls React into
their bundle at all, even transitively, because it is a genuinely separate
entry point, not a conditionally-executed branch inside one bundle.

## 8. Peer dependencies (detail on ADR D6)

| Package | Peer deps | Bundled deps |
|---|---|---|
| `sdk-contracts` | none | none |
| `widget-core` | none | `sdk-contracts` |
| `widget-react` | `react ^18.0.0`, `react-dom ^18.0.0` | `sdk-contracts`, `widget-core` |
| `widget-iframe` (base + browser + facade) | none | `sdk-contracts` |
| `widget-iframe/react-child` | `react ^18.0.0`, `react-dom ^18.0.0` | `sdk-contracts`, `widget-core`, `widget-react` |
| `widget-web-component` | none | `sdk-contracts`, `widget-core`, `widget-react`, `react`, `react-dom` |
| `widget-js` | none | `sdk-contracts`, `widget-core`, `widget-react`, `react`, `react-dom` |

TypeScript peer: all six list `typescript ^5.0.0` as an optional
peerDependency (types-only consumers on TS 4.x may still work but are
unsupported) — matches the `5.6.3` currently installed.

## 9. Security constraints

- **No secret ever ships.** Every "no credential leakage" test suite
  already written across Phases 7.4/7.15–7.21 stays authoritative;
  packaging adds ONE new check on top: a prepublish scan of the BUILT
  `dist/` output (not just `src/`) for the same secret-shaped-field and
  internal-terminology denylists `hasInternalLeakage`/
  `findInternalLeakage` already define — bundlers can sometimes inline
  unexpected strings (e.g. source file paths in sourcemaps), so the
  source-level guarantee needs a build-level re-check.
- **Sourcemaps ship separately, never inlined**, and are stripped of
  absolute local file-system paths (a bundler config concern, not a code
  change) — an inlined sourcemap with `F:\allfantasy-v2-main\...` paths
  is not itself a credential leak but is an unnecessary internal-layout
  disclosure.
- **`widget-iframe`'s sandbox/postMessage safety invariants must survive
  minification.** `IFRAME_SANDBOX_ATTRIBUTE`,
  `containsForbiddenSandboxCombination`, and `assertExplicitTargetOrigin`
  (never allow `'*'` as a target origin) are the concrete guarantees a
  minifier must not be able to accidentally alter — the prepublish test
  matrix (§11) runs the EXISTING behavioral test suite against the BUILT
  package, not just against `src/`, specifically to catch this class of
  regression.
- **No new attack surface from bundling.** `widget-web-component`/
  `widget-js` bundling React (D6) does not change the credential-handling
  guarantees already proven in Phases 7.16/7.17 (WeakMap-based / closure-
  based credential storage) — bundling changes WHERE the code lives, not
  what it does with a credential.
- **No provider-specific logic ships in any package** — already a tested
  invariant (Phases 7.16–7.20's import-boundary and "no provider-specific
  branches" test suites); packaging does not relax it.

## 10. Publish checklist (for the future implementation ticket — NOT executed here)

1. Confirm the package's full vitest suite is green (scoped to that
   package's `__tests__/sdk-runtime/<name>` directory).
2. Confirm the package's scoped `tsc --noEmit` typecheck is clean.
3. Confirm the package's import-boundary test still passes (no new
   forbidden import introduced by the build config itself, e.g. no
   accidental bundler shim pulling in a Node-only API).
4. Run the build (ESM + CJS + UMD where applicable).
5. Run `npm pack --dry-run`; inspect the file list — confirm no `.env`,
   no test fixture with a real-looking secret, no `.map` file with an
   absolute local path, matches the export map in §2 exactly (nothing
   extra, nothing missing).
6. Run the prepublish `dist/`-level leak scan (§9).
7. Bump the version per §4's rules; update the package's own CHANGELOG.
8. Confirm peer dependency ranges (§8) are satisfied by the versions
   declared, not just aspirationally documented.
9. Tag the release in git.
10. **STOP — do not run `npm publish` without an explicit, separate,
    human-approved go-ahead.** This checklist prepares a release
    candidate; it does not authorize shipping it.

## 11. Prepublish test matrix

| Axis | Values to verify against |
|---|---|
| Node.js runtime | 18 LTS, 20 LTS, 22 LTS (import + require both work) |
| Module system | Native ESM `import`, CJS `require`, and (widget-js only) a bare `<script>` tag loading the UMD bundle |
| Browser (widget-web-component, widget-js UMD only) | A real browser smoke test (Playwright) confirming the custom element registers and `window.AllFantasy` is defined, respectively |
| Bundler | At minimum one real consumer build via Vite and one via webpack, confirming tree-shaking actually drops unused exports (verify via bundle-size diff, not just "it built") |
| TypeScript consumer | A `.d.ts`-only smoke import in a separate TS project, confirming every type in §2 resolves with no `any` fallback |
| React version | `widget-react`/`widget-iframe/react-child`/`widget-web-component`/`widget-js` against both React 18.2 (older 18.x) and 18.3.1 (current) to confirm the peer range in §8 is honest |

## 12. Recommended first package to prepare

**`@allfantasy/sdk-contracts`**, then **`@allfantasy/widget-core`**, in
that order.

Rationale: `sdk-contracts` has zero `@allfantasy` dependencies (nothing to
sequence around), zero DOM, zero React, zero build complexity beyond a
straightforward ESM+CJS TypeScript build — the lowest-risk, fastest path
to a real, installable first package. It is also the package every other
one depends on (ADR D2), so packaging it first is the only order that
lets `widget-core` (next) actually declare a real npm dependency instead
of a source-relative import during ITS OWN packaging. `widget-core` is the
natural #2 for the identical reason one level up: no DOM, no React, and
it unblocks `widget-react`, which unblocks everything else.

`widget-iframe`'s base protocol layer (no React, no `widget-core`
dependency per ADR D3) is a plausible alternate #2 if iframe embedding is
the higher near-term product priority than the React adapter — both are
equally low-risk from a packaging-complexity standpoint; the choice
between them is a product-priority call, not an architecture one.
