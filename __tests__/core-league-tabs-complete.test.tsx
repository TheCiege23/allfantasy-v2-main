import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { LeagueTabs } from '@/components/core-app/LeagueTabs'

describe('league Core navigation', () => {
  it('keeps league context across every supported decision tab', () => {
    render(
      <LeagueTabs
        leagueId="league/with spaces"
        leagueName="AFC Dreaming"
        activeKey="waivers"
        hasScoredWeek
        tradeSupported
        draftSupported
      />,
    )

    for (const label of [
      'Overview', 'My team', 'Matchup', 'Trades', 'Waivers', 'Players', 'War Room',
      'Draft HQ', 'Your week', 'Live', 'Standings', 'Outlook',
    ]) {
      const link = screen.getByRole('link', { name: label })
      expect(link.getAttribute('href')).toContain('league=league%2Fwith%20spaces')
    }
    expect(screen.getByRole('link', { name: 'Waivers' })).toHaveAttribute('aria-current', 'page')
  })

  it('does not promise provider data the import says is unavailable', () => {
    render(
      <LeagueTabs
        leagueId="league-1"
        leagueName="Limited import"
        activeKey="home"
        hasScoredWeek={false}
        tradeSupported={false}
        draftSupported={false}
      />,
    )

    expect(screen.queryByRole('link', { name: 'Matchup' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Trades' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Draft HQ' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Waivers' })).toBeInTheDocument()
  })
})
