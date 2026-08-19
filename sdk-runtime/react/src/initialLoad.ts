/**
 * Decision OS — Phase 7.8 React Adapter: initial load orchestration.
 *
 * Drives the ONE lifecycle path the sdk-runtime core (Phase 7.6/7.7) does
 * not itself own: the first load, initializing → authenticating → loading →
 * rendering → ready. RefreshEngine only manages what happens AFTER a widget
 * first reaches 'ready'. Pure orchestration over core's existing exports —
 * no new HTTP logic, no new auth logic, no new lifecycle rules.
 *
 * Framework-agnostic and independently testable without React — the hook
 * (useAllFantasyWidget.ts) is a thin wrapper around this function plus
 * RefreshEngine for subsequent refreshes.
 */

import { authPreCheck, fetchPresentation } from '../../core/src/index'
import type {
  ExpectedEntity,
  HttpClientConfig,
  LifecycleController,
} from '../../core/src/index'
import type { SDKAuth, SDKError } from '../../../lib/decision-os/sdk/types'
import type { WidgetApiCall } from '../../../lib/decision-os/presentation/widget-contracts'
import type { WidgetPresentationData } from './types'

export interface InitialLoadDeps {
  httpConfig: HttpClientConfig
  call: WidgetApiCall
  auth: SDKAuth
  expected: ExpectedEntity
  lifecycle: LifecycleController
}

export interface InitialLoadResult {
  data: WidgetPresentationData | null
  degraded: boolean
  error: SDKError | null
}

export async function runInitialLoad(deps: InitialLoadDeps): Promise<InitialLoadResult> {
  const { lifecycle } = deps

  if (lifecycle.canTransition('authenticating')) {
    lifecycle.transition('authenticating')
  }

  const authResult = authPreCheck(deps.auth)
  if (!authResult.ok) {
    if (lifecycle.canTransition('error')) lifecycle.transition('error')
    return { data: null, degraded: false, error: authResult.error }
  }

  if (!lifecycle.canTransition('loading')) {
    // Already past the initial-load point (e.g. effect re-entered) — nothing to do.
    return { data: null, degraded: false, error: null }
  }
  lifecycle.transition('loading')

  const result = await fetchPresentation(deps.httpConfig, deps.call, deps.auth, deps.expected)

  if (result.ok) {
    // Real rendering happens in the React tree right after this resolves —
    // 'rendering' has genuine meaning here, unlike RefreshEngine's offline
    // retry path, which has no renderer of its own to hand off to.
    if (lifecycle.canTransition('rendering')) lifecycle.transition('rendering')
    if (lifecycle.canTransition('ready')) lifecycle.transition('ready')
    // Safe assertion: fetchPresentation already verified data.entityId/entityType
    // match `expected` before returning ok:true (Phase 7.6 tenant assertion),
    // and `expected.entityType` is one of the four valid presentation entity
    // types by construction — no additional runtime narrowing needed.
    return { data: result.data as unknown as WidgetPresentationData, degraded: result.degraded, error: null }
  }

  const nextState = result.error.retryable ? 'offline' : 'error'
  if (lifecycle.canTransition(nextState)) lifecycle.transition(nextState)
  return { data: null, degraded: false, error: result.error }
}
