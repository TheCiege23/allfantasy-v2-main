// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { allStarsSGConfig } from '@/lib/survivor-guillotine/config'
import { SurvivorGuillotineLeague } from '@/components/survivor-guillotine/SurvivorGuillotineLeague'
import { SurvivorGuillotineSetup } from '@/components/survivor-guillotine/SurvivorGuillotineSetup'
vi.mock('@/components/league-settings/SurvivorGuillotineCommissionerPanel', () => ({ SurvivorGuillotineCommissionerPanel: () => null }))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/') })
const team = (id: string) => ({ legacyRosterId: id, teamName: id, ownerName: id, eliminatedAt: null })
const response = (payload: unknown, ok = true) => ({ ok, json: async () => payload })
const base = () => ({ season: { config: allStarsSGConfig(), tribes: [], periodState: null, currentPeriod: 0,
  status: 'setup', periodHistory: {}, tribeDraftState: null }, ownRoster: null, teams: [], scores: [], powers: [], chops: [] })

describe('playable combined league screens', () => {
  it('shows final-three placement names in score order', async () => {
    const data = { ...base(), season: { ...base().season, currentPeriod: 17, status: 'completed',
      periodState: { period: 17, ceremonyStarted: true, placements: ['winner', 'runner-up', 'third'], matchups: [], champions: [], sitOuts: [], priorSitOuts: [], ceremonyAt: null } },
      teams: ['third', 'winner', 'runner-up'].map(team), ownRoster: {id:'winner',players:[],dailyLineups:[],faabRemaining:100,ownBid:null} }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/operations') ? response({}, false) : response(data)))
    render(<SurvivorGuillotineLeague leagueId="L" />)
    // 2026-11-24: the podium sits at the top of the island, with places.
    const list = (await screen.findByTestId('sg-final')).querySelector('ol')!
    expect([...list.querySelectorAll('li')].map(li => li.textContent)).toEqual(['1stwinner (you)', '2ndrunner-up', '3rdthird'])
    expect(screen.queryByLabelText('Vote for captain')).toBeNull()
  })
  it('lets the on-clock Gauntlet captain make a real manager pick', async () => {
    const data = { ...base(), season: { ...base().season, currentPeriod: 10, status: 'active',
      tribes: [{ rosterId: 'captain-a', tribeId: 'gauntlet-1', captain: true }, { rosterId: 'captain-b', tribeId: 'gauntlet-2', captain: true }],
      tribeDraftState: { phase: 'gauntlet', pickMode: 'alternating', pickIndex: 0, status: 'active', leaders: [{ rosterId: 'captain-a', tribeId: 'gauntlet-1' }, { rosterId: 'captain-b', tribeId: 'gauntlet-2' }] } },
      teams: ['captain-a', 'captain-b', 'available'].map(team), ownRoster: { id: 'captain-a', players: [], dailyLineups: [], faabRemaining: 100, ownBid: null } }
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => init?.method === 'POST' ? response({ result: { pickedRosterId: 'available' } }) : url.endsWith('/operations') ? response({}, false) : response(data))
    vi.stubGlobal('fetch', fetcher)
    render(<SurvivorGuillotineLeague leagueId="L" />)
    fireEvent.change(await screen.findByLabelText('Draft manager'), { target: { value: 'available' } })
    fireEvent.click(screen.getByRole('button', { name: 'Draft manager' }))
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST' && JSON.parse(String(init.body)).action === 'captain_draft_pick' && JSON.parse(String(init.body)).rosterId === 'available')).toBe(true))
    expect(screen.getByRole('link', { name: 'Set lineup & manage roster' }).getAttribute('href')).toBe('/app/league/L?tab=roster')
  })
  it('confirms a retired-player drop and sends its idol command privately', async () => {
    const data = { ...base(), season: { ...base().season, currentPeriod: 11, status: 'active' },
      teams: [team('mine')], ownRoster: { id: 'mine', players: [{ id: 'retired', name: 'Retired Player', position: 'RB', team: null }], dailyLineups: [], faabRemaining: 100, ownBid: null },
      powers: [{ id: 'idol', kind: 'personal_immunity', binding: 'player', source: 'gauntlet_retired', status: 'held', playerId: 'retired', ownerId: 'me', expiresAfterPeriod: 13, revealed: false, targetTeamId: null }] }
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => init?.method === 'POST' ? response({ result: { reply: 'Announced' } }) : url.endsWith('/operations') ? response({}, false) : response(data))
    vi.stubGlobal('fetch', fetcher)
    render(<SurvivorGuillotineLeague leagueId="L" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Drop retired player & announce immunity' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm drop & announce Gauntlet idol' }))
    await waitFor(() => expect(fetcher.mock.calls.some(([url, init]) => url.endsWith('/chimmy') && init?.method === 'POST' && JSON.parse(String(init.body)).message === '@chimmy use idol idol')).toBe(true))
  })
  it('opens a replacement captain election after the prior captain is chopped', async () => {
    const data = { ...base(), season: { ...base().season, tribes: [{ rosterId: 'old', tribeId: 'A', captain: true }, { rosterId: 'mine', tribeId: 'A', captain: false }] },
      teams: [{ ...team('old'), eliminatedAt: '2026-11-01T00:00:00Z' }, team('mine')], chops: [{ rosterId: 'old' }],
      ownRoster: { id: 'mine', players: [], dailyLineups: [], faabRemaining: 100, ownBid: null } }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/operations') ? response({}, false) : response(data)))
    render(<SurvivorGuillotineLeague leagueId="L" />)
    const select = await screen.findByLabelText('Vote for captain') as HTMLSelectElement
    expect([...select.options].map(option => option.value)).toContain('mine')
    expect([...select.options].map(option => option.value)).not.toContain('old')
  })
  it('retains the created league for a rules-save retry instead of creating another league', async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => url === '/api/leagues'
      ? response({ league: { id: 'created' } })
      : init?.method === 'PUT' ? response({ error: 'Retry rules save' }, false) : response({}))
    vi.stubGlobal('fetch', fetcher)
    render(<SurvivorGuillotineSetup />)
    fireEvent.click(screen.getByRole('button', { name: 'Create Survivor Guilly league' }))
    await screen.findByText(/Your league was created.*Retry rules save/)
    expect(screen.queryByRole('button', { name: 'Create Survivor Guilly league' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Save to league' })).toBeTruthy()
    expect(fetcher.mock.calls.filter(([url]) => url === '/api/leagues')).toHaveLength(1)
    expect(window.location.search).toBe('?leagueId=created')
  })
})

describe('live scoring and season controls',()=>{
 it('shows the elimination hold when provider verification is delayed',async()=>{const data={...base(),providerHealth:{enabled:true,ready:false,status:'unavailable',checkedAt:new Date().toISOString()}};vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.endsWith('/operations')?response({},false):response(data)));render(<SurvivorGuillotineLeague leagueId="L"/>);await screen.findByText(/Eliminations remain on hold/);expect(screen.getByRole('region',{name:'Live scoring status'})).toBeTruthy()})
 it('sends the selected season when creating a league',async()=>{const next=new Date().getFullYear()+1,fetcher=vi.fn(async(url:string,init?:RequestInit)=>url==='/api/leagues'?response({league:{id:'new-season'}}):response({error:'saved'},false));vi.stubGlobal('fetch',fetcher);render(<SurvivorGuillotineSetup/>);fireEvent.change(screen.getByLabelText('Season'),{target:{value:String(next)}});fireEvent.click(screen.getByRole('button',{name:'Create Survivor Guilly league'}));await waitFor(()=>expect(fetcher.mock.calls.some(([url,init])=>url==='/api/leagues'&&JSON.parse(String(init?.body)).season===next)).toBe(true))})
})
