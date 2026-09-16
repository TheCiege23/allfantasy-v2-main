import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { LeagueTabs, describeHiddenTabs } from '@/components/core-app/LeagueTabs'

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

  /*
   * ⚠ THE TEST ABOVE PASSES WITH THE EXPLANATION DELETED, which is why these
   * exist. It asserts only that the tabs are gone — the state a reader
   * experiences as "half my navigation vanished" — and it was green for the
   * whole period in which nothing anywhere said why.
   */
  it('says why a removed view is removed, and names the platform', () => {
    render(
      <LeagueTabs
        leagueId="league-1"
        leagueName="Limited import"
        activeKey="home"
        hasScoredWeek
        tradeSupported={false}
        draftSupported={false}
        platform="Fleaflicker"
      />,
    )

    const notes = screen.getByRole('list', { name: 'Views not available for this league' })
    expect(notes).toHaveTextContent('Fleaflicker doesn’t publish trade history')
    expect(notes).toHaveTextContent('Fleaflicker doesn’t publish draft results')
  })

  it('stays silent when every view is available', () => {
    render(
      <LeagueTabs
        leagueId="league-1"
        leagueName="Full import"
        activeKey="home"
        hasScoredWeek
        tradeSupported
        draftSupported
        platform="Sleeper"
      />,
    )

    expect(
      screen.queryByRole('list', { name: 'Views not available for this league' }),
    ).not.toBeInTheDocument()
  })
})

describe('describeHiddenTabs', () => {
  const full = { hasScoredWeek: true, tradeSupported: true, draftSupported: true }

  it('separates our temporary gap from the platform’s permanent one', () => {
    const notes = describeHiddenTabs({ ...full, hasScoredWeek: false, platform: 'Sleeper' })
    expect(notes).toHaveLength(1)
    /* Ours, and it resolves on its own — so it must not blame the provider. */
    expect(notes[0]).toContain('scored week')
    expect(notes[0]).not.toContain('Sleeper')
  })

  it('names the provider for a limit that is the provider’s', () => {
    expect(describeHiddenTabs({ ...full, tradeSupported: false, platform: 'ESPN' })[0]).toBe(
      'ESPN doesn’t publish trade history, so there is no Trades view for this league.',
    )
  })

  /*
   * 🛑 THE `null` CASE IS THE ONE THAT MATTERS AND IT IS INVISIBLE IN THE UI.
   * `leagueHasScoredWeek` is null when `getLeagueDataSignals` caught its own
   * failure — a read we did not complete, not a season that has not started.
   * Both render the same absence of a note; only this asserts the difference,
   * and a `!hasScoredWeek` truthiness check would tell a mid-season league that
   * none of its weeks had been scored.
   */
  it('claims nothing about scored weeks when the signal was never read', () => {
    expect(describeHiddenTabs({ ...full, hasScoredWeek: null })).toEqual([])
  })

  it('falls back to a neutral subject rather than printing an empty platform', () => {
    expect(describeHiddenTabs({ ...full, draftSupported: false, platform: '' })[0]).toContain(
      'This platform doesn’t publish draft results',
    )
  })
})
