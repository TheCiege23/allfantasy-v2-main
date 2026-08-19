'use client'

/**
 * Decision OS — Phase 7.8 React Adapter: useAllFantasyWidget hook.
 *
 * Wires sdk-runtime core (LifecycleController, RefreshEngine, fetchPresentation,
 * authPreCheck — Phase 7.6/7.7) to React state. Computes NOTHING: every field
 * on the returned presentation data already arrived pre-resolved from the
 * Presentation API. This hook only orchestrates fetch/lifecycle/refresh
 * timing and exposes them as React state + callbacks.
 *
 * A fresh LifecycleController + RefreshEngine pair is created every time the
 * effect (re-)runs — never reused across effect runs — because a disposed
 * LifecycleController is terminal (Phase 7.4) and cannot be revived.
 *
 * Dependency-array tradeoff: the effect re-runs on entity/mode/baseUrl
 * identity changes only, NOT on `auth`/`fetchImpl`/`clock`/
 * `refreshStrategyOverrides` reference changes — those are captured once
 * per effect run via closure. A host that needs to swap auth mid-session
 * should force a remount (e.g. via a React `key` prop keyed on the auth
 * credential), the standard pattern for this exact situation.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  validateWidgetConfig,
  mapWidgetModeToApiCall,
} from '../../../lib/decision-os/presentation/widget-contracts'
import { buildSDKError } from '../../../lib/decision-os/sdk/errors'
import type { SDKError, SDKLifecycleState } from '../../../lib/decision-os/sdk/types'
import { LifecycleController, RefreshEngine } from '../../core/src/index'
import type { HttpClientConfig } from '../../core/src/index'
import { runInitialLoad } from './initialLoad'
import { mapLifecycleToRenderState } from './lifecycleMapping'
import type { UseAllFantasyWidgetOptions, UseAllFantasyWidgetResult, WidgetPresentationData } from './types'

export function useAllFantasyWidget(options: UseAllFantasyWidgetOptions): UseAllFantasyWidgetResult {
  const { config, auth, baseUrl, fetchImpl, clock, refreshStrategyOverrides } = options

  const [lifecycleState, setLifecycleState] = useState<SDKLifecycleState>('initializing')
  const [data, setData] = useState<WidgetPresentationData | null>(null)
  const [degraded, setDegraded] = useState(false)
  const [error, setError] = useState<SDKError | null>(null)

  const engineRef = useRef<RefreshEngine | null>(null)

  useEffect(() => {
    let cancelled = false
    const lifecycle = new LifecycleController()

    setLifecycleState(lifecycle.currentState)
    setData(null)
    setDegraded(false)
    setError(null)
    engineRef.current = null

    const validation = validateWidgetConfig(config)
    if (!validation.valid) {
      if (lifecycle.canTransition('error')) lifecycle.transition('error')
      if (!cancelled) {
        setError(buildSDKError('UNSUPPORTED_WIDGET'))
        setLifecycleState(lifecycle.currentState)
      }
      return
    }

    const call = mapWidgetModeToApiCall(config)
    if (!call) {
      // Unreachable given validation.valid === true, but keep the branch
      // typed and defensive rather than asserting with `!`.
      if (lifecycle.canTransition('error')) lifecycle.transition('error')
      if (!cancelled) {
        setError(buildSDKError('UNSUPPORTED_WIDGET'))
        setLifecycleState(lifecycle.currentState)
      }
      return
    }

    const httpConfig: HttpClientConfig = { baseUrl, fetchImpl }
    const expected = { entityId: config.entityId, entityType: config.entityType }

    const engine = new RefreshEngine({
      clock,
      httpConfig,
      call,
      auth,
      expected,
      lifecycle,
      strategyOverrides: refreshStrategyOverrides,
    })
    engineRef.current = engine

    const unsubscribe = engine.onResult((outcome) => {
      if (cancelled) return
      setLifecycleState(lifecycle.currentState)
      if (outcome.outcome === 'success') {
        setData(outcome.result.data as unknown as WidgetPresentationData)
        setDegraded(outcome.result.degraded)
        setError(null)
      } else if (outcome.outcome === 'failure') {
        setError(outcome.result.error)
      }
    })

    void runInitialLoad({ httpConfig, call, auth, expected, lifecycle }).then((result) => {
      if (cancelled) return
      setLifecycleState(lifecycle.currentState)
      setData(result.data)
      setDegraded(result.degraded)
      setError(result.error)
    })

    return () => {
      cancelled = true
      unsubscribe()
      engine.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see dependency-array tradeoff note above
  }, [config.entityId, config.entityType, config.mode, baseUrl])

  const refresh = useCallback(async () => {
    const engine = engineRef.current
    if (!engine) return
    await engine.refreshNow()
  }, [])

  return {
    renderState: mapLifecycleToRenderState(lifecycleState),
    lifecycleState,
    data,
    degraded,
    error,
    refresh,
    engine: engineRef.current,
  }
}
