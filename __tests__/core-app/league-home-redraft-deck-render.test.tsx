import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LeagueHome } from '@/components/core-app/screens/LeagueHome'
import { homeFixture } from '@/app/e2e/redraft-core/home/fixture'

/**
 * /core's league Home for an imported redraft league (batch B-ID): the deck renders from
 * `data.redraft` and replaces the season timeline; without it Home is exactly as before.
 * Uses the harness fixture, so the screenshots and this test exercise the same data.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch() {}, push() {}, replace() {}, refresh() {} }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams('league=e2e-redraft-core-home'),
}))

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))))
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ')

describe('LeagueHome redraft deck', () => {
  it('renders the track, score bug, playoff race (with its line) and recap for an imported redraft league', () => {
    const { data, redraftSport } = homeFixture('nba', { identity: true })
    expect(redraftSport?.sport).toBe('nba')
    const { container } = render(<LeagueHome data={data} otherLeagueIssueCount={0} identityInShell />)
    const deck = container.querySelector('[data-testid=redraft-home-deck]')
    expect(deck).not.toBeNull()
    expect(text(deck)).toContain('Redraft · 2026')
    expect(text(deck)).toContain('Regular season · week 3 of 19')
    expect(container.querySelector('[data-testid=redraft-season-track]')).not.toBeNull()
    expect(text(container.querySelector('[data-testid=redraft-score-bug]'))).toContain('Win odds')
    const race = container.querySelector('[data-testid=redraft-playoff-race]')
    expect(text(race)).toContain('Top 6 make it')
    const items = [...(race?.querySelectorAll('li') ?? [])]
    const lineAt = items.findIndex(li => li.querySelector('[role=separator]'))
    expect(lineAt).toBe(6)
    expect(text(container.querySelector('[data-testid=redraft-recap]'))).toContain('Top score')
    // The deck's track replaces the timeline panel.
    expect(container.querySelector('.af-lh-timeline-panel')).toBeNull()
  })

  it('identity off (and any non-redraft import) renders Home exactly as before: no deck, timeline back', () => {
    for (const opts of [{ identity: false }, { identity: true, leagueType: 'dynasty' }]) {
      const { data, redraftSport } = homeFixture('nfl', opts)
      expect(redraftSport).toBeNull()
      const { container, unmount } = render(<LeagueHome data={data} otherLeagueIssueCount={0} identityInShell />)
      expect(container.querySelector('[data-testid=redraft-home-deck]')).toBeNull()
      expect(container.querySelector('.af-lh')?.getAttribute('data-redraft')).toBeNull()
      expect(container.querySelector('.af-lh-timeline-panel')).not.toBeNull()
      unmount()
    }
  })

  it('a deck with no blocks still draws the track, and nothing else', () => {
    const { data } = homeFixture('nhl', { identity: true })
    const bare = { ...data, redraft: { ...data.redraft!, scoreBug: null, playoffRace: null, recap: null } }
    const { container } = render(<LeagueHome data={bare} otherLeagueIssueCount={0} identityInShell />)
    expect(container.querySelector('[data-testid=redraft-season-track]')).not.toBeNull()
    expect(container.querySelector('.af-lh-rd-grid')).toBeNull()
  })
})
