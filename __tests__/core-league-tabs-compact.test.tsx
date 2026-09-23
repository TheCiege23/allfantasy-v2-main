import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { LeagueTabs } from '@/components/core-app/LeagueTabs'

// LeagueTabsPrewarm needs an app router; see core-league-tabs-complete.test.tsx.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch() {}, push() {}, replace() {}, refresh() {} }),
}))

describe('league-first compact league tabs', () => {
  it('leads with five tabs and keeps every other view one tap away under More', () => {
    const { container } = render(
      <LeagueTabs leagueId="L 1" leagueName="Sunday Sweat" activeKey="matchup" hasScoredWeek tradeSupported draftSupported compact />,
    )
    const primary = Array.from(container.querySelectorAll('.af-lt-compact-row a')).map((a) => a.textContent)
    expect(primary).toEqual(['Match', 'Team', 'Players', 'Trades', 'League'])
    for (const label of ['Waivers', 'War Room', 'Draft HQ', 'Your week', 'Live', 'Standings', 'Outlook']) {
      expect(container.querySelector('.af-lt-more-list')!.textContent).toContain(label)
    }
    expect(screen.getByRole('link', { name: 'Match' }).getAttribute('href')).toBe('/core/matchup?league=L%201')
    expect(screen.getByRole('link', { name: 'League' }).getAttribute('href')).toBe('/core?league=L%201')
    expect(screen.getByRole('link', { name: 'Match' }).getAttribute('aria-current')).toBe('page')
  })

  it('opens More when the current view lives in it, so you can see where you are', () => {
    const { container } = render(
      <LeagueTabs leagueId="L1" leagueName="Sunday Sweat" activeKey="standings" hasScoredWeek tradeSupported draftSupported compact />,
    )
    expect(container.querySelector('details.af-lt-more')!.hasAttribute('open')).toBe(true)
  })

  it('drops a primary tab the league cannot show rather than linking to nothing', () => {
    const { container } = render(
      <LeagueTabs leagueId="L1" leagueName="Pre-draft" activeKey="home" hasScoredWeek={false} tradeSupported={false} draftSupported compact />,
    )
    const primary = Array.from(container.querySelectorAll('.af-lt-compact-row a')).map((a) => a.textContent)
    expect(primary).toEqual(['Team', 'Players', 'League'])
  })

  it('leaves the full strip alone when compact is off', () => {
    const { container } = render(
      <LeagueTabs leagueId="L1" leagueName="Sunday Sweat" activeKey="matchup" hasScoredWeek tradeSupported draftSupported />,
    )
    expect(container.querySelector('.af-lt-compact')).toBeNull()
    expect(screen.getByRole('link', { name: 'Matchup' })).toBeTruthy()
  })
})
