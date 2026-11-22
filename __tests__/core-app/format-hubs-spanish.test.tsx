import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FormatHubData } from '@/lib/core-app/formatHubs'

const lang = vi.hoisted(() => ({ language: 'es' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: lang.language, t: (k: string) => k }),
}))

import FormatHub from '@/components/core-app/screens/FormatHub'
import { HubSwitcher } from '@/components/core-app/hubs/HubSwitcher'
import { ConnectedDecisionScopeBar } from '@/components/core-app/ConnectedDecisionScopeBar'
import { hubCopy, themeCopyEs } from '@/lib/core-app/formatHubCopy'
import { COMMS_OPEN_EVENT } from '@/components/core-app/comms/commsEvents'

afterEach(() => {
  cleanup()
  lang.language = 'es'
})

const data = (over: Partial<FormatHubData> = {}): FormatHubData => ({
  format: 'guillotine',
  counts: { zombie: 0, tournament: 0, survivor: 2, c2c: 0, guillotine: 1, efl: 0 },
  leagues: [
    {
      leagueId: 'L1',
      name: 'Chop Shop',
      platform: 'sleeper',
      sub: 'Sleeper · 12 managers',
      meter: null,
      detail: null,
      status: 'No chops yet',
      statusTone: 'muted',
      href: '/core?league=L1',
      youCommission: true,
    },
  ],
  totalLeagues: 1,
  stats: [],
  trades: { pending: [], completed: [] },
  mentions: [],
  broadcastLeagueIds: [],
  partial: false,
  ...over,
})

describe('FormatHub in Spanish', () => {
  it('renders the themed copy, switcher and card actions in Spanish', () => {
    render(<FormatHub data={data()} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Centro de ligas Guilly')
    expect(screen.getByRole('link', { name: 'Guilly' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Todas las ligas' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Comisionado' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Pendientes' })).toBeTruthy()
    expect(screen.getByText('No hay ofertas pendientes en estas ligas.')).toBeTruthy()
    expect(screen.getByText('Todavía no hay nada registrado')).toBeTruthy()
  })

  it('translates the connect panel', () => {
    render(<FormatHub data={data()} />)
    fireEvent.click(screen.getAllByRole('button', { name: '+ Conectar una liga' })[0])
    expect(screen.getByText('Trae una liga a este centro')).toBeTruthy()
    expect(screen.getByText('Crear una liga Guilly en AllFantasy')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Importar' }).getAttribute('href')).toBe('/import')
  })

  it('leaves English byte-for-byte as it was', () => {
    lang.language = 'en'
    render(<FormatHub data={data()} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Guilly League Hub')
    expect(screen.getByRole('link', { name: 'Guilly' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Commissioner' })).toBeTruthy()
  })

  it('has Spanish themed copy for every format', () => {
    const themes = themeCopyEs('Sleeper')
    for (const t of Object.values(themes)) {
      for (const v of Object.values(t)) expect(v.length).toBeGreaterThan(0)
    }
    expect(themes.c2c.foot).toContain('Sleeper')
  })
})

describe('HubSwitcher', () => {
  it('takes the language from its caller, and defaults to English', () => {
    const counts = { zombie: 1, tournament: 0, survivor: 0, c2c: 0, guillotine: 0, efl: 0 }
    const { unmount } = render(<HubSwitcher current="all" counts={counts} language="es" />)
    expect(screen.getByRole('navigation', { name: 'Centros del comisionado' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Torneo' })).toBeTruthy()
    unmount()
    render(<HubSwitcher current="all" counts={counts} />)
    expect(screen.getByRole('link', { name: 'Tournament' })).toBeTruthy()
  })
})

describe('ConnectedDecisionScopeBar in Spanish', () => {
  it('translates its labels and the Chimmy prefill', () => {
    const events: CustomEvent[] = []
    const listener = (e: Event) => events.push(e as CustomEvent)
    window.addEventListener(COMMS_OPEN_EVENT, listener)
    render(
      <ConnectedDecisionScopeBar
        linkId="F1"
        franchiseName="Dynasty Co"
        screen="my-team"
        selectedLeagueId="L1"
        sides={[{ memberId: 'm1', leagueId: 'L1', name: 'Main', platform: 'sleeper', sport: 'nfl' }]}
      />,
    )
    expect(screen.getByText('FRANQUICIA CONECTADA')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Inicio del centro' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Preguntar a Chimmy en todas' }))
    window.removeEventListener(COMMS_OPEN_EVENT, listener)
    expect(events).toHaveLength(1)
    expect(events[0].detail.prefill).toBe(
      'Usa cada plantilla seleccionada de Dynasty Co para ayudarme con esta decisión (my team).',
    )
    expect(hubCopy('Hub home', 'en')).toBe('Hub home')
  })
})
