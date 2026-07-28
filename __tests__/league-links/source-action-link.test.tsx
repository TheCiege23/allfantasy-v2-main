// @vitest-environment jsdom
/**
 * SourceActionLink — the reusable external-action button renders a hardened new-tab anchor and nothing
 * for native leagues.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SourceActionLink } from '@/components/league-links/SourceActionLink'

afterEach(cleanup)

describe('SourceActionLink', () => {
  it('renders a hardened external anchor for an imported league', () => {
    render(<SourceActionLink platform="sleeper" sourceLeagueId="131353" leagueName="HailShiva" action="lineup" />)
    const a = screen.getByRole('link', { name: /fix lineup in hailshiva/i })
    expect(a.getAttribute('href')).toBe('https://sleeper.com/leagues/131353/league')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
    expect(a.getAttribute('data-source-provider')).toBe('sleeper')
    expect(a.getAttribute('data-source-fallback')).toBe('false')
  })

  it('renders nothing for a native / unknown league', () => {
    const { container } = render(<SourceActionLink platform="allfantasy" sourceLeagueId="1" leagueName="X" />)
    expect(container.querySelector('a')).toBeNull()
  })

  it('marks a homepage fallback with data-source-fallback="true"', () => {
    render(<SourceActionLink platform="mfl" sourceLeagueId="1" leagueName="X" />)
    const a = screen.getByRole('link', { name: /go to myfantasyleague/i })
    expect(a.getAttribute('data-source-fallback')).toBe('true')
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
  })
})
