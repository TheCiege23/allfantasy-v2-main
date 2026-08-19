/**
 * Decision OS — Phase 7.10 Iframe Bootstrap: safe postMessage wrapper.
 *
 * The ONE place `.postMessage()` may be called in this package — every send
 * path (Host, Client) routes through this function, which guarantees the
 * explicit-target-origin rule (PHASE_7_5_WIDGET_RUNTIME_BOUNDARY_ADR.md §2:
 * "every outbound postMessage call specifies an explicit targetOrigin —
 * never '*'") can never be silently bypassed.
 */

import { assertExplicitTargetOrigin } from './origin'
import type { IframeMessage } from './types'
import type { WindowLike } from './windowLike'

export function safePostMessage(target: WindowLike, message: IframeMessage, targetOrigin: string): void {
  assertExplicitTargetOrigin(targetOrigin)
  target.postMessage(message, targetOrigin)
}
