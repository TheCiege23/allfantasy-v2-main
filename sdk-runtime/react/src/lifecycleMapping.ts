/**
 * Decision OS — Phase 7.8 React Adapter: lifecycle state mapping.
 *
 * Pure, deterministic collapse of the 10-state SDKLifecycleState (Phase 7.4)
 * into the smaller WidgetRenderState set a UI actually branches on.
 */

import type { SDKLifecycleState } from '../../../lib/decision-os/sdk/types'
import type { WidgetRenderState } from './types'

const RENDER_STATE_MAP: Readonly<Record<SDKLifecycleState, WidgetRenderState>> = {
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

export function mapLifecycleToRenderState(state: SDKLifecycleState): WidgetRenderState {
  return RENDER_STATE_MAP[state]
}
