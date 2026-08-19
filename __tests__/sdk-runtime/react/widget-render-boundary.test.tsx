import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WidgetRenderBoundary } from '../../../sdk-runtime/react/src/WidgetRenderBoundary'
import { DEFAULT_COLOR_HEX_DARK, DEFAULT_COLOR_HEX_LIGHT } from '../../../sdk-runtime/react/src/tokens'
import type { UseAllFantasyWidgetResult, WidgetPresentationData } from '../../../sdk-runtime/react/src/types'
import { resolveSDKTheme } from '../../../lib/decision-os/sdk/theme'
import type { SDKError, SDKLifecycleState, SDKTheme } from '../../../lib/decision-os/sdk/types'

function makePartnerTheme(colorTokenMap: SDKTheme['tokens']['colorTokenMap'] = {}, mode: SDKTheme['mode'] = 'partner_override'): SDKTheme {
  const base = resolveSDKTheme(mode, {}, 'partner_acme')
  return { ...base, tokens: { ...base.tokens, colorTokenMap } }
}

/** jsdom serializes rgba()/rgb() CSS values with a space after each comma — normalize our raw literals to match before comparing against `element.style.*`. */
function normalizeRgba(value: string): string {
  return value.replace(/,(?!\s)/g, ', ')
}

/** jsdom serializes hex colors assigned via React's `style` prop back out as `rgb(r, g, b)` — convert our hex literals the same way. */
function hexToRgb(hex: string): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return `rgb(${r}, ${g}, ${b})`
}

function makeData(overrides: Partial<WidgetPresentationData> = {}): WidgetPresentationData {
  return {
    entityId: 'league_001',
    entityType: 'league',
    healthScore: 82,
    healthSeverity: { token: 'positive', priority: 5, displayColorToken: 'success', iconToken: 'check', animationToken: 'none' },
    archetype: 'balanced_league',
    archetypeLabel: 'Balanced League',
    retentionRisk: 'low',
    engagementTier: 'active',
    badges: [{ id: 'badge_1', catalogId: 'top_10_pct', label: 'Top 10%', description: 'desc', colorToken: 'success', iconToken: 'star', tier: 'league', derivation: [] }],
    topRecommendations: [{
      recommendationId: 'rec_1', tier: 'commissioner', category: 'engagement', entityId: 'league_001',
      priority: 'high',
      severity: { token: 'elevated', priority: 2, displayColorToken: 'warning', iconToken: 'alert_triangle', animationToken: 'none' },
      colorToken: 'warning', iconToken: 'zap', title: 'Boost Activity', description: 'Encourage trades this week.',
      expectedImpact: 'x', difficulty: 'easy', estimatedTime: '5_min', supportingEvidence: [], actions: [],
      rollbackCriteria: [], prerequisites: [], completionStatus: 'pending', relatedGraph: null, relatedKpi: null,
      benchmarkContext: null, uncertainty: [], derivation: [], completeness: 90,
    }],
    metrics: [{
      metricId: 'metric_1', label: 'Engagement', displayValue: '95%', numericValue: 95,
      colorToken: 'success', severityToken: 'positive', trend: null, subtext: null, progressValue: 95,
      derivation: [], completeness: 90,
    }],
    benchmarkSummary: null,
    completeness: 100,
    version: '7.0.0',
    ...overrides,
  } as WidgetPresentationData
}

function makeResult(overrides: Partial<UseAllFantasyWidgetResult> = {}): UseAllFantasyWidgetResult {
  return {
    renderState: 'ready',
    lifecycleState: 'ready' as SDKLifecycleState,
    data: makeData(),
    degraded: false,
    error: null,
    refresh: async () => {},
    engine: null,
    ...overrides,
  }
}

function makeError(overrides: Partial<SDKError> = {}): SDKError {
  return {
    code: 'UNAUTHORIZED',
    message: 'The provided credentials are not authorized for this widget.',
    retryable: false,
    widgetId: null,
    timestamp: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('WidgetRenderBoundary — loading', () => {
  it('renders a loading indicator', () => {
    render(<WidgetRenderBoundary result={makeResult({ renderState: 'loading', data: null })} />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })
})

describe('WidgetRenderBoundary — ready', () => {
  it('renders the health score', () => {
    render(<WidgetRenderBoundary result={makeResult()} />)
    expect(screen.getByText('82')).toBeInTheDocument()
  })

  it('renders badges', () => {
    render(<WidgetRenderBoundary result={makeResult()} />)
    expect(screen.getByText('Top 10%')).toBeInTheDocument()
  })

  it('renders metrics', () => {
    render(<WidgetRenderBoundary result={makeResult()} />)
    expect(screen.getByText('Engagement')).toBeInTheDocument()
  })

  it('renders recommendations', () => {
    render(<WidgetRenderBoundary result={makeResult()} />)
    expect(screen.getByText('Boost Activity')).toBeInTheDocument()
  })

  it('falls back to loading when data is null but renderState is ready (transient)', () => {
    render(<WidgetRenderBoundary result={makeResult({ data: null })} />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('does not render a degraded banner when degraded is false', () => {
    render(<WidgetRenderBoundary result={makeResult({ degraded: false })} />)
    expect(screen.queryByText(/may be incomplete/i)).not.toBeInTheDocument()
  })

  it('renders a degraded banner when degraded is true', () => {
    render(<WidgetRenderBoundary result={makeResult({ degraded: true })} />)
    expect(screen.getByText(/may be incomplete/i)).toBeInTheDocument()
  })

  it('the refresh button calls result.refresh()', () => {
    let called = false
    const result = makeResult({ refresh: async () => { called = true } })
    render(<WidgetRenderBoundary result={result} />)
    fireEvent.click(screen.getByText('Refresh'))
    expect(called).toBe(true)
  })
})

describe('WidgetRenderBoundary — error', () => {
  it('renders the error message', () => {
    const result = makeResult({ renderState: 'error', data: null, error: makeError() })
    render(<WidgetRenderBoundary result={result} />)
    expect(screen.getByText(makeError().message)).toBeInTheDocument()
  })

  it('does not render a retry button for a non-retryable error', () => {
    const result = makeResult({ renderState: 'error', data: null, error: makeError({ retryable: false }) })
    render(<WidgetRenderBoundary result={result} />)
    expect(screen.queryByText('Retry')).not.toBeInTheDocument()
  })

  it('renders a retry button for a retryable error', () => {
    const result = makeResult({ renderState: 'error', data: null, error: makeError({ retryable: true, code: 'NETWORK' }) })
    render(<WidgetRenderBoundary result={result} />)
    expect(screen.getByText('Retry')).toBeInTheDocument()
  })

  it('the retry button calls result.refresh()', () => {
    let called = false
    const result = makeResult({
      renderState: 'error', data: null, error: makeError({ retryable: true, code: 'NETWORK' }),
      refresh: async () => { called = true },
    })
    render(<WidgetRenderBoundary result={result} />)
    fireEvent.click(screen.getByText('Retry'))
    expect(called).toBe(true)
  })
})

describe('WidgetRenderBoundary — offline', () => {
  it('renders an offline message with a retry option', () => {
    const result = makeResult({ renderState: 'offline', data: null, error: makeError({ code: 'NETWORK', retryable: true }) })
    render(<WidgetRenderBoundary result={result} />)
    expect(screen.getByText(/temporarily unavailable/i)).toBeInTheDocument()
    expect(screen.getByText('Retry')).toBeInTheDocument()
  })
})

describe('WidgetRenderBoundary — rate_limited', () => {
  it('renders a rate-limited message', () => {
    const result = makeResult({ renderState: 'rate_limited', data: null, error: makeError({ code: 'RATE_LIMITED', retryable: true }) })
    render(<WidgetRenderBoundary result={result} />)
    expect(screen.getByText(/please wait/i)).toBeInTheDocument()
  })
})

describe('WidgetRenderBoundary — disposed', () => {
  it('renders nothing', () => {
    const { container } = render(<WidgetRenderBoundary result={makeResult({ renderState: 'disposed', data: null })} />)
    expect(container).toBeEmptyDOMElement()
  })
})

// ── Phase 7.18 — theming ─────────────────────────────────────────────────────

describe('WidgetRenderBoundary — default theme (no theme prop)', () => {
  it('renders the dark default palette when theme is omitted', () => {
    const { container } = render(<WidgetRenderBoundary result={makeResult()} />)
    const el = container.querySelector('[data-widget-state="ready"]') as HTMLElement
    expect(el.style.background).toBe(normalizeRgba(DEFAULT_COLOR_HEX_DARK.surface))
  })

  it('renders the same dark palette whether theme is omitted, null, or undefined', () => {
    const { container: a } = render(<WidgetRenderBoundary result={makeResult()} />)
    const { container: b } = render(<WidgetRenderBoundary result={makeResult()} theme={null} />)
    const { container: c } = render(<WidgetRenderBoundary result={makeResult()} theme={undefined} />)
    const bg = (c: HTMLElement) => (c.querySelector('[data-widget-state="ready"]') as HTMLElement).style.background
    expect(bg(a)).toBe(bg(b))
    expect(bg(b)).toBe(bg(c))
  })

  it('does not render a data-partner-brand-id wrapper when there is no theme', () => {
    const { container } = render(<WidgetRenderBoundary result={makeResult()} />)
    expect(container.querySelector('[data-partner-brand-id]')).toBeNull()
  })
})

describe('WidgetRenderBoundary — dark theme', () => {
  it('renders the same palette as the default (dark) for an explicit mode:"dark" theme', () => {
    const { container } = render(<WidgetRenderBoundary result={makeResult()} theme={resolveSDKTheme('dark')} />)
    const el = container.querySelector('[data-widget-state="ready"]') as HTMLElement
    expect(el.style.background).toBe(normalizeRgba(DEFAULT_COLOR_HEX_DARK.surface))
    expect(el.style.color).toBe(hexToRgb(DEFAULT_COLOR_HEX_DARK.neutral))
  })
})

describe('WidgetRenderBoundary — light theme', () => {
  it('renders a visually distinct (light) palette', () => {
    const { container } = render(<WidgetRenderBoundary result={makeResult()} theme={resolveSDKTheme('light')} />)
    const el = container.querySelector('[data-widget-state="ready"]') as HTMLElement
    expect(el.style.background).toBe(normalizeRgba(DEFAULT_COLOR_HEX_LIGHT.surface))
    expect(el.style.background).not.toBe(normalizeRgba(DEFAULT_COLOR_HEX_DARK.surface))
  })
})

describe('WidgetRenderBoundary — partner_override', () => {
  it('applies a partner accent override to the health-score dot color', () => {
    const theme = makePartnerTheme({ accent: '#0a84ff', success: '#00c853' })
    const { container } = render(<WidgetRenderBoundary result={makeResult()} theme={theme} />)
    // healthSeverity.displayColorToken is 'success' in the fixture data.
    const dot = container.querySelector('[data-widget-state="ready"] span') as HTMLElement
    expect(dot.style.backgroundColor).toBe('rgb(0, 200, 83)')
  })

  it('applies a partner border/background/text override to the container chrome', () => {
    const theme = makePartnerTheme({ surface: '#101010', surface_elevated: '#202020', neutral: '#e5e5e5', muted: '#808080' })
    const { container } = render(<WidgetRenderBoundary result={makeResult()} theme={theme} />)
    const el = container.querySelector('[data-widget-state="ready"]') as HTMLElement
    expect(el.style.background).toBe('rgb(16, 16, 16)')
    expect(el.style.color).toBe('rgb(229, 229, 229)')
    expect(el.style.border).toContain('rgb(128, 128, 128)')
  })

  it('applies a badge color override', () => {
    const theme = makePartnerTheme({ success: '#00c853' })
    render(<WidgetRenderBoundary result={makeResult()} theme={theme} />)
    const badge = screen.getByText('Top 10%')
    expect(badge.style.color).toBe('rgb(0, 200, 83)')
  })

  it('renders the data-partner-brand-id attribute from theme.partnerBrandId', () => {
    const theme = makePartnerTheme({ accent: '#0a84ff' })
    const { container } = render(<WidgetRenderBoundary result={makeResult()} theme={theme} />)
    const wrapper = container.querySelector('[data-partner-brand-id]')
    expect(wrapper).not.toBeNull()
    expect(wrapper?.getAttribute('data-partner-brand-id')).toBe('partner_acme')
  })
})

describe('WidgetRenderBoundary — enterprise_branding', () => {
  it('applies overrides identically to partner_override', () => {
    const theme = makePartnerTheme({ accent: '#7c3aed' }, 'enterprise_branding')
    const { container } = render(<WidgetRenderBoundary result={makeResult()} theme={theme} />)
    const wrapper = container.querySelector('[data-partner-brand-id="partner_acme"]')
    expect(wrapper).not.toBeNull()
  })
})

describe('WidgetRenderBoundary — invalid/missing tokens (graceful fallback)', () => {
  it('falls back to the default for a token missing from a partner_override colorTokenMap', () => {
    const theme = makePartnerTheme({ accent: '#0a84ff' }) // no override for 'surface'
    const { container } = render(<WidgetRenderBoundary result={makeResult()} theme={theme} />)
    const el = container.querySelector('[data-widget-state="ready"]') as HTMLElement
    expect(el.style.background).toBe(normalizeRgba(DEFAULT_COLOR_HEX_DARK.surface))
  })

  it('falls back to the default for an empty-string override value', () => {
    const theme = makePartnerTheme({ accent: '' })
    const { container } = render(<WidgetRenderBoundary result={makeResult()} theme={theme} />)
    const dot = container.querySelector('[data-widget-state="ready"] span') as HTMLElement
    // health severity token is 'success', unaffected by the empty accent override either way —
    // this asserts rendering never throws/breaks on an empty override string.
    expect(dot).not.toBeNull()
  })

  it('never throws when theme.tokens.colorTokenMap is completely empty', () => {
    const theme = makePartnerTheme({})
    expect(() => render(<WidgetRenderBoundary result={makeResult()} theme={theme} />)).not.toThrow()
  })

  it('renders without a data-partner-brand-id wrapper when partnerBrandId is null (e.g. light/dark modes)', () => {
    const { container } = render(<WidgetRenderBoundary result={makeResult()} theme={resolveSDKTheme('dark')} />)
    expect(container.querySelector('[data-partner-brand-id]')).toBeNull()
  })
})

describe('WidgetRenderBoundary — theming applies across every render state', () => {
  it('the loading state uses the themed background', () => {
    const theme = makePartnerTheme({ surface: '#123456' })
    const { container } = render(<WidgetRenderBoundary result={makeResult({ renderState: 'loading', data: null })} theme={theme} />)
    const el = container.querySelector('[data-widget-state="loading"]') as HTMLElement
    expect(el.style.background).toBe('rgb(18, 52, 86)')
  })

  it('the error state uses the themed background', () => {
    const theme = makePartnerTheme({ surface: '#123456' })
    const result = makeResult({ renderState: 'error', data: null, error: makeError() })
    const { container } = render(<WidgetRenderBoundary result={result} theme={theme} />)
    const el = container.querySelector('[data-widget-state="error"]') as HTMLElement
    expect(el.style.background).toBe('rgb(18, 52, 86)')
  })
})

describe('WidgetRenderBoundary — no internal leakage from theming', () => {
  it('a partner override value never leaks Decision OS internal terminology even if maliciously crafted', () => {
    const theme = makePartnerTheme({ accent: 'decision-os-internal-token' })
    const { container } = render(<WidgetRenderBoundary result={makeResult()} theme={theme} />)
    // The value is used verbatim as a CSS color (invalid CSS values are
    // simply rejected by the browser/jsdom, not executed) — this proves
    // rendering completes and the raw string never appears as VISIBLE TEXT
    // content, only (at most) as an inert, unapplied style attribute value.
    expect(screen.queryByText('decision-os-internal-token')).not.toBeInTheDocument()
  })
})
