import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { WeekBoard } from '@/lib/core-app/weekBoard'
import type { WeekLineups } from '@/lib/core-app/weekLineups'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: 'es' }),
}))

import YourWeek from '@/components/core-app/screens/YourWeek'
import { WeekLineupLine } from '@/components/core-app/screens/WeekLineupLine'

const empty = {
  season: 2026, week: 3, coinFlips: [], leaning: [], unprojected: [], eliminationWeeks: [],
  model: { basis: '', sampleSize: 0 }, withoutSchedule: 0, firstKickoffAt: null,
} as unknown as WeekBoard

describe('Spanish Your Week screen', () => {
  it('explains missing synced matchups and keeps the import path', () => {
    render(<YourWeek data={empty} rivalriesHref="/core/week?view=rivalries" />)
    expect(screen.getByRole('heading', { name: 'Tu semana, todos los enfrentamientos' })).toBeTruthy()
    expect(screen.getByText('No hay calendario registrado para esta semana.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Importar o sincronizar una liga' })).toHaveAttribute('href', '/import')
    expect(screen.getByRole('link', { name: 'Rivales' })).toHaveAttribute('href', '/core/week?view=rivalries')
  })

  it('labels lineup projections and partial totals in Spanish', () => {
    const lineups = {
      projectionWeek: { season: '2026', week: 3 },
      byLeague: {
        l1: {
          season: 2026, week: 3, unpaired: false,
          yourProjection: { afEngine: 121.5, afProjected: 118.2, afEngineFrom: 7, pricedFrom: 9, starterCount: 9 },
          opponentProjection: { afEngine: 115, afProjected: 112.4, afEngineFrom: 9, pricedFrom: 9, starterCount: 9 },
        },
      },
    } as unknown as WeekLineups

    render(<WeekLineupLine lineups={lineups} leagueId="l1" season={2026} week={3} />)
    expect(screen.getByText('Proy. alineación')).toBeTruthy()
    expect(screen.getByText(/parcial/)).toBeTruthy()
    expect(screen.getByTitle(/Faltan proyecciones de algunos titulares/)).toBeTruthy()
  })
})
