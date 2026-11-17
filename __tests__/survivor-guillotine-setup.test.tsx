import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SurvivorGuillotineSetup } from '@/components/survivor-guillotine/SurvivorGuillotineSetup'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/') })

describe('Survivor Guilly commissioner workshop', () => {
  it('opens with a valid football schedule and alternating Gauntlet draft', () => {
    render(<SurvivorGuillotineSetup />)
    expect(screen.getByText('Season fits · three finalists remain')).toBeTruthy()
    expect((screen.getByLabelText('New tribe draft') as HTMLSelectElement).value).toBe('alternating')
    expect((screen.getByRole('button', { name: 'Export season rules' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByLabelText('Allow trading (off by default)') as HTMLInputElement).checked).toBe(false)
  })
  it('blocks exporting an impossible schedule and allows correcting it', () => {
    render(<SurvivorGuillotineSetup />)
    fireEvent.change(screen.getByLabelText('Starting managers'), { target: { value: '24' } })
    expect(screen.getByText(/Schedule leaves 5 finalists/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Export season rules' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Starting managers'), { target: { value: '22' } })
    expect(screen.getByText('Season fits · three finalists remain')).toBeTruthy()
  })
  it('supports NBA scoring controls and an All-Star no-elimination period', () => {
    render(<SurvivorGuillotineSetup />)
    fireEvent.change(screen.getByLabelText('Sport'), { target: { value: 'NBA' } })
    expect(screen.getByRole('heading', { name: 'NBA scoring calendar' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Championship scoring period'), { target: { value: '18' } })
    fireEvent.change(screen.getByLabelText('Period 8 format'), { target: { value: 'off' } })
    expect(screen.getByText('Season fits · three finalists remain')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Weekly scoring'), { target: { value: 'capped_games' } })
    expect(screen.getByLabelText('Player games per team / period')).toBeTruthy()
  })
  it('creates a league, saves Survivor rules, then exposes its invite link', async () => {
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/leagues') return { ok: true, json: async () => ({ success: true, league: { id: 'new-league' } }) }
      if (options?.method === 'PUT') return { ok: true, json: async () => ({ result: { revision: 1 } }) }
      if (url.startsWith('/api/leagues/join?')) return { ok: true, json: async () => ({ inviteLink: 'https://example.test/join?code=ABC' }) }
      return { ok: false, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<SurvivorGuillotineSetup />)
    fireEvent.change(screen.getByLabelText('League name'), { target: { value: 'Island League' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Survivor Guilly league' }))
    expect(await screen.findByRole('link', { name: 'https://example.test/join?code=ABC' })).toBeTruthy()
    const createCall = fetchMock.mock.calls.find(([url]) => url === '/api/leagues')!
    const rulesCall = fetchMock.mock.calls.find(([, options]) => options?.method === 'PUT')!
    expect(JSON.parse(createCall[1]!.body as string)).toMatchObject({
      concept: 'redraft', sport: 'NFL', teamCount: 22, leagueName: 'Island League', draftType: 'snake',
    })
    expect(JSON.parse(rulesCall[1]!.body as string)).toMatchObject({ action: 'rules', config: { teamCount: 22 } })
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/leagues/join?leagueId=new-league')).toBe(true)
  })
})
