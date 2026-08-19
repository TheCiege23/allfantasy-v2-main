'use client'

/**
 * Decision OS — Phase 7.17 JS Embed Adapter: React composition bridge.
 *
 * Composes `sdk-runtime/react` (Phase 7.8) — `useAllFantasyWidget` +
 * `WidgetRenderBoundary` — the same category of sanctioned exception to
 * "adapters never depend on other adapters" that the iframe react-child
 * bridge (Phase 7.15) and the web component adapter (Phase 7.16)
 * established: neither `sdk-runtime/react` nor any OTHER adapter
 * (`sdk-runtime/iframe`, `sdk-runtime/web-component`) is imported here
 * except the one sanctioned react composition, proven by the
 * import-boundary test's positive control. Computes NOTHING — every
 * score/badge/recommendation rendered comes from `WidgetRenderBoundary`,
 * which already renders pre-resolved wire data only.
 */

import { useCallback, useEffect } from 'react'
import type { Root } from 'react-dom/client'
import { useAllFantasyWidget, WidgetRenderBoundary } from '../../react/src/index'
import type { UseAllFantasyWidgetResult } from '../../react/src/index'
import type { WidgetConfig } from '../../../lib/decision-os/presentation/widget-contracts'
import type { SDKAuth, SDKTheme } from '../../../lib/decision-os/sdk/types'
import type { RuntimeClock, RuntimeFetch, RefreshStrategyOverrides } from '../../core/src/index'

export interface EmbedWidgetContentProps {
  config: WidgetConfig
  auth: SDKAuth
  baseUrl: string
  fetchImpl: RuntimeFetch
  clock: RuntimeClock
  refreshStrategyOverrides?: RefreshStrategyOverrides
  theme?: SDKTheme | null
  onStateChange: (result: UseAllFantasyWidgetResult) => void
  onInteraction?: (target: string) => void
}

function EmbedWidgetContent({
  config,
  auth,
  baseUrl,
  fetchImpl,
  clock,
  refreshStrategyOverrides,
  theme,
  onStateChange,
  onInteraction,
}: EmbedWidgetContentProps) {
  const result = useAllFantasyWidget({ config, auth, baseUrl, fetchImpl, clock, refreshStrategyOverrides })

  useEffect(() => {
    onStateChange(result)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onStateChange is a stable per-instance callback owned by createWidget.ts
  }, [result.renderState, result.data, result.degraded, result.error])

  const handleRefresh = useCallback(async () => {
    onInteraction?.('refresh_button')
    await result.refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onInteraction is a stable per-instance callback owned by createWidget.ts
  }, [result.refresh])

  return <WidgetRenderBoundary result={{ ...result, refresh: handleRefresh }} theme={theme} />
}

function ConfigErrorFallback({ errors }: { errors: string[] }) {
  return (
    <div
      data-widget-state="error"
      style={{
        fontFamily: 'system-ui, sans-serif',
        color: '#e2e8f0',
        background: 'rgba(15,23,42,0.9)',
        borderRadius: 12,
        padding: 16,
        maxWidth: 360,
      }}
    >
      <p style={{ fontWeight: 600, margin: '0 0 4px 0' }}>Widget configuration is invalid.</p>
      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, opacity: 0.7 }}>
        {errors.map((message, index) => (
          <li key={index}>{message}</li>
        ))}
      </ul>
    </div>
  )
}

export function renderEmbedWidgetContent(root: Root, props: EmbedWidgetContentProps): void {
  root.render(<EmbedWidgetContent {...props} />)
}

export function renderConfigErrorFallback(root: Root, errors: string[]): void {
  root.render(<ConfigErrorFallback errors={errors} />)
}
