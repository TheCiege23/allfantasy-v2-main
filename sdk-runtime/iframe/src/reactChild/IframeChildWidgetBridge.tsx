'use client'

/**
 * Decision OS — Phase 7.15 Iframe Child React Renderer Bridge.
 * Phase 7.18 — full SDKTheme (not just `.mode`) threaded through to
 * `WidgetRenderBoundary`'s `theme` prop, so partner_override/
 * enterprise_branding color overrides delivered via the init payload or a
 * theme_update message actually render, not just a `data-theme-mode`
 * attribute.
 *
 * Wires the Phase 7.8 React adapter into the Phase 7.13/7.14 iframe child
 * facade: creates the client from URL params, waits for the host's 'init'
 * before rendering anything, fetches presentation data through
 * `useAllFantasyWidget`, renders via `WidgetRenderBoundary`, and reports
 * ready/resize/interaction/error back to the host. Computes no intelligence
 * — every value rendered already arrived pre-resolved on the wire (same
 * discipline as Phase 7.8's own components).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { useAllFantasyWidget, WidgetRenderBoundary } from '../../../react/src/index'
import { SDK_VERSION } from '../../../../lib/decision-os/sdk/index'
import type { SDKTheme } from '../../../../lib/decision-os/sdk/types'
import type { WidgetConfig } from '../../../../lib/decision-os/presentation/widget-contracts'
import { createAllFantasyWidgetIframeClientFromUrl } from '../facade/index'
import type { AllFantasyWidgetIframeClient } from '../facade/index'
import type { IframeInitPayload } from '../index'
import type { ReactIframeChildBridgeConfig, MountedReactIframeChildBridge } from './types'

// ── Inner: renders once 'init' has arrived ─────────────────────────────────────

interface RenderedWidgetProps {
  initPayload: IframeInitPayload
  bridgeConfig: ReactIframeChildBridgeConfig
  client: AllFantasyWidgetIframeClient
  refreshRef: React.MutableRefObject<(() => Promise<void>) | null>
  theme: SDKTheme
}

function RenderedWidget({ initPayload, bridgeConfig, client, refreshRef, theme }: RenderedWidgetProps) {
  const widgetConfig: WidgetConfig = useMemo(
    () => ({
      mode: initPayload.widgetMode,
      entityId: initPayload.entityId,
      entityType: initPayload.entityType,
      tenantConfig: bridgeConfig.tenantConfig,
      presentationVersion: initPayload.presentationVersion,
    }),
    [initPayload, bridgeConfig.tenantConfig],
  )

  const result = useAllFantasyWidget({
    config: widgetConfig,
    auth: bridgeConfig.auth,
    baseUrl: bridgeConfig.baseUrl,
    fetchImpl: bridgeConfig.fetchImpl,
    clock: bridgeConfig.clock,
    refreshStrategyOverrides: bridgeConfig.refreshStrategyOverrides,
  })

  refreshRef.current = result.refresh

  // Report errors to the host as they occur.
  useEffect(() => {
    if (result.error) client.sendError(result.error)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- client is stable per mount
  }, [result.error])

  // Report height after each render-affecting change. No ResizeObserver —
  // this re-measures on data/state changes only, a deliberate simplification
  // for this ticket's scope (does not catch external CSS/font-load resizes).
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (containerRef.current) {
      client.sendResize(containerRef.current.scrollHeight)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- client is stable per mount
  }, [result.renderState, result.data, result.degraded])

  const handleRefreshWithInteraction = useCallback(async () => {
    client.sendInteraction('refresh_button')
    await result.refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- client is stable per mount
  }, [result.refresh])

  return (
    <div ref={containerRef}>
      <WidgetRenderBoundary result={{ ...result, refresh: handleRefreshWithInteraction }} theme={theme} />
    </div>
  )
}

// ── Outer: owns the handshake, waits for init ─────────────────────────────────

interface IframeChildWidgetContentProps {
  bridgeConfig: ReactIframeChildBridgeConfig
  onDisposed: () => void
}

function IframeChildWidgetContent({ bridgeConfig, onDisposed }: IframeChildWidgetContentProps) {
  const [initPayload, setInitPayload] = useState<IframeInitPayload | null>(null)
  const [theme, setTheme] = useState<SDKTheme | null>(null)
  const clientRef = useRef<AllFantasyWidgetIframeClient | null>(null)
  const refreshRef = useRef<(() => Promise<void>) | null>(null)

  useEffect(() => {
    const client = createAllFantasyWidgetIframeClientFromUrl({
      locationSearch: bridgeConfig.locationSearch,
      ownWindow: bridgeConfig.ownWindow,
      parentWindow: bridgeConfig.parentWindow,
      generateTimestamp: bridgeConfig.generateTimestamp,
      onInit: (payload) => {
        setInitPayload(payload)
        // The init payload already carries the host's initial SDKTheme
        // (Phase 7.9's buildInitPayloadFromSdkConfig) — use it immediately
        // rather than waiting for a separate theme_update message.
        setTheme(payload.theme)
      },
      onRefreshRequest: () => { void refreshRef.current?.() },
      onThemeUpdate: (updatedTheme) => setTheme(updatedTheme),
      onProtocolRejection: bridgeConfig.onProtocolRejection,
      onDisposed,
    })
    clientRef.current = client
    client.sendReady(SDK_VERSION)

    return () => {
      client.dispose()
      clientRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- constructed once per mount; bridgeConfig treated as stable, matching the dependency-array tradeoff already documented in Phase 7.8's useAllFantasyWidget.ts
  }, [])

  if (!initPayload || !clientRef.current) {
    return null
  }

  return (
    <RenderedWidget
      initPayload={initPayload}
      bridgeConfig={bridgeConfig}
      client={clientRef.current}
      refreshRef={refreshRef}
      theme={theme ?? initPayload.theme}
    />
  )
}

// ── Public entrypoint ──────────────────────────────────────────────────────────

export function mountReactIframeChildBridge(
  config: ReactIframeChildBridgeConfig,
): MountedReactIframeChildBridge {
  const root: Root = createRoot(config.container)
  let unmounted = false

  const handleDisposed = (): void => {
    if (unmounted) return
    unmounted = true
    root.unmount()
    config.onDisposed?.()
  }

  root.render(<IframeChildWidgetContent bridgeConfig={config} onDisposed={handleDisposed} />)

  return {
    unmount: (): void => {
      if (unmounted) return
      unmounted = true
      root.unmount()
    },
  }
}
