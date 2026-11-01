/**
 * Lineup minimums for eliminated teams — the route (app/api/leagues/[leagueId]/eliminated-lineups) and
 * the Commissioner Hub card, in English and Spanish.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const m = vi.hoisted(() => ({
  session: vi.fn(async () => ({ user: { id: 'commish' } })),
  view: vi.fn(),
  patch: vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
}))
const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))

vi.mock('next-auth', () => ({ getServerSession: m.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/eliminated-lineups/eliminatedLineupService', () => ({ readEliminatedLineupView: m.view }))
vi.mock('@/lib/league/execute-league-settings-patch', () => ({ executeLeagueSettingsPatch: m.patch }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))

import { GET, POST } from '@/app/api/leagues/[leagueId]/eliminated-lineups/handler'
import { EliminatedLineups } from '@/components/core-app/commissioner/EliminatedLineups'

const ctx = { params: { leagueId: 'L' } }
const VIEW = {
  supported: true,
  rule: null,
  available: true,
  week: 12,
  playoffTeams: 4,
  teams: [
    {
      rosterId: 'r-c', teamName: 'Cats', reason: 'cannot_reach_line', managedByAllFantasy: false,
      shortfall: { emptySlots: 1, byeStarters: [], outStarters: [] },
      text: { en: '1 empty slot', es: '1 puesto vacío' },
    },
  ],
}

describe('the route', () => {
  beforeEach(() => vi.clearAllMocks())

  it('GET is the commissioner view; a member is refused', async () => {
    m.view.mockResolvedValueOnce({ ok: true, view: VIEW })
    const r = await GET({} as never, ctx)
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ supported: true, week: 12 })
    m.view.mockResolvedValueOnce({ ok: false, status: 403 })
    expect((await GET({} as never, ctx)).status).toBe(403)
  })

  it('POST saves through the league settings patch — the plan check, permissions, lock and audit', async () => {
    const rule = { enabled: true, standard: 'filled', autoFill: false }
    const r = await POST({ json: async () => ({ rule }) } as never, ctx)
    expect(r.status).toBe(200)
    expect(m.patch).toHaveBeenCalledWith('commish', { leagueId: 'L', settingsMerge: { eliminated_lineup_minimum: rule } })
    expect((await POST({ json: async () => ({}) } as never, ctx)).status).toBe(400)
  })

  it('refuses without a session', async () => {
    m.session.mockResolvedValueOnce(null as never)
    expect((await GET({} as never, ctx)).status).toBe(401)
  })
})

describe('the Hub card', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    lang.language = 'en'
  })

  it('shows who is out of the race and saves the rule', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => VIEW })
    render(<EliminatedLineups leagueId="L" />)
    const row = await screen.findByTestId('eliminated-lineups-team')
    expect(row.textContent).toMatch(/Cats · cannot reach the playoff line · short: 1 empty slot/)
    fireEvent.click(screen.getByLabelText('Eliminated teams must start a full lineup'))
    fireEvent.click(screen.getByLabelText('No empty slots'))
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    const [, init] = fetchMock.mock.calls[1] as [string, { method: string; body: string }]
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ rule: { enabled: true, standard: 'filled', autoFill: true } })
  })

  it('without the plan: says so, and the switch is locked', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...VIEW, available: false }) })
    render(<EliminatedLineups leagueId="L" />)
    await screen.findByTestId('eliminated-lineups-plan')
    // A disabled fieldset disables its controls without setting each one's own `disabled` property.
    expect(screen.getByLabelText('Eliminated teams must start a full lineup').matches(':disabled')).toBe(true)
    expect(screen.getByText('Save').matches(':disabled')).toBe(true)
  })

  it('renders nothing for a league the rule cannot apply to', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ supported: false, reason: 'not_native' }) })
    const { container } = render(<EliminatedLineups leagueId="L" />)
    await waitFor(() => expect(container.querySelector('[data-testid="eliminated-lineups"]')).toBeNull())
  })

  it('in Spanish', async () => {
    lang.language = 'es'
    fetchMock.mockResolvedValue({ ok: true, json: async () => VIEW })
    render(<EliminatedLineups leagueId="L" />)
    expect(screen.getByText('Alineación mínima para equipos eliminados')).toBeTruthy()
    const row = await screen.findByTestId('eliminated-lineups-team')
    expect(row.textContent).toMatch(/Cats · ya no puede clasificar · le falta: 1 puesto vacío/)
    expect(screen.getByText('Fuera de la carrera · semana 12')).toBeTruthy()
  })
})
