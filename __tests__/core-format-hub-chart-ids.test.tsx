import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

/*
 * The chart falls back to position when a bar has no key, which stops the duplicate-key
 * warning on its own — so a render test cannot tell whether FormatHub passes ids. This
 * captures what FormatHub hands the chart instead.
 */

const seen = vi.hoisted(() => ({ data: [] as Array<Record<string, unknown>> }))
vi.mock('@/components/core-app/charts/WorkbookChart', () => ({
  WorkbookBarChart: (props: { data: Array<Record<string, unknown>> }) => {
    seen.data = props.data
    return null
  },
}))

import FormatHub from '@/components/core-app/screens/FormatHub'
import type { FormatHubData } from '@/lib/core-app/formatHubs'

describe('FormatHub → WorkbookBarChart', () => {
  it('keys each league’s bar by its league id, not its name', () => {
    const league = (leagueId: string, pct: number) => ({
      leagueId,
      name: 'Guillotine League 26',
      platform: 'sleeper',
      sub: 'Sleeper · 18 managers',
      meter: { pct, value: `${pct}%`, tone: 'accent' as const },
      detail: null,
      status: 'Chopped',
      statusTone: 'warn' as const,
      href: `/core?league=${leagueId}`,
      youCommission: false,
    })
    const data: FormatHubData = {
      format: 'guillotine',
      counts: { zombie: 0, tournament: 0, survivor: 0, c2c: 0, guillotine: 2, efl: 0 },
      leagues: [league('L1', 80), league('L2', 40)],
      totalLeagues: 2,
      stats: [],
      trades: { pending: [], completed: [] },
      mentions: [],
      broadcastLeagueIds: [],
      partial: false,
    }
    render(<FormatHub data={data} />)
    expect(seen.data.map((d) => [d.key, d.label, d.value])).toEqual([
      ['L1', 'Guillotine League 26', 80],
      ['L2', 'Guillotine League 26', 40],
    ])
  })
})
