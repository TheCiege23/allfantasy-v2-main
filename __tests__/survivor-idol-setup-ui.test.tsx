import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { BUNDLED_SURVIVOR_IDOL_TYPES } from '@/lib/survivor/survivorIdolTypes'
import { SurvivorIdolSetup, type SurvivorIdolSetupData } from '@/components/survivor/SurvivorIdolSetup'
import { SurvivorIdolsView } from '@/components/survivor/SurvivorIdolsView'

const types = [...BUNDLED_SURVIVOR_IDOL_TYPES]
const data = (patch: Partial<SurvivorIdolSetupData> = {}, config: Partial<SurvivorIdolSetupData['config']> = {}): SurvivorIdolSetupData => ({
  types, isCommissioner: true, locked: false, resolvedTypeIds: null, resolved: false, saved: false,
  config: { mode: 'random', count: 7, hideFromCommish: false, pickedTypeIds: [], pointSurgePct: 15, tributePct: 10, ...config },
  ...patch,
})

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('commissioner IdolSetup', () => {
  it('always includes Immunity and Tribe immunity and previews a balanced draw of the rest', () => {
    render(<SurvivorIdolSetup leagueId="l" canEdit initialData={data()} />)
    const always = screen.getByRole('region', { name: 'Always in every league' })
    expect(within(always).getByRole('heading', { name: 'Immunity idol' })).toBeTruthy()
    expect(within(always).getByRole('heading', { name: 'Tribe immunity' })).toBeTruthy()
    expect(within(always).getAllByText('Always in')).toHaveLength(2)
    const draw = screen.getByRole('region', { name: "This league's draw" })
    expect(within(draw).getAllByRole('heading')).toHaveLength(5)
    expect(screen.getByText('This league’s draw · 5 more')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: '8' }))
    expect(within(screen.getByRole('region', { name: "This league's draw" })).getAllByRole('heading')).toHaveLength(6)
  })

  it('seals the draw from a playing commissioner', () => {
    render(<SurvivorIdolSetup leagueId="l" canEdit initialData={data()} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /Hide the draw from me too/ }))
    const draw = screen.getByRole('region', { name: "This league's draw" })
    expect(within(draw).getAllByText('Sealed idol')).toHaveLength(5)
    expect(within(draw).queryAllByRole('heading')).toHaveLength(0)
    expect(screen.getByText(/The draw is sealed/)).toBeTruthy()
  })

  it('pick mode locks only when exactly count - 2 are picked, with category chips', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({ ok: true, json: async () => data({ saved: true }, JSON.parse(String(init?.body))) }))
    vi.stubGlobal('fetch', fetchMock)
    render(<SurvivorIdolSetup leagueId="l" canEdit initialData={data()} />)
    fireEvent.click(screen.getByRole('radio', { name: 'I’ll pick' }))
    const lock = screen.getByRole('button', { name: 'Lock idols for the draft' }) as HTMLButtonElement
    expect(lock.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Votes' }))
    expect(screen.queryByRole('checkbox', { name: 'Captain’s mark' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    for (const name of ["Captain's mark", 'Silence', 'Second chance', 'First claim']) fireEvent.click(screen.getByRole('checkbox', { name }))
    expect(lock.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Decoy' }))
    expect(lock.disabled).toBe(false)
    expect((screen.getByRole('checkbox', { name: 'Revote' }) as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(lock)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/leagues/l/survivor/idol-setup')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ mode: 'pick', count: 7, pickedTypeIds: ['captain', 'silence', 'second-chance', 'first-claim', 'decoy'] })
  })

  it('is read-only once the draft starts and shows the server draw instead of a preview', () => {
    const resolvedTypeIds = ['immunity', 'tribe-immunity', 'vote-steal', 'idol-nullifier', 'tribute', 'first-claim', 'second-chance']
    render(<SurvivorIdolSetup leagueId="l" canEdit initialData={data({ locked: true, resolved: true, resolvedTypeIds })} />)
    expect(screen.queryByRole('button', { name: 'Lock idols for the draft' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Re-roll' })).toBeNull()
    expect((screen.getByRole('radio', { name: 'I’ll pick' }) as HTMLButtonElement).disabled).toBe(true)
    const draw = screen.getByRole('region', { name: "This league's draw" })
    expect(within(draw).getAllByRole('heading').map(h => h.textContent)).toEqual(['Vote steal', 'Idol nullifier', 'Tribute', 'First claim', 'Second chance'])
  })

  it('fills the league Tribute percentage into card copy', () => {
    render(<SurvivorIdolSetup leagueId="l" canEdit initialData={data({}, { mode: 'pick', pickedTypeIds: [], tributePct: 12 })} />)
    expect(screen.getByText("Take 12% of an opponent's points.")).toBeTruthy()
  })
})

describe('idol vault', () => {
  it('shows every idol type with its tag and the selected idol rules', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => data({ isCommissioner: false }, { count: 7 }) })))
    render(<SurvivorIdolsView leagueId="l" names={{}} summary={{ leagueName: 'Blah Survivor', myRosterId: 'r', myIdols: [], myActiveEffects: [], config: {} } as never} />)
    expect(await screen.findByText('7 sealed in Blah Survivor')).toBeTruthy()
    const catalog = screen.getByRole('region', { name: 'Every idol type' })
    expect(within(catalog).getAllByRole('button', { pressed: false }).filter(b => b.className === 'svv-tile')).toHaveLength(19)
    expect(within(catalog).getAllByText('Votes · ●●○').length).toBeGreaterThan(0)
    fireEvent.click(within(catalog).getByRole('button', { name: /^Spyglass/ }))
    const detail = screen.getByRole('complementary', { name: 'Spyglass details' })
    expect(within(detail).getByText('After they vote, before the reveal')).toBeTruthy()
    expect(within(detail).queryByRole('button', { name: /^Play/ })).toBeNull()
  })
})
