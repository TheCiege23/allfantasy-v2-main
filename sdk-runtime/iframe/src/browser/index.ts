/**
 * Decision OS — Phase 7.11 Browser Iframe Adapter.
 *
 * All real browser access (`window`, `document`, `HTMLIFrameElement`, Web
 * Crypto) is isolated to this subfolder. It is a SEPARATE barrel — NOT
 * re-exported from `sdk-runtime/iframe/src/index.ts` — because that main
 * index is typechecked with no "dom" lib (sdk-runtime/iframe/tsconfig.json),
 * and re-exporting DOM-typed symbols through it would break that guarantee.
 * Consumers who need real browser wiring import from
 * `sdk-runtime/iframe/src/browser` directly; everything else keeps
 * importing the main index exactly as before.
 */

export type { BrowserWindowSource } from './windowBridge'
export { createBrowserWindowBridge } from './windowBridge'

export type { IframeElementSource } from './iframeElementAdapter'
export { createIframeContentWindowBridge } from './iframeElementAdapter'

export type { RandomSource } from './nonce'
export { generateNonce } from './nonce'

export type { DocumentSource, MountIframeWidgetOptions, MountedIframeWidget } from './mount'
export { mountIframeWidget } from './mount'

export type { RemovableElement } from './teardown'
export { teardownIframeWidget } from './teardown'
