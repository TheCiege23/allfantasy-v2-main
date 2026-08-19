/**
 * Decision OS — Phase 7.9 Iframe Adapter: lifecycle/error message mapping.
 *
 * Pure, deterministic mapping from the frozen Phase 7.4 SDKLifecycleState/
 * SDKError into the sanitized, wire-safe payload shapes the iframe posts to
 * its parent. Deliberately duplicated from the equivalent mapping in
 * sdk-runtime/react (not imported) — PHASE_7_5_WIDGET_RUNTIME_BOUNDARY_ADR.md
 * decision D2: adapters never depend on other adapters, only on core.
 */

import type { SDKError, SDKLifecycleState } from '../../../lib/decision-os/sdk/types'
import type { IframeErrorPayload, IframeLifecycleState } from './types'

const IFRAME_LIFECYCLE_MAP: Readonly<Record<SDKLifecycleState, IframeLifecycleState>> = {
  initializing: 'loading',
  authenticating: 'loading',
  loading: 'loading',
  rendering: 'loading',
  ready: 'ready',
  refreshing: 'ready',
  error: 'error',
  offline: 'offline',
  rate_limited: 'rate_limited',
  disposed: 'disposed',
}

export function mapLifecycleToIframeState(state: SDKLifecycleState): IframeLifecycleState {
  return IFRAME_LIFECYCLE_MAP[state]
}

/**
 * Extracts the sanitized subset of SDKError safe to post across the frame
 * boundary. `widgetId`/`timestamp` are omitted — the message envelope
 * already carries both at the top level.
 */
export function mapErrorToIframePayload(error: SDKError): IframeErrorPayload {
  return { code: error.code, message: error.message, retryable: error.retryable }
}
