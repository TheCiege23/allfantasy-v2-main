import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import DevyCore, { type DevyCoreProps, type DevyProspect } from '@/components/core-app/screens/DevyCore'
import DevyLeagueTab, { type DevyLeagueTabProps } from '@/components/core-app/screens/DevyLeagueTab'

/**
 * The hub and the per-league tab draw an unmeasured trend the SAME way — a neutral mark titled
 * "No trend measured" — because both render through `DevyTrendMark`. Before, the hub had its own
 * `Trend` that knew no unmeasured state and would have titled it "Flat".
 */

function prospect(id: string, trend: DevyProspect['trend']): DevyProspect {
  return {
    id,
    rank: 1,
    name: `Prospect ${id}`,
    position: 'WR',
    school: 'Ohio State',
    classYear: 'SO',
    grade: 90,
    trend,
    headshotUrl: null,
    teamColor: null,
    teamAbbrev: null,
    stats: [],
    blurb: null,
  }
}

const HUB: DevyCoreProps = {
  viewState: 'populated',
  prospects: [],
  exposure: [],
  rankingsByPosition: {},
  watchlist: [],
  colleges: [],
  news: [],
}

const TAB: DevyLeagueTabProps = {
  viewState: 'populated',
  leagueName: 'Campus Kings',
  slots: [],
  freeAgents: [],
  draftRoundLabel: 'Best available',
  draftCountdown: null,
  draftBoard: [],
  news: [],
  tradeValues: [],
}

describe('devy trend mark — hub and per-league tab agree', () => {
  it('🛑 the hub draws an unmeasured trend as "No trend measured", never as Flat or an arrow', () => {
    render(<DevyCore {...HUB} prospects={[prospect('a', null), prospect('b', null)]} />)
    expect(screen.getAllByTitle('No trend measured')).toHaveLength(2)
    expect(screen.queryByTitle('Flat')).toBeNull()
    expect(screen.queryByTitle('Trending up')).toBeNull()
  })

  it('the hub and the tab produce the identical mark for the same trend', () => {
    const hub = render(<DevyCore {...HUB} prospects={[prospect('a', null)]} />)
    const hubMark = hub.getByTitle('No trend measured').outerHTML
    hub.unmount()

    const tab = render(
      <DevyLeagueTab {...TAB} tradeValues={[{ id: 'p1', player: 'Jeremiah Smith', value: 100, trend: null, status: 'Free agent' }]} />,
    )
    expect(tab.getByTitle('No trend measured').outerHTML).toBe(hubMark)
  })

  it('a measured trend still reads as one, on the hub', () => {
    render(<DevyCore {...HUB} prospects={[prospect('a', 'up'), prospect('b', 'down')]} />)
    expect(screen.getByTitle('Trending up')).toBeTruthy()
    expect(screen.getByTitle('Trending down')).toBeTruthy()
  })
})
