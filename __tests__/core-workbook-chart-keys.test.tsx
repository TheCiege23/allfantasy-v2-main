import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { render } from '@testing-library/react'

/*
 * WorkbookBarChart keyed its bars by label. Two leagues (or teams) with the same name
 * collided — seen 2026-09-17 on /core/hubs/guillotine for an account with 11 guillotine
 * leagues and 7 distinct names — and React warns and may drop or duplicate a bar.
 * Every datum can now carry its own key; without one the position disambiguates.
 */

import { WorkbookBarChart } from '@/components/core-app/charts/WorkbookChart'
import FormatHub from '@/components/core-app/screens/FormatHub'
import type { FormatHubData } from '@/lib/core-app/formatHubs'

let errors: MockInstance
beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  errors.mockRestore()
})

function keyWarnings(): string[] {
  return errors.mock.calls
    .map((args) => args.map(String).join(' '))
    .filter((line) => /same key/i.test(line))
}

describe('WorkbookBarChart keys', () => {
  it('draws two bars with the same label when each carries its own key', () => {
    const { container } = render(
      <WorkbookBarChart
        title="Points for"
        data={[
          { key: 'r1', label: 'Unnamed team', value: 120 },
          { key: 'r2', label: 'Unnamed team', value: 95 },
        ]}
      />,
    )
    expect(container.querySelectorAll('.af-workbook-column')).toHaveLength(2)
    expect([...container.querySelectorAll('.af-workbook-value')].map((n) => n.textContent)).toEqual(['120', '95'])
    expect(keyWarnings()).toEqual([])
  })

  it('still draws both when no key is given', () => {
    const { container } = render(
      <WorkbookBarChart
        title="Points for"
        data={[
          { label: 'Unnamed team', value: 120 },
          { label: 'Unnamed team', value: 95 },
        ]}
      />,
    )
    expect(container.querySelectorAll('.af-workbook-column')).toHaveLength(2)
    expect(keyWarnings()).toEqual([])
  })
})

describe('FormatHub league comparison', () => {
  const league = (leagueId: string) => ({
    leagueId,
    name: 'Guillotine League 26',
    platform: 'sleeper',
    sub: 'Sleeper · 18 managers',
    meter: { pct: leagueId === 'L1' ? 80 : 40, value: leagueId === 'L1' ? '14 of 18 left' : '7 of 18 left', tone: 'accent' as const },
    detail: null,
    status: 'Chopped',
    statusTone: 'warn' as const,
    href: `/core?league=${leagueId}`,
    youCommission: false,
  })

  it('keeps same-named leagues apart by league id', () => {
    const data: FormatHubData = {
      format: 'guillotine',
      counts: { zombie: 0, tournament: 0, survivor: 0, c2c: 0, guillotine: 2, efl: 0 },
      leagues: [league('L1'), league('L2')],
      totalLeagues: 2,
      stats: [],
      trades: { pending: [], completed: [] },
      mentions: [],
      broadcastLeagueIds: [],
      partial: false,
    }
    const { container } = render(<FormatHub data={data} />)
    const chart = container.querySelector('.af-workbook-chart')
    expect(chart?.querySelectorAll('.af-workbook-column')).toHaveLength(2)
    expect([...(chart?.querySelectorAll('.af-workbook-value') ?? [])].map((n) => n.textContent)).toEqual([
      '14 of 18 left',
      '7 of 18 left',
    ])
    expect(keyWarnings()).toEqual([])
  })
})
