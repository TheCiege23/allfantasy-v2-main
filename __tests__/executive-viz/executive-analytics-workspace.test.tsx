/**
 * Fantasy OS Suite — Phase V2.1: executive chart primitives.
 *
 * This suite covered the Commissioner OS executive analytics workspace on the old /commissioner-hub
 * page: four supporting cards, their builders, and the page's layout. That page and those cards were
 * retired on 2026-09-17 (the five-doors restyle). The reusable chart primitives they introduced are
 * still used by the other executive workspaces, so their tests stay.
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ExecutiveHorizontalBars, ExecutiveProgressRing } from '@/components/executive-viz/ExecutiveCharts'

describe('Executive chart primitives (Phase V2.1)', () => {
  it('ExecutiveHorizontalBars renders an accessible meter per item', () => {
    render(
      <ExecutiveHorizontalBars
        items={[
          { key: 'a', label: 'Alpha', value: 3, max: 12, status: 'at_risk', valueLabel: '3 of 12' },
          { key: 'b', label: 'Beta', value: 0, max: 12, status: 'excellent', valueLabel: '0 of 12' },
        ]}
      />,
    )
    const meters = screen.getAllByRole('meter')
    expect(meters).toHaveLength(2)
    expect(meters[0].getAttribute('aria-valuenow')).toBe('25')
  })

  it('ExecutiveProgressRing renders an accessible meter with the value', () => {
    render(<ExecutiveProgressRing value={92} status="excellent" label="Lineups set" valueLabel="92%" />)
    const meter = screen.getByRole('meter')
    expect(meter.getAttribute('aria-valuenow')).toBe('92')
    expect(meter.getAttribute('aria-label')).toContain('Lineups set')
  })
})
