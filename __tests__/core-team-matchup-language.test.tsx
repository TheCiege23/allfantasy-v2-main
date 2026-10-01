import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { MyTeamData } from '@/lib/core-app/myTeam'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: 'es' }),
}))

import { MyTeam } from '@/components/core-app/screens/MyTeam'

describe('Core Spanish team and matchup copy', () => {
  it('renders the preseason team state and action in Spanish', () => {
    const data = {
      league: { id: 'league-1', name: 'Liga Uno', platform: 'manual', bestBall: false },
      preDraft: true,
      eliminated: false,
      completed: false,
    } as MyTeamData

    render(<MyTeam data={data} />)
    expect(screen.getByRole('heading', { name: 'Draft pendiente' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Abrir resumen de la liga' })).toHaveAttribute('href', '/core?league=league-1')
  })

  it('keeps English fallback for missing copy and translates matchup decisions', () => {
    expect(coreUiCopy('Win probability', 'es')).toBe('Probabilidad de ganar')
    expect(coreUiCopy('Projected behind by ', 'es')).toBe('Desventaja proyectada de ')
    expect(coreUiCopy('Unknown source label', 'es')).toBe('Unknown source label')
    expect(coreUiCopy('Win probability', 'en')).toBe('Win probability')
  })
})
