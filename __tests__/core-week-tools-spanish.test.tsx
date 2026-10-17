import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { WeekBoard as WeekBoardData, LeagueWeekBoard, RivalryRadar as RivalryRadarData } from '@/lib/core-app/weekBoard'
import type { ToolsHubData } from '@/lib/core-app/toolsHub'
import type { SeasonOutlook as SeasonOutlookData } from '@/lib/core-app/seasonOutlook'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: 'es' }),
}))

import WeekBoard from '@/components/core-app/boards/WeekBoard'
import YourWeekLeague from '@/components/core-app/screens/YourWeekLeague'
import Tools from '@/components/core-app/screens/Tools'
import RivalryRadar from '@/components/core-app/screens/RivalryRadar'
import SeasonOutlook from '@/components/core-app/screens/SeasonOutlook'

const emptyWeek = {
  season: 2026, week: 3, coinFlips: [], leaning: [], unprojected: [], eliminationWeeks: [],
  model: { basis: 'No completed weeks are on file yet, so nothing here is projected.', sampleSize: 0 },
  withoutSchedule: 0, firstKickoffAt: null,
} as unknown as WeekBoardData

describe('Spanish Core week and tools surfaces', () => {
  it('explains the zero-league week board and keeps its action links', () => {
    render(<WeekBoard board={emptyWeek} outlook={null} rivalriesHref="/r" allHref="/a" totalLeagues={0} />)
    expect(screen.getByRole('heading', { name: 'Tu semana' })).toBeTruthy()
    expect(screen.getByText('Aún no hay ligas conectadas.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Conectar una liga' })).toHaveAttribute('href', '/import')
  })

  it('explains the league week when a matchup has not synced', () => {
    const board = {
      leagueId: 'l1', leagueName: 'Liga Uno', season: 2026, week: 3, yours: null,
      sidelines: [], rivalry: null, records: {}, yourRosterId: '1', yourTeamName: null,
    } as unknown as LeagueWeekBoard
    render(<YourWeekLeague board={board} allWeeksHref="/core/week" />)
    expect(screen.getByRole('heading', { name: 'Tu semana' })).toBeTruthy()
    expect(screen.getByText(/Puede ser un descanso o un calendario incompleto/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Todas las ligas a la vez →' })).toHaveAttribute('href', '/core/week')
  })

  it('translates fixed Tools hub groups and actions', () => {
    const data = {
      groups: [{ id: 'decide', heading: 'Decide something today', note: 'Deadline-bound. Each one shows what is actually pending before you open it.', tools: [{
        id: 'waivers', title: 'Waiver Assistant', desc: 'Ranked pickups for a league, priced against your FAAB and waiver order.',
        href: '/core/waivers', live: { text: 'No waiver deadline is pending across your leagues.', tone: 'calm' }, tier: 'free', tokenCost: null,
      }] }],
      leagueScopedNote: 'Trade finder and projections are scoped to one league, so they live inside that league’s own nav rather than here — open a league from the rail and they are on its screens. They are not missing; they are somewhere a league is already selected.',
    } as unknown as ToolsHubData
    render(<Tools data={data} />)
    expect(screen.getByRole('heading', { name: 'Decide algo hoy' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Asistente de agentes libres/ })).toHaveAttribute('href', '/core/waivers')
    expect(screen.getByText('No hay plazos de reclamos pendientes en tus ligas.')).toBeTruthy()
  })

  it('explains missing rivalry history in Spanish', () => {
    const data = {
      season: 2026, week: 3, theyOwnYou: [], youOwnThem: [], even: [], oneToWatch: null,
      totals: { meetings: 0, seasons: 0, platforms: 0 }, firstKickoffAt: null,
    } as unknown as RivalryRadarData
    render(<RivalryRadar data={data} weekHref="/core/week" />)
    expect(screen.getByRole('heading', { name: 'Rivales' })).toBeTruthy()
    expect(screen.getByText('Aún no hay historial entre equipos.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Todos los enfrentamientos' })).toHaveAttribute('href', '/core/week')
  })

  it('explains missing season simulation in Spanish', () => {
    const data = {
      leagues: [], withheld: [], swingByLeague: {}, priorities: [], firstKickoffAt: null,
      summary: {}, runs: { reused: 0, computed: 0 }, basis: '',
    } as unknown as SeasonOutlookData
    render(<SeasonOutlook data={data} />)
    expect(screen.getByRole('heading', { name: 'Proyección de temporada' })).toBeTruthy()
    expect(screen.getByText('Aún no se puede simular nada.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Importar o sincronizar una liga' })).toHaveAttribute('href', '/import')
  })
})
