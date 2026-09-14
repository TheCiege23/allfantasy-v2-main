import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { DashSinceLastVisit } from '@/components/core-app/screens/DashSinceLastVisit'
import type { BriefInjury, SinceLastVisitBrief } from '@/lib/core-app/sinceLastVisit'

/*
 * The brief's injury lines for followed players (2026-09-14). A followed player on none of
 * your rosters has no league to name, so the line says "Following" — never "0 of your leagues".
 */

const NOW = new Date('2026-09-14T15:00:00Z')

function brief(injuries: BriefInjury[]): SinceLastVisitBrief {
  return {
    sinceAt: new Date(NOW.getTime() - 5 * 3_600_000).toISOString(),
    firstVisit: false,
    windowCapped: false,
    trades: { items: [], atLeast: false },
    injuries,
    standings: [],
    alerts: { total: 0, groups: [] },
    comparisonPending: false,
  }
}

const injury = (over: Partial<BriefInjury> = {}): BriefInjury => ({
  playerId: 'p1',
  name: 'Jahmyr Gibbs',
  position: 'RB',
  from: 'Questionable',
  to: 'Out',
  leagues: [],
  followed: true,
  ...over,
})

describe('DashSinceLastVisit — followed players', () => {
  it('🛑 a followed-only line says "Following", never "0 of your leagues"', () => {
    render(<DashSinceLastVisit brief={brief([injury()])} now={NOW} />)
    expect(screen.getByText(/Following/)).toBeTruthy()
    expect(screen.queryByText(/0 of your leagues/)).toBeNull()
    expect(screen.getByText(/on your rosters and players you follow/)).toBeTruthy()
  })

  it('a rostered player keeps his league name and the roster-only heading', () => {
    render(<DashSinceLastVisit brief={brief([injury({ leagues: ['Ice Kings'], followed: undefined })])} now={NOW} />)
    expect(screen.getByText(/Ice Kings/)).toBeTruthy()
    expect(screen.getByText(/injury change on your rosters$/)).toBeTruthy()
  })
})
