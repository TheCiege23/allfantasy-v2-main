import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { LeaguesPortfolioSwitch } from '@/components/core-app/LeaguesPortfolioSwitch'

/**
 * The strip heading both views of the one My Leagues nav entry (2026-11-12): /core/leagues and
 * /core/portfolio. Each view marks itself current and links to the other.
 */
afterEach(cleanup)

const links = () =>
  screen.getAllByRole('link').map((a) => ({
    href: a.getAttribute('href'),
    text: a.textContent,
    current: a.getAttribute('aria-current'),
  }))

describe('LeaguesPortfolioSwitch', () => {
  it('on My Leagues: Leagues is current, Portfolio links out', () => {
    render(<LeaguesPortfolioSwitch current="leagues" language="en" />)
    expect(links()).toEqual([
      { href: '/core/leagues', text: 'Leagues', current: 'page' },
      { href: '/core/portfolio', text: 'Portfolio', current: null },
    ])
  })

  it('on Portfolio: Portfolio is current', () => {
    render(<LeaguesPortfolioSwitch current="portfolio" language="en" />)
    expect(links().map((l) => l.current)).toEqual([null, 'page'])
  })

  it('follows the language switch', () => {
    render(<LeaguesPortfolioSwitch current="leagues" language="es" />)
    expect(links().map((l) => l.text)).toEqual(['Ligas', 'Portafolio'])
    expect(screen.getByRole('navigation').getAttribute('aria-label')).toBe('Mis ligas')
  })
})
