import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LeagueBasicsStep } from '@/components/create-league-v2/CreateLeagueWizard'
import { DEFAULT_V2_STATE } from '@/lib/create-league-v2/state'
import { getClientLeagueCreateOptionsCatalog } from '@/lib/create-league-v2/options-catalog-client'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'en' }),
}))

describe('league creation concept choices', () => {
  it('shows every active NFL concept and IDP, while keeping retired Tournament hidden', () => {
    render(<LeagueBasicsStep state={DEFAULT_V2_STATE} onChange={vi.fn()} fieldErrors={null} />)

    const catalog = getClientLeagueCreateOptionsCatalog()
    for (const concept of catalog.concepts) {
      expect(screen.getByTestId(`g30-league-type-${concept.id}`)).toBeTruthy()
    }
    expect(screen.queryByTestId('g30-league-type-tournament')).toBeNull()
  })

  it('removes concepts that the server catalog disallows for Soccer', () => {
    render(
      <LeagueBasicsStep
        state={{ ...DEFAULT_V2_STATE, sport: 'SOCCER' }}
        onChange={vi.fn()}
        fieldErrors={null}
      />,
    )

    expect(screen.getByTestId('g30-league-type-redraft')).toBeTruthy()
    expect(screen.queryByTestId('g30-league-type-idp')).toBeNull()
    expect(screen.queryByTestId('g30-league-type-guillotine')).toBeNull()
  })
})
