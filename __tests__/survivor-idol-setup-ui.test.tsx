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
  it('always includes the playable always-in idol, says Tribe immunity is coming soon, and previews only playable idols', () => {
    render(<SurvivorIdolSetup leagueId="l" canEdit initialData={data()} />)
    const always = screen.getByRole('region', { name: 'Always in every league' })
    expect(within(always).getByRole('heading', { name: 'Immunity idol' })).toBeTruthy()
    expect(within(always).queryByRole('heading', { name: 'Tribe immunity' })).toBeNull()
    expect(within(always).getByText(/Tribe immunity is coming soon/)).toBeTruthy()
    expect(screen.getByText('This league’s draw · 6 more')).toBeTruthy()
    const draw = screen.getByRole('region', { name: "This league's draw" })
    expect(within(draw).getAllByRole('heading').map(h => h.textContent).sort()).toEqual(['Extra vote', 'Steal 3', 'Vote steal'])
    // Six slots from three playable idols: the lighter two repeat (×2 or ×3), Steal 3 never does.
    const copies = within(draw).queryAllByLabelText(/copies$/).map(tag => Number(tag.textContent?.slice(1)))
    expect(copies.reduce((sum, n) => sum + n, 0) + (3 - copies.length)).toBe(6)
    fireEvent.click(screen.getByRole('radio', { name: '8' }))
    expect(screen.getByText('This league’s draw · 7 more')).toBeTruthy()
  })

  it('seals the draw from a playing commissioner', () => {
    render(<SurvivorIdolSetup leagueId="l" canEdit initialData={data()} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /Hide the draw from me too/ }))
    const draw = screen.getByRole('region', { name: "This league's draw" })
    expect(within(draw).getAllByText('Sealed idol')).toHaveLength(6)
    expect(within(draw).queryAllByRole('heading')).toHaveLength(0)
    expect(screen.getByText(/The draw is sealed/)).toBeTruthy()
  })

  it('pick mode: coming-soon idols are disabled; with 3 playable for 6 slots, pick 1 to 3 and the rest repeat', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({ ok: true, json: async () => data({ saved: true }, JSON.parse(String(init?.body))) }))
    vi.stubGlobal('fetch', fetchMock)
    render(<SurvivorIdolSetup leagueId="l" canEdit initialData={data()} />)
    fireEvent.click(screen.getByRole('radio', { name: 'I’ll pick' }))
    const lock = screen.getByRole('button', { name: 'Lock idols for the draft' }) as HTMLButtonElement
    expect(lock.disabled).toBe(true)
    expect(screen.getByText('Pick 1 to 3 · 0 picked')).toBeTruthy()
    expect(screen.getByText(/the empty slots repeat your picks/)).toBeTruthy()
    for (const name of ["Captain's mark", 'Silence', 'Point surge', 'Tribute']) {
      expect((screen.getByRole('checkbox', { name: `${name} (coming soon)` }) as HTMLInputElement).disabled).toBe(true)
    }
    expect(screen.getAllByText('Coming soon').length).toBeGreaterThanOrEqual(15)
    fireEvent.click(screen.getByRole('button', { name: 'Votes' }))
    expect(screen.queryByRole('checkbox', { name: 'Steal 3' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Vote steal' }))
    expect(lock.disabled).toBe(false)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Steal 3' }))
    fireEvent.click(lock)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/leagues/l/survivor/idol-setup')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ mode: 'pick', count: 7, pickedTypeIds: ['vote-steal', 'steal-three'] })
  })

  it('marks Point surge and Tribute values as coming soon while they have no engine', () => {
    render(<SurvivorIdolSetup leagueId="l" canEdit initialData={data()} />)
    const values = screen.getByRole('region', { name: 'League values' })
    expect(within(values).getAllByText('Coming soon')).toHaveLength(2)
    for (const input of within(values).getAllByRole('spinbutton')) expect((input as HTMLInputElement).disabled).toBe(true)
  })

  it('is read-only once the draft starts and shows the server draw instead of a preview', () => {
    const resolvedTypeIds = ['immunity', 'steal-three', 'vote-steal', 'vote-steal', 'vote-steal', 'extra-vote', 'extra-vote']
    render(<SurvivorIdolSetup leagueId="l" canEdit initialData={data({ locked: true, resolved: true, resolvedTypeIds })} />)
    expect(screen.queryByRole('button', { name: 'Lock idols for the draft' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Re-roll' })).toBeNull()
    expect((screen.getByRole('radio', { name: 'I’ll pick' }) as HTMLButtonElement).disabled).toBe(true)
    const draw = screen.getByRole('region', { name: "This league's draw" })
    expect(within(draw).getAllByRole('heading').map(h => h.textContent)).toEqual(['Steal 3', 'Vote steal', 'Extra vote'])
    expect(within(draw).getByLabelText('3 copies')).toBeTruthy()
    expect(within(draw).getByLabelText('2 copies')).toBeTruthy()
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
    expect(within(detail).getByText('Coming soon')).toBeTruthy()
    expect(within(detail).queryByRole('button', { name: /^Play/ })).toBeNull()
    expect(catalog.querySelectorAll('.svv-tile .svi-soon')).toHaveLength(16)
  })
})
