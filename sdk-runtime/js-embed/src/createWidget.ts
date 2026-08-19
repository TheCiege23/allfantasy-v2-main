'use client'

/**
 * Decision OS — Phase 7.17 JS Embed Adapter: `createAllFantasyWidget`.
 *
 * The plain-JavaScript public API: `AllFantasy.createWidget({ container,
 * config, auth, apiKey, baseUrl })`. A single call validates the container,
 * validates + assembles the widget config with the injected credential,
 * mounts a React tree (reusing sdk-runtime/react, see
 * AllFantasyWidgetBridge.tsx) into the container, and returns a small
 * instance object for mount/unmount/refresh/state introspection.
 *
 * Credential handling: `auth`/`apiKey` are captured only in this function's
 * closure — never attached as a property of the returned
 * `AllFantasyWidgetInstance`, never derived from `container` or `config`.
 */

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { buildSDKError } from '../../../lib/decision-os/sdk/errors'
import type { UseAllFantasyWidgetResult } from '../../react/src/index'
import type { WidgetRenderState } from '../../react/src/index'
import { validateContainer, markContainerMounted, markContainerUnmounted } from './containerValidation'
import { validateCreateWidgetInputs } from './config'
import { defaultClock, defaultFetchImpl } from './defaults'
import { renderConfigErrorFallback, renderEmbedWidgetContent } from './AllFantasyWidgetBridge'
import type { AllFantasyWidgetInstance, CreateWidgetOptions } from './types'

export function createAllFantasyWidget(options: CreateWidgetOptions): AllFantasyWidgetInstance {
  const validation = validateCreateWidgetInputs(options.config, options.auth, options.apiKey)

  let root: Root | null = null
  let mounted = false
  let lastRenderState: WidgetRenderState | null = null
  let refreshFn: (() => Promise<void>) | null = null
  let configErrors: readonly string[] = validation.valid ? [] : validation.errors

  function handleStateChange(result: UseAllFantasyWidgetResult): void {
    refreshFn = result.refresh
    if (result.renderState === lastRenderState) return
    lastRenderState = result.renderState

    if (result.renderState === 'ready') {
      options.onReady?.({ degraded: result.degraded })
      if (result.degraded) options.onDegraded?.()
    } else if (result.renderState === 'error' || result.renderState === 'offline' || result.renderState === 'rate_limited') {
      if (result.error) options.onError?.(result.error)
    }
  }

  function mount(): void {
    if (mounted) return

    const containerCheck = validateContainer(options.container)
    if (!containerCheck.valid) {
      throw new TypeError(`AllFantasy.createWidget: invalid container — ${containerCheck.errors.join('; ')}`)
    }
    const container = options.container as Element

    root = createRoot(container)
    markContainerMounted(container)
    mounted = true

    if (!validation.valid) {
      lastRenderState = 'error'
      configErrors = validation.errors
      renderConfigErrorFallback(root, validation.errors)
      options.onError?.(buildSDKError('UNSUPPORTED_WIDGET'))
      return
    }

    configErrors = []
    renderEmbedWidgetContent(root, {
      config: validation.config,
      auth: options.auth,
      baseUrl: options.baseUrl,
      fetchImpl: options.fetchImpl ?? defaultFetchImpl,
      clock: options.clock ?? defaultClock,
      refreshStrategyOverrides: options.refreshStrategyOverrides,
      theme: options.theme,
      onStateChange: handleStateChange,
      onInteraction: options.onInteraction,
    })
  }

  function unmount(): void {
    if (!mounted) return
    mounted = false
    if (root) {
      root.unmount()
      root = null
    }
    if (options.container instanceof Element) markContainerUnmounted(options.container)
    refreshFn = null
    lastRenderState = null
  }

  mount()

  return {
    mount,
    unmount,
    refresh: () => (refreshFn ? refreshFn() : Promise.resolve()),
    get renderState() {
      return lastRenderState
    },
    get configErrors() {
      return configErrors
    },
  }
}
