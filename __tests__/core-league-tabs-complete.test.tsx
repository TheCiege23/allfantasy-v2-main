import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { LeagueTabs, describeHiddenTabs } from '@/components/core-app/LeagueTabs'

/*
 * ⚠ THE TAB BAR NOW MOUNTS A CLIENT CHILD THAT USES THE APP ROUTER.
 * `LeagueTabsPrewarm` calls `useRouter()`, which throws "invariant expected app
 * router to be mounted" outside a real router — so all four tests in this file
 * went red the moment the prewarm was added, before a single assertion ran. That
 * is the suite doing its job. It is stubbed here rather than defended against
 * inside the component: a component that works around its own missing router in
 * tests is one whose tests no longer describe production.
 *
 * `prefetch` is a no-op here on purpose. What it warms, when, and the two cases
 * where it must spend nothing are asserted against a spy in
 * `core-league-tabs-prewarm`. This file is about the tabs.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch() {}, push() {}, replace() {}, refresh() {} }),
}))

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
    expect(notes).toHaveTextContent('We couldn’t bring across trade history from Fleaflicker')
    expect(notes).toHaveTextContent('We couldn’t bring across draft results from Fleaflicker')
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
      'We couldn’t bring across trade history from ESPN for this league yet, so there is no Trades view.',
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
      'We couldn’t bring across draft results from this platform',
    )
  })
})
