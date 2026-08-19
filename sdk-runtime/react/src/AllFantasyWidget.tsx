'use client'

/**
 * Decision OS — Phase 7.8 React Adapter: composed convenience component.
 * Phase 7.18 — accepts an optional `theme` prop, forwarded straight to
 * `WidgetRenderBoundary` (theme is a rendering concern, not a fetch
 * concern, so it is not part of `UseAllFantasyWidgetOptions`).
 *
 * `useAllFantasyWidget` (data) + `WidgetRenderBoundary` (presentation),
 * composed. A host app that doesn't need direct access to lifecycle state
 * or the refresh engine can use this single component.
 */

import { useAllFantasyWidget } from './useAllFantasyWidget'
import { WidgetRenderBoundary } from './WidgetRenderBoundary'
import type { UseAllFantasyWidgetOptions } from './types'
import type { SDKTheme } from '../../../lib/decision-os/sdk/types'

export interface AllFantasyWidgetProps extends UseAllFantasyWidgetOptions {
  theme?: SDKTheme | null
}

export function AllFantasyWidget({ theme, ...options }: AllFantasyWidgetProps) {
  const result = useAllFantasyWidget(options)
  return <WidgetRenderBoundary result={result} theme={theme} />
}
