'use client'

/**
 * Decision OS — Phase 7.8 React Adapter: lightweight renderer boundary.
 * Phase 7.18 — SDKTheme.partner_override / enterprise_branding wiring.
 *
 * Purely presentational — takes an already-resolved `UseAllFantasyWidgetResult`
 * and renders it. Computes NOTHING: colors come from `resolveThemedColorTokenHex`/
 * `resolveWidgetChromeHex` (a token lookup, not a derivation), and every
 * score/label/badge/recommendation rendered here already arrived
 * pre-resolved from the Presentation API.
 *
 * `theme` is an OPTIONAL new prop (Phase 7.18) — omitting it renders
 * identically to every pre-7.18 caller (all four embed targets that
 * compose this component automatically gain theme support the moment
 * they start passing one through, with zero change required here).
 *
 * Styling uses inline styles, not Tailwind — this component is meant to be
 * embeddable on a partner site with no CSS framework installed at all.
 */

import type { CSSProperties } from 'react'
import type { WidgetPresentationData, UseAllFantasyWidgetResult } from './types'
import type { SDKTheme } from '../../../lib/decision-os/sdk/types'
import { extractHeadline } from './presentationHelpers'
import { resolveThemedColorTokenHex, resolveWidgetChromeHex } from './tokens'
import type { WidgetChromeHex } from './tokens'

export interface WidgetRenderBoundaryProps {
  result: UseAllFantasyWidgetResult
  /** White-label theme (Phase 7.4). Omit for the default (dark) palette — always a graceful fallback, never required. */
  theme?: SDKTheme | null
}

function buildContainerStyle(chrome: WidgetChromeHex): CSSProperties {
  return {
    fontFamily: 'system-ui, sans-serif',
    color: chrome.text,
    background: chrome.background,
    border: `1px solid ${chrome.border}`,
    borderRadius: 12,
    padding: 16,
    maxWidth: 360,
  }
}

function buttonStyle(chrome: WidgetChromeHex): CSSProperties {
  return {
    background: 'transparent',
    border: `1px solid ${chrome.border}`,
    borderRadius: 6,
    color: chrome.text,
    padding: '4px 10px',
    cursor: 'pointer',
  }
}

function Dot({ hex }: { hex: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        backgroundColor: hex,
        marginRight: 6,
      }}
    />
  )
}

function LoadingState({ chrome }: { chrome: WidgetChromeHex }) {
  return (
    <div style={buildContainerStyle(chrome)} data-widget-state="loading">
      <p style={{ opacity: 0.6, margin: 0 }}>Loading…</p>
    </div>
  )
}

function DisposedState() {
  return null
}

function ErrorLikeState({
  chrome,
  headline,
  message,
  retryable,
  onRetry,
}: {
  chrome: WidgetChromeHex
  headline: string
  message: string
  retryable: boolean
  onRetry: () => void
}) {
  return (
    <div style={buildContainerStyle(chrome)} data-widget-state="error">
      <p style={{ fontWeight: 600, margin: '0 0 4px 0' }}>{headline}</p>
      <p style={{ opacity: 0.7, margin: '0 0 12px 0', fontSize: 13 }}>{message}</p>
      {retryable && (
        <button type="button" onClick={() => void onRetry()} style={buttonStyle(chrome)}>
          Retry
        </button>
      )}
    </div>
  )
}

function ReadyState({
  chrome,
  theme,
  data,
  degraded,
  onRefresh,
}: {
  chrome: WidgetChromeHex
  theme?: SDKTheme | null
  data: WidgetPresentationData
  degraded: boolean
  onRefresh: () => void
}) {
  const headline = extractHeadline(data)
  const dotHex = resolveThemedColorTokenHex(headline.severity.displayColorToken, theme)

  return (
    <div style={buildContainerStyle(chrome)} data-widget-state="ready">
      {degraded && (
        <p style={{ fontSize: 12, opacity: 0.6, margin: '0 0 8px 0' }} data-widget-degraded="true">
          Data may be incomplete.
        </p>
      )}
      <p style={{ fontSize: 13, opacity: 0.7, margin: '0 0 4px 0' }}>{headline.label}</p>
      <p style={{ fontSize: 28, fontWeight: 700, margin: '0 0 8px 0', display: 'flex', alignItems: 'center' }}>
        <Dot hex={dotHex} />
        {headline.score}
      </p>

      {data.badges.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {data.badges.map((badge) => (
            <span
              key={badge.id}
              style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 999,
                background: chrome.surface,
                color: resolveThemedColorTokenHex(badge.colorToken, theme),
              }}
            >
              {badge.label}
            </span>
          ))}
        </div>
      )}

      {data.metrics.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          {data.metrics.map((metric) => (
            <div key={metric.metricId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0' }}>
              <span style={{ opacity: 0.7 }}>
                <Dot hex={resolveThemedColorTokenHex(metric.colorToken, theme)} />
                {metric.label}
              </span>
              <span>{metric.displayValue}</span>
            </div>
          ))}
        </div>
      )}

      {data.topRecommendations.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {data.topRecommendations.map((rec) => (
            <li key={rec.recommendationId} style={{ fontSize: 12, marginBottom: 6 }}>
              <span style={{ fontWeight: 600 }}>
                <Dot hex={resolveThemedColorTokenHex(rec.colorToken, theme)} />
                {rec.title}
              </span>
              <p style={{ margin: '2px 0 0 14px', opacity: 0.7 }}>{rec.description}</p>
            </li>
          ))}
        </ul>
      )}

      <button type="button" onClick={() => void onRefresh()} style={{ ...buttonStyle(chrome), marginTop: 10 }}>
        Refresh
      </button>
    </div>
  )
}

export function WidgetRenderBoundary({ result, theme }: WidgetRenderBoundaryProps) {
  const chrome = resolveWidgetChromeHex(theme)
  const partnerBrandId = theme?.partnerBrandId ?? null

  const content = (() => {
    switch (result.renderState) {
      case 'loading':
        return <LoadingState chrome={chrome} />
      case 'disposed':
        return <DisposedState />
      case 'error':
        return (
          <ErrorLikeState
            chrome={chrome}
            headline="Something went wrong"
            message={result.error?.message ?? 'An unknown error occurred.'}
            retryable={result.error?.retryable ?? false}
            onRetry={result.refresh}
          />
        )
      case 'offline':
        return (
          <ErrorLikeState
            chrome={chrome}
            headline="Temporarily unavailable"
            message={result.error?.message ?? 'This widget is temporarily offline.'}
            retryable={true}
            onRetry={result.refresh}
          />
        )
      case 'rate_limited':
        return (
          <ErrorLikeState
            chrome={chrome}
            headline="Please wait"
            message={result.error?.message ?? 'Too many requests — try again shortly.'}
            retryable={true}
            onRetry={result.refresh}
          />
        )
      case 'ready':
        if (!result.data) return <LoadingState chrome={chrome} />
        return <ReadyState chrome={chrome} theme={theme} data={result.data} degraded={result.degraded} onRefresh={result.refresh} />
    }
  })()

  if (result.renderState === 'disposed' || content === null) return content

  // partnerBrandId (Phase 7.4's SDKTheme.partnerBrandId) is the only
  // brand-identity field the frozen SDK contract carries — no logo URL or
  // display-name field exists on SDKTheme, so none is invented here. It is
  // surfaced as a data attribute so a partner's OWN stylesheet can hook a
  // logo/branding in (e.g. `[data-partner-brand-id="acme"] { ... }`)
  // without this renderer sourcing or rendering arbitrary partner assets.
  return partnerBrandId ? <div data-partner-brand-id={partnerBrandId}>{content}</div> : content
}
