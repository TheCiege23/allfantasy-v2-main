import { fireEvent, render, screen } from '@testing-library/react'
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
    expect(primary).toEqual(['Overview', 'My Team', 'Matchup', 'Players', 'Moves'])
    for (const label of ['Waivers', 'War Room', 'Draft HQ', 'Your week', 'Schedule', 'Standings', 'Outlook']) {
      expect(container.querySelector('.af-lt-more-list')!.textContent).toContain(label)
    }
    expect(screen.getByRole('link', { name: 'Matchup' }).getAttribute('href')).toBe('/core/matchup?league=L%201')
    expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('href')).toBe('/core?league=L%201')
    expect(screen.getByRole('link', { name: 'Matchup' }).getAttribute('aria-current')).toBe('page')
  })

  it('names the active secondary view while keeping the phone menu compact', () => {
    const { container } = render(
      <LeagueTabs leagueId="L1" leagueName="Sunday Sweat" activeKey="standings" hasScoredWeek tradeSupported draftSupported compact />,
    )
    expect(container.querySelector('details.af-lt-more')!.hasAttribute('open')).toBe(false)
    expect(container.querySelector('details.af-lt-more summary')).toHaveTextContent('More · Standings')
  })

  /*
   * On a phone the More list is a dropdown over the page (af-league-tabs.css), so it
   * must close like a menu. A bare <details> closes only on its own summary.
   */
  it('closes the More menu on an outside tap, on Escape, and on picking a view', () => {
    const { container } = render(
      <div>
        <p data-testid="outside">page</p>
        <LeagueTabs leagueId="L1" leagueName="Sunday Sweat" activeKey="matchup" hasScoredWeek tradeSupported draftSupported compact />
      </div>,
    )
    const more = container.querySelector('details.af-lt-more') as HTMLDetailsElement
    const list = container.querySelector('.af-lt-more-list') as HTMLElement

    more.open = true
    fireEvent.pointerDown(list)
    expect(more.open).toBe(true)
    fireEvent.pointerDown(screen.getByTestId('outside'))
    expect(more.open).toBe(false)

    more.open = true
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(more.open).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(more.open).toBe(false)

    more.open = true
    fireEvent.click(screen.getByRole('link', { name: 'Standings' }))
    expect(more.open).toBe(false)
  })

  it('keeps the active view in its own span, so a phone can drop it and keep More one tab wide', () => {
    const { container } = render(
      <LeagueTabs leagueId="L1" leagueName="Sunday Sweat" activeKey="standings" hasScoredWeek tradeSupported draftSupported compact />,
    )
    expect(container.querySelector('summary .af-lt-more-active')).toHaveTextContent('· Standings')
  })

  it('drops a primary tab the league cannot show rather than linking to nothing', () => {
    const { container } = render(
      <LeagueTabs leagueId="L1" leagueName="Pre-draft" activeKey="home" hasScoredWeek={false} tradeSupported={false} draftSupported compact />,
    )
    const primary = Array.from(container.querySelectorAll('.af-lt-compact-row a')).map((a) => a.textContent)
    expect(primary).toEqual(['Overview', 'My Team', 'Players', 'Moves'])
  })

  it('keeps the primary workflow consistent when compact is off', () => {
    const { container } = render(
      <LeagueTabs leagueId="L1" leagueName="Sunday Sweat" activeKey="matchup" hasScoredWeek tradeSupported draftSupported />,
    )
    expect(container.querySelector('.af-lt-compact')).not.toBeNull()
    expect(screen.getByRole('link', { name: 'Matchup' })).toBeTruthy()
  })
})
