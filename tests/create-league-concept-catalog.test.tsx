import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LeagueBasicsStep } from '@/components/create-league-v2/CreateLeagueWizard'
import { DEFAULT_V2_STATE } from '@/lib/create-league-v2/state'
import { getClientLeagueCreateOptionsCatalog } from '@/lib/create-league-v2/options-catalog-client'
import { IMPORT_LEAGUE_PROVIDERS } from '@/lib/create-league-v2/simple-create'
import { IMPORT_PROVIDER_UI_OPTIONS } from '@/lib/league-import/provider-ui-config'
import { getDraftTypeOptions } from '@/lib/create-league-v2/rules-engine'
import { isDraftTypeAllowedForFormat } from '@/lib/league/format-engine'
import { LEAGUE_CREATE_OPTIONS_CATALOG_V1 } from '@/lib/league-creation/options-catalog-seed-data'
import { normalizeDraftTypeForEngineValidation, resolveEffectiveDraftTypeForConcept } from '@/lib/draft-types/draftTypeRegistry'
import type { LeagueTypeId } from '@/lib/league-creation-wizard/types'

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

describe('league creation import choices', () => {
  it('links each available platform to the importer and leaves unavailable platforms disabled', () => {
    for (const option of IMPORT_PROVIDER_UI_OPTIONS) {
      const wizardOption = IMPORT_LEAGUE_PROVIDERS.find(({ id }) => id === option.provider)
      expect(wizardOption).toBeDefined()
      expect(wizardOption?.state).toBe(option.available ? 'available' : 'coming_soon')
      expect(wizardOption?.route).toBe(option.available ? `/import?provider=${option.provider}` : undefined)
    }
  })
})

describe('league creation draft choices', () => {
  it('offers supported Linear and Auction drafts for formats previously limited to Snake', () => {
    for (const [format, draftType] of [
      ['dynasty', 'linear'],
      ['dynasty', 'auction'],
      ['survivor', 'auction'],
    ] as const) {
      expect(isDraftTypeAllowedForFormat('NFL', format, draftType)).toBe(true)
      expect(getDraftTypeOptions(format, 'NFL').map(({ id }) => id)).toContain(draftType)
    }
  })

  it('keeps drafts the format engine rejects out of the wizard', () => {
    expect(isDraftTypeAllowedForFormat('NFL', 'salary_cap', 'snake')).toBe(false)
    expect(getDraftTypeOptions('salary_cap', 'NFL').map(({ id }) => id)).not.toContain('snake')
    expect(getDraftTypeOptions('salary_cap', 'NFL').map(({ id }) => id)).not.toContain('auto')
  })

  it('keeps every offered sport, format, and draft combination acceptable to the create engine', () => {
    const catalog = LEAGUE_CREATE_OPTIONS_CATALOG_V1
    for (const concept of catalog.concepts) {
      if (concept.id === 'idp') continue // IDP uses a separate redraft modifier validator.
      const leagueType = concept.id as LeagueTypeId
      for (const sport of catalog.allowedSportsByConcept[concept.id] ?? []) {
        for (const option of getDraftTypeOptions(leagueType, sport)) {
          const engineDraft = resolveEffectiveDraftTypeForConcept(
            leagueType,
            normalizeDraftTypeForEngineValidation(option.id),
          )
          expect(isDraftTypeAllowedForFormat(sport, leagueType, engineDraft),
            `${concept.id}/${sport}/${option.id} maps to ${engineDraft}`,
          ).toBe(true)
        }
      }
    }
  })
})
