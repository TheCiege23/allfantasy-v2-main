import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import LeagueTypesFaq from '@/components/league/LeagueTypesFaq'
import LeagueTypesPage from '@/app/league-types/faq/page'
import { listLeagueFormats } from '@/lib/league/format-engine'
import { getLeagueTypeSports, LEAGUE_TYPE_PAGES } from '@/lib/seo-landing/league-type-pages'
import { LEAGUE_MODIFIER_GUIDES, LEAGUE_TYPE_GUIDES } from '@/lib/league/league-type-guide'

afterEach(() => { cleanup(); window.history.replaceState(null, '', '/league-types/faq') })

describe('public league type guide', () => {
  it('opens rules from a league deep link on arrival and when the hash changes', () => {
    window.history.replaceState(null, '', '/league-types/faq#dynasty')
    const { container } = render(<LeagueTypesPage />)
    expect(container.querySelector<HTMLDetailsElement>('#dynasty details')?.open).toBe(true)
    expect(container.querySelector<HTMLDetailsElement>('#pirate details')?.open).toBe(false)
    window.history.replaceState(null, '', '/league-types/faq#pirate')
    fireEvent(window, new HashChangeEvent('hashchange'))
    expect(container.querySelector<HTMLDetailsElement>('#pirate details')?.open).toBe(true)
    expect(container.querySelector('#survivor-guillotine')).not.toBeNull()
  })
  it('uses the same sport availability as the existing league type landers', () => {
    const { formats } = LeagueTypesPage().props
    for (const page of LEAGUE_TYPE_PAGES) {
      const format = formats.find((entry: { id: string }) => entry.id === page.wizardType)
      if (format) expect([...format.sports].sort()).toEqual(getLeagueTypeSports(page).sort())
    }
  })
  it('covers every canonical format and links every registered modifier to an explanation', () => {
    const formats = listLeagueFormats()
    expect(Object.keys(LEAGUE_TYPE_GUIDES).sort()).toEqual(formats.map((format) => format.id).sort())
    for (const format of formats) {
      const guide = LEAGUE_TYPE_GUIDES[format.id]
      expect(guide.rules.length).toBeGreaterThan(0)
      expect(guide.commissioner.length).toBeGreaterThan(0)
      for (const modifier of format.supportedModifiers) {
        expect(LEAGUE_MODIFIER_GUIDES[modifier]).toBeDefined()
      }
    }
    const { container } = render(<LeagueTypesPage />)
    expect(screen.getByRole('status').textContent).toBe(`${formats.length} of ${formats.length} formats shown`)
    for (const link of container.querySelectorAll('a[href^="#"]')) {
      expect(container.querySelector(link.getAttribute('href')!)).not.toBeNull()
    }
  })

  it('combines sport and experience filters using canonical format sports', () => {
    render(<LeagueTypesPage />)
    fireEvent.change(screen.getByLabelText('Sport'), { target: { value: 'SOCCER' } })
    expect(screen.queryByRole('heading', { name: 'Survivor', exact: true })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Devy', exact: true })).toBeNull()
    fireEvent.change(screen.getByLabelText('Experience'), { target: { value: 'Long term' } })
    expect(screen.getByRole('heading', { name: 'Dynasty', exact: true })).toBeDefined()
    expect(screen.queryByRole('heading', { name: 'Redraft', exact: true })).toBeNull()
    fireEvent.change(screen.getByLabelText('Sport'), { target: { value: 'NFL' } })
    expect(screen.getByRole('heading', { name: 'Devy', exact: true })).toBeDefined()
  })

  it('searches commissioner settings, handles whitespace and recovers from no results', () => {
    render(<LeagueTypesPage />)
    const input = screen.getByLabelText('Search formats and rules')
    fireEvent.change(input, { target: { value: '  FRANCHISE TAGS  ' } })
    expect(screen.getByRole('heading', { name: 'Salary Cap', exact: true })).toBeDefined()
    expect(screen.queryByRole('heading', { name: 'Redraft', exact: true })).toBeNull()
    fireEvent.change(input, { target: { value: 'no-such-format' } })
    expect(screen.getByText('No formats match these filters.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByRole('heading', { name: 'Redraft', exact: true })).toBeDefined()
    expect((input as HTMLInputElement).value).toBe('')
  })

  it('presents format-specific rules separately from general introductions', () => {
    const format = listLeagueFormats().find((entry) => entry.id === 'zombie')!
    render(<LeagueTypesFaq formats={[{ ...format, sports: format.supportedSports, modifiers: format.supportedModifiers }]} sports={['NFL']} />)
    const card = screen.getByRole('heading', { name: 'Zombie', exact: true }).closest('article')!
    expect(within(card).getByText('What the commissioner can configure')).toBeDefined()
    expect(within(card).getByText(/Choose universe size and Whisperer selection/)).toBeDefined()
    expect(screen.getByText(/Your league’s published settings and constitution define the exact experience/)).toBeDefined()
  })
})
