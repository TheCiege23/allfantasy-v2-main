/**
 * Decision OS — Widget Runtime Iframe Adapter.
 *
 * A versioned postMessage contract (Phase 7.9) for embedding an AllFantasy
 * intelligence widget via iframe, plus the DOM-wiring runtime (Phase 7.10)
 * that uses it — host/client bootstraps, validated message listeners, and a
 * safe postMessage wrapper. No global `window`/`document` reference anywhere
 * in this package; every function/class takes an injected `WindowLike`.
 */

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  IframeEmbedConfig,
  MessageDirection,
  ParentToChildMessageType,
  IframeInitPayload,
  IframeVisibilityChangePayload,
  IframeThemeUpdatePayload,
  IframeRefreshRequestPayload,
  IframeDisposePayload,
  ParentToChildPayloadMap,
  ParentToChildMessage,
  ChildToParentMessageType,
  IframeLifecycleState,
  IframeReadyPayload,
  IframeLifecycleChangePayload,
  IframeDegradedPayload,
  IframeErrorPayload,
  IframeInteractionPayload,
  IframeResizePayload,
  ChildToParentPayloadMap,
  ChildToParentMessage,
  IframeMessage,
  MessageValidationResult,
} from './types'
export { IFRAME_PROTOCOL_VERSION } from './types'

// ── Config validation ─────────────────────────────────────────────────────────
export type { IframeEmbedConfigValidationResult } from './config'
export { validateIframeEmbedConfig } from './config'

// ── Protocol: builders + validators ───────────────────────────────────────────
export {
  PARENT_TO_CHILD_MESSAGE_TYPES,
  CHILD_TO_PARENT_MESSAGE_TYPES,
  isValidNonceFormat,
  buildInitPayloadFromSdkConfig,
  buildParentToChildMessage,
  buildChildToParentMessage,
  validateParentToChildMessage,
  validateChildToParentMessage,
} from './protocol'

// ── Origin validation ──────────────────────────────────────────────────────────
export type { OriginValidationResult } from './origin'
export {
  isValidOriginFormat,
  validateOriginFormat,
  isOriginAllowed,
  assertExplicitTargetOrigin,
} from './origin'

// ── Sandbox / CSP ──────────────────────────────────────────────────────────────
export type { SandboxValidationResult } from './security'
export {
  IFRAME_SANDBOX_TOKENS,
  IFRAME_SANDBOX_ATTRIBUTE,
  IFRAME_FORBIDDEN_SANDBOX_PAIR,
  containsForbiddenSandboxCombination,
  validateSandboxTokens,
  buildCspFrameAncestors,
} from './security'

// ── Lifecycle / error mapping ─────────────────────────────────────────────────
export { mapLifecycleToIframeState, mapErrorToIframePayload } from './lifecycleMapping'

// ── Window-like contracts (Phase 7.10) ────────────────────────────────────────
export type { MessageEventLike, WindowMessageListener, WindowLike } from './windowLike'

// ── Safe postMessage wrapper (Phase 7.10) ─────────────────────────────────────
export { safePostMessage } from './postMessageSafety'

// ── Validated message listeners (Phase 7.10) ──────────────────────────────────
export type { MessageRejectionReason, MessageListenerConfig } from './messageListener'
export { createMessageListener, createParentWindowListener, createChildWindowListener } from './messageListener'

// ── Host / client bootstraps (Phase 7.10) ─────────────────────────────────────
export type { IframeHostDeps } from './iframeHost'
export { IframeHostBootstrap } from './iframeHost'
export type { IframeClientDeps } from './iframeClient'
export { IframeClientBootstrap } from './iframeClient'

// ── URL handshake (Phase 7.14) ────────────────────────────────────────────────
export type {
  IframeWidgetUrlParams,
  BuildIframeWidgetUrlOptions,
  ParseIframeWidgetUrlParamsResult,
} from './urlHandshake'
export {
  URL_HANDSHAKE_PARAM_NAMES,
  isValidWidgetIdFormat,
  buildIframeWidgetUrl,
  parseIframeWidgetUrlParams,
} from './urlHandshake'
