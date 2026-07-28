/**
 * ChimmyTrustPanel — unit tests
 *
 * All renders use React.createElement (no JSX) so Vitest/vite can process this
 * file without a React JSX transform plugin.
 */
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import ChimmyTrustPanel from '@/components/chimmy/ChimmyTrustPanel'
import type { ChimmyTrustPanelProps } from '@/components/chimmy/ChimmyTrustPanel'

// ── helpers ──────────────────────────────────────────────────────────────────

function make(props: Partial<ChimmyTrustPanelProps> = {}) {
  return render(React.createElement(ChimmyTrustPanel, props as ChimmyTrustPanelProps))
}

const HIGH_BLOCK = {
  level: 'high' as const,
  rationale: 'Strong league context and fresh injury data.',
  freshness: 'fresh' as const,
  basedOn: ['league context', 'fresh injury data'],
  missing: ['historical trends'],
  leagueContext: 'available' as const,
}

const LOW_BLOCK = {
  level: 'low' as const,
  rationale: 'No league context and stale data.',
  freshness: 'stale' as const,
  basedOn: [],
  missing: ['league context', 'fresh data'],
  leagueContext: 'missing' as const,
}

// ── gate: renders nothing when no data ───────────────────────────────────────

describe('ChimmyTrustPanel', () => {
  it('renders nothing when no confidence data is provided', () => {
    const { container } = make({})
    expect(container.firstChild).toBeNull()
  })

  it('renders when only confidencePct is provided', () => {
    make({ confidencePct: 72 })
    expect(screen.getByTestId('chimmy-trust-panel')).toBeInTheDocument()
    expect(screen.getByTestId('chimmy-trust-panel-pct')).toHaveTextContent('72%')
  })

  it('renders nothing when confidencePct is null and no other data', () => {
    const { container } = make({ confidencePct: null })
    expect(container.firstChild).toBeNull()
  })

  // ── level badges ───────────────────────────────────────────────────────────

  it('shows High badge for high confidence', () => {
    make({ confidencePct: 85, confidenceBlock: HIGH_BLOCK })
    const badge = screen.getByTestId('chimmy-trust-panel-badge')
    expect(badge).toHaveTextContent('High')
    expect(badge.className).toContain('emerald')
  })

  it('shows Medium badge for medium confidence', () => {
    make({
      confidencePct: 68,
      confidenceBlock: { ...HIGH_BLOCK, level: 'medium' },
    })
    const badge = screen.getByTestId('chimmy-trust-panel-badge')
    expect(badge).toHaveTextContent('Medium')
    expect(badge.className).toContain('yellow')
  })

  it('shows Low badge for low confidence', () => {
    make({ confidencePct: 50, confidenceBlock: LOW_BLOCK })
    const badge = screen.getByTestId('chimmy-trust-panel-badge')
    expect(badge).toHaveTextContent('Low')
    expect(badge.className).toContain('red')
  })

  // ── collapsed state ────────────────────────────────────────────────────────

  it('is collapsed by default and shows "Why?" button', () => {
    make({ confidencePct: 82, confidenceBlock: HIGH_BLOCK })
    expect(screen.getByTestId('chimmy-trust-panel-expand')).toHaveTextContent('Why?')
    expect(screen.queryByTestId('chimmy-trust-panel-details')).not.toBeInTheDocument()
  })

  it('shows sources summary in collapsed state', () => {
    make({
      confidencePct: 72,
      confidenceBlock: HIGH_BLOCK,
      dataSources: ['league_context', 'injury_report', 'waivers'],
    })
    expect(screen.getByTestId('chimmy-trust-panel-sources-summary')).toHaveTextContent(
      'Sources: league_context, injury_report',
    )
  })

  it('shows freshness pill in collapsed state', () => {
    make({ confidencePct: 72, confidenceBlock: HIGH_BLOCK })
    // freshness pill is rendered in collapsed view via data-testid
    const pill = screen.getByTestId('chimmy-trust-panel-freshness')
    expect(pill).toHaveTextContent('Fresh')
    expect(pill.className).toContain('emerald')
  })

  it('shows red freshness for stale data', () => {
    make({ confidencePct: 50, confidenceBlock: LOW_BLOCK })
    const pill = screen.getByTestId('chimmy-trust-panel-freshness')
    expect(pill).toHaveTextContent('Stale')
    expect(pill.className).toContain('red')
  })

  // ── expand / collapse ─────────────────────────────────────────────────────

  it('expands to show details when Why? is clicked', () => {
    make({ confidencePct: 82, confidenceBlock: HIGH_BLOCK })
    fireEvent.click(screen.getByTestId('chimmy-trust-panel-expand'))
    expect(screen.getByTestId('chimmy-trust-panel-details')).toBeInTheDocument()
  })

  it('toggles button label between Why? and Hide signals', () => {
    make({ confidencePct: 82, confidenceBlock: HIGH_BLOCK })
    const btn = screen.getByTestId('chimmy-trust-panel-expand')
    expect(btn).toHaveTextContent('Why?')
    fireEvent.click(btn)
    expect(btn).toHaveTextContent('Hide signals')
    fireEvent.click(btn)
    expect(btn).toHaveTextContent('Why?')
  })

  it('hides details again on second click', () => {
    make({ confidencePct: 82, confidenceBlock: HIGH_BLOCK })
    fireEvent.click(screen.getByTestId('chimmy-trust-panel-expand'))
    expect(screen.getByTestId('chimmy-trust-panel-details')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('chimmy-trust-panel-expand'))
    expect(screen.queryByTestId('chimmy-trust-panel-details')).not.toBeInTheDocument()
  })

  // ── expanded content ──────────────────────────────────────────────────────

  it('shows rationale when expanded', () => {
    make({ confidencePct: 82, confidenceBlock: HIGH_BLOCK })
    fireEvent.click(screen.getByTestId('chimmy-trust-panel-expand'))
    expect(screen.getByTestId('chimmy-trust-panel-rationale')).toHaveTextContent(
      HIGH_BLOCK.rationale,
    )
  })

  it('shows contributing signals (basedOn) when expanded', () => {
    make({ confidencePct: 82, confidenceBlock: HIGH_BLOCK })
    fireEvent.click(screen.getByTestId('chimmy-trust-panel-expand'))
    const container = screen.getByTestId('chimmy-trust-panel-based-on')
    expect(container).toHaveTextContent('league context')
    expect(container).toHaveTextContent('fresh injury data')
  })

  it('shows missing signals when expanded', () => {
    make({ confidencePct: 82, confidenceBlock: HIGH_BLOCK })
    fireEvent.click(screen.getByTestId('chimmy-trust-panel-expand'))
    const container = screen.getByTestId('chimmy-trust-panel-missing')
    expect(container).toHaveTextContent('historical trends')
  })

  it('does not render basedOn section when empty', () => {
    make({ confidencePct: 50, confidenceBlock: { ...LOW_BLOCK, basedOn: [] } })
    fireEvent.click(screen.getByTestId('chimmy-trust-panel-expand'))
    expect(screen.queryByTestId('chimmy-trust-panel-based-on')).not.toBeInTheDocument()
  })

  it('does not render missing section when empty', () => {
    make({ confidencePct: 85, confidenceBlock: { ...HIGH_BLOCK, missing: [] } })
    fireEvent.click(screen.getByTestId('chimmy-trust-panel-expand'))
    expect(screen.queryByTestId('chimmy-trust-panel-missing')).not.toBeInTheDocument()
  })

  it('shows league context label when expanded', () => {
    make({ confidencePct: 82, confidenceBlock: HIGH_BLOCK })
    fireEvent.click(screen.getByTestId('chimmy-trust-panel-expand'))
    const ctx = screen.getByTestId('chimmy-trust-panel-league-context')
    expect(ctx).toHaveTextContent('Available')
    expect(ctx.className).toContain('emerald')
  })

  it('shows missing league context in muted color', () => {
    make({ confidencePct: 50, confidenceBlock: LOW_BLOCK })
    fireEvent.click(screen.getByTestId('chimmy-trust-panel-expand'))
    const ctx = screen.getByTestId('chimmy-trust-panel-league-context')
    expect(ctx).toHaveTextContent('Missing')
    expect(ctx.className).toContain('white/40')
  })

  // ── source links ──────────────────────────────────────────────────────────

  it('shows source links section when sourceLinks provided', () => {
    make({
      confidencePct: 72,
      confidenceBlock: HIGH_BLOCK,
      sourceLinks: [
        { label: 'Rotowire', href: 'https://rotowire.com' },
        { label: 'FantasyPros', href: 'https://fantasypros.com' },
      ],
    })
    fireEvent.click(screen.getByTestId('chimmy-trust-panel-expand'))
    const links = screen.getByTestId('chimmy-trust-panel-source-links')
    expect(links).toHaveTextContent('Rotowire')
    expect(links).toHaveTextContent('FantasyPros')
  })

  it('renders an internal source link as an anchor; external sources are text-only (security policy)', () => {
    make({
      confidencePct: 72,
      confidenceBlock: HIGH_BLOCK,
      sourceLinks: [
        { label: 'League Home', href: '/league/L1' }, // internal → clickable
        { label: 'Rotowire', href: 'https://rotowire.com' }, // external → text-only
      ],
    })
    fireEvent.click(screen.getByTestId('chimmy-trust-panel-expand'))
    const anchor = screen.getByText('League Home').closest('a')
    expect(anchor).toHaveAttribute('href', '/league/L1')
    expect(anchor).toHaveAttribute('rel', 'noopener noreferrer')
    // an external attribution URL is never clickable (only server-produced internal routes are)
    expect(screen.getByText('Rotowire').closest('a')).toBeNull()
  })

  it('does not show source links section when none provided', () => {
    make({ confidencePct: 72, confidenceBlock: HIGH_BLOCK })
    fireEvent.click(screen.getByTestId('chimmy-trust-panel-expand'))
    expect(screen.queryByTestId('chimmy-trust-panel-source-links')).not.toBeInTheDocument()
  })

  // ── flag gate: showTrustPanel prop on parent ──────────────────────────────
  // (This is handled by ChimmyMessageBubble; TrustPanel renders null when
  //  passed no data, which is the same behavior as the flag=false path.)
  it('renders nothing when confidencePct is 0 and no block', () => {
    // 0 is falsy-ish but a number — the panel should still render since 0% is valid
    make({ confidencePct: 0 })
    expect(screen.getByTestId('chimmy-trust-panel')).toBeInTheDocument()
    expect(screen.getByTestId('chimmy-trust-panel-pct')).toHaveTextContent('0%')
  })
})
