/**
 * The lineup-impact panel's rendering rules.
 *
 * Each rule exists because breaking it prints a confident number that is wrong — a delta with no
 * unit, a blocked result that still shows a figure, "0" where the truth is "no backup at all" — so
 * every assertion is about what must NOT appear as much as what must.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  formatDelta,
  LineupImpactPanel,
  type LineupImpact,
} from '@/components/core-app/trade/LineupImpactPanel'

const impact = (over: Partial<LineupImpact> = {}): LineupImpact => ({
  startingPointsBefore: 100,
  startingPointsAfter: 119,
  startingPointsDelta: 19,
  blockedReason: null,
  unpricedExcluded: 0,
  depth: [],
  replacement: [],
  unit: 'projected_points_per_game',
  ...over,
})

describe('formatDelta', () => {
  it('signs gains and losses and uses a true minus sign', () => {
    expect(formatDelta(19)).toBe('+19.0')
    expect(formatDelta(-4.26)).toBe('−4.3')
  })

  /** ⚠ A rounding-to-zero loss must not render as "−0.0", which reads as a tiny loss. */
  it('renders a value that rounds to zero as ±0.0', () => {
    expect(formatDelta(0.02)).toBe('±0.0')
    expect(formatDelta(-0.04)).toBe('±0.0')
  })
})

describe('LineupImpactPanel', () => {
  /** 🛑 A delta without its unit invites the per-game / rest-of-season confusion. */
  it('shows the delta WITH its unit', () => {
    render(<LineupImpactPanel result={{ available: true, impact: impact() }} />)
    expect(screen.getByText('+19.0')).toBeTruthy()
    expect(screen.getByText(/projected pts \/ game/)).toBeTruthy()
  })

  it('states a zero delta as "no change" rather than hiding it', () => {
    render(
      <LineupImpactPanel
        result={{ available: true, impact: impact({ startingPointsAfter: 100, startingPointsDelta: 0 }) }}
      />,
    )
    expect(screen.getByText(/No change to your starting lineup/)).toBeTruthy()
  })

  /** 🛑 An unavailable result shows its reason and NO number at all. */
  it('renders the reason and no number when unavailable', () => {
    const { container } = render(
      <LineupImpactPanel result={{ available: false, reason: 'you are not a party to this trade' }} />,
    )
    expect(screen.getByText(/not a party to this trade/)).toBeTruthy()
    expect(container.textContent).not.toMatch(/[+−]\d/)
  })

  /** 🛑 A blocked result must not print a delta beside the reason it could not compute one. */
  it('renders the block reason and no delta when blocked', () => {
    const { container } = render(
      <LineupImpactPanel
        result={{
          available: true,
          impact: impact({ startingPointsDelta: null, blockedReason: '1 traded player(s) have no projection' }),
        }}
      />,
    )
    expect(screen.getByText(/no projection/)).toBeTruthy()
    expect(container.textContent).not.toMatch(/projected pts/)
    expect(container.querySelector('[data-state="blocked"]')).toBeTruthy()
  })

  /** ⚠ Only positions the trade CHANGES are listed — the unchanged ones are noise. */
  it('lists only the positions whose rostered count changed', () => {
    render(
      <LineupImpactPanel
        result={{
          available: true,
          impact: impact({
            depth: [
              { position: 'RB', rosteredBefore: 4, rosteredAfter: 3, rosteredDelta: -1, benchBefore: 1, benchAfter: 1, delta: 0 },
              { position: 'QB', rosteredBefore: 1, rosteredAfter: 1, rosteredDelta: 0, benchBefore: 0, benchAfter: 0, delta: 0 },
            ],
          }),
        }}
      />,
    )
    expect(screen.getByText('RB')).toBeTruthy()
    expect(screen.queryByText('QB')).toBeNull()
  })

  /** 🛑 No backup is "none", never "0.0" — zero points of cover and no cover are different facts. */
  it('renders a missing backup as none, not zero', () => {
    const { container } = render(
      <LineupImpactPanel
        result={{
          available: true,
          impact: impact({
            depth: [
              { position: 'RB', rosteredBefore: 2, rosteredAfter: 1, rosteredDelta: -1, benchBefore: 1, benchAfter: 0, delta: -1 },
            ],
            replacement: [{ position: 'RB', before: 6, after: null }],
          }),
        }}
      />,
    )
    expect(container.textContent).toMatch(/best backup 6\.0 → none/)
  })

  it('discloses unpriced players left out of the lineup', () => {
    render(<LineupImpactPanel result={{ available: true, impact: impact({ unpricedExcluded: 2 }) }} />)
    expect(screen.getByText(/2 rostered players have no projection/)).toBeTruthy()
  })

  it('does not mention unpriced players when there are none', () => {
    const { container } = render(<LineupImpactPanel result={{ available: true, impact: impact() }} />)
    expect(container.textContent).not.toMatch(/no projection/)
  })
})
