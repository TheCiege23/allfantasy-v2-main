import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { LeagueHomeData } from '@/lib/core-app/leagueHome'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: 'es' }),
}))

import { LeagueHome } from '@/components/core-app/screens/LeagueHome'

const off = { available: false as const, reason: 'Sin datos' }

describe('Spanish league overview', () => {
  it('translates the overview navigation and primary panels while preserving league identity', () => {
    const data = {
      league: { id: 'league-1', name: 'Liga Uno', platform: 'manual', currentWeek: 4 },
      pairing: null,
      syncAge: { stale: false, label: 'hace 2 min' },
      importCoverage: { sentence: null },
      yourTeam: off,
      timeline: off,
      scoreboard: off,
      powerBoard: off,
      draftHq: off,
      commissioner: off,
      standings: off,
      buzz: off,
      rivalry: off,
    } as unknown as LeagueHomeData

    render(<LeagueHome data={data} otherLeagueIssueCount={2} />)
    expect(screen.getByRole('heading', { name: 'Liga Uno' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Calendario de temporada · Liga Uno' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Esta semana en la liga' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Tabla de rendimiento' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Preguntar a Chimmy' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Conectar una liga →' })).toHaveAttribute('href', '/core/connect-leagues?league=league-1')
    expect(screen.getAllByRole('link', { name: 'Volver al inicio →' })).toHaveLength(2)
  })
})
