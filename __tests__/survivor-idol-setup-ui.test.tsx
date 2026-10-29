import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { BUNDLED_SURVIVOR_IDOL_TYPES, isSurvivorIdolTypePlayable } from '@/lib/survivor/survivorIdolTypes'
import { SurvivorIdolSetup, type SurvivorIdolSetupData } from '@/components/survivor/SurvivorIdolSetup'
import { SurvivorIdolsView } from '@/components/survivor/SurvivorIdolsView'

const types = [...BUNDLED_SURVIVOR_IDOL_TYPES]
const playable = types.filter(isSurvivorIdolTypePlayable)
const data = (patch: Partial<SurvivorIdolSetupData> = {}, config: Partial<SurvivorIdolSetupData['config']> = {}): SurvivorIdolSetupData => ({
  types, isCommissioner: true, locked: false, resolvedTypeIds: null, resolved: false, saved: false,
  config: { mode: 'random', count: 7, hideFromCommish: false, pickedTypeIds: [], pointSurgePct: 15, tributePct: 10, ...config },
  ...patch,
})

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('commissioner IdolSetup', () => {
  it('always includes the playable always-in idol, hides catalogue-only idols, and previews only playable idols', () => {
    render(<SurvivorIdolSetup leagueId="l" canEdit initialData={data()} />)
    const always = screen.getByRole('region', { name: 'Always in every league' })
    expect(within(always).getByRole('heading', { name: 'Immunity idol' })).toBeTruthy()
    // Tribe immunity has no play engine yet: it is not shown at all, not even as "coming soon".
    expect(within(always).queryByRole('heading', { name: 'Tribe immunity' })).toBeNull()
    expect(within(always).queryByText(/coming soon/i)).toBeNull()
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

  it('pick mode: a quantity per playable idol, 1 to 12 in all, the always-in idol kept at least once', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({ ok: true, json: async () => data({ saved: true }, JSON.parse(String(init?.body))) }))
    vi.stubGlobal('fetch', fetchMock)
    render(<SurvivorIdolSetup leagueId="l" canEdit initialData={data()} />)
    fireEvent.click(screen.getByRole('radio', { name: 'I’ll pick' }))
    const lock = screen.getByRole('button', { name: 'Lock idols for the draft' }) as HTMLButtonElement
    // Starts from the always-in idol alone: one idol, already lockable.
    expect(screen.getByTestId('svs-pick-total')).toHaveTextContent('1 of 12')
    expect(lock.disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'Fewer Immunity idol' }) as HTMLButtonElement).disabled).toBe(true)
    // Only playable idols are offered, with no checkbox and no "coming soon" rows.
    expect(screen.queryByRole('checkbox', { name: /Captain/ })).toBeNull()
    expect(screen.queryByRole('group', { name: "Captain's mark quantity" })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Votes' }))
    expect(screen.queryByRole('group', { name: 'Steal 3 quantity' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    fireEvent.click(screen.getByRole('button', { name: 'More Vote steal' }))
    fireEvent.click(screen.getByRole('button', { name: 'More Vote steal' }))
    fireEvent.click(screen.getByRole('button', { name: 'More Steal 3' }))
    expect(screen.getByTestId('svs-pick-total')).toHaveTextContent('4 of 12')
    expect(screen.getByRole('status', { name: 'Vote steal copies' })).toHaveTextContent('2')
    fireEvent.click(lock)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/leagues/l/survivor/idol-setup')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ mode: 'pick', count: 4, pickedTypeIds: ['immunity', 'vote-steal', 'vote-steal', 'steal-three'] })
  })

  it('pick mode stops at 12 in all', () => {
    render(<SurvivorIdolSetup leagueId="l" canEdit initialData={data({}, { mode: 'pick', count: 12, pickedTypeIds: ['immunity', ...Array(11).fill('vote-steal')] })} />)
    expect(screen.getByTestId('svs-pick-total')).toHaveTextContent('12 of 12')
    expect((screen.getByRole('button', { name: 'More Steal 3' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'More Vote steal' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Fewer Vote steal' }) as HTMLButtonElement).disabled).toBe(false)
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

  it('keeps the league Tribute value editable in the values panel only once Tribute can be played', () => {
    render(<SurvivorIdolSetup leagueId="l" canEdit initialData={data({}, { mode: 'pick', pickedTypeIds: ['immunity'], count: 1, tributePct: 12 })} />)
    expect(screen.queryByRole('heading', { name: 'Tribute' })).toBeNull()
    const values = screen.getByRole('region', { name: 'League values' })
    expect((within(values).getAllByRole('spinbutton')[1] as HTMLInputElement).value).toBe('12')
  })
})

describe('idol vault', () => {
  it('lists only the idol types in play, with the selected idol rules and the league expiry rule', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => data({ isCommissioner: false, types: playable }, { count: 7 }) })))
    render(<SurvivorIdolsView leagueId="l" names={{}} summary={{ leagueName: 'Blah Survivor', myRosterId: 'r', myIdols: [], myActiveEffects: [], config: {}, idolExpiryText: 'Play it before the tribes merge; it expires at the merge.' } as never} />)
    expect(await screen.findByText('7 sealed in Blah Survivor')).toBeTruthy()
    expect(screen.getByText(/Play it before the tribes merge/)).toBeTruthy()
    const catalog = screen.getByRole('region', { name: 'Every idol type' })
    expect(within(catalog).getAllByRole('button', { pressed: false }).filter(b => b.className === 'svv-tile')).toHaveLength(playable.length - 1)
    expect(catalog.querySelectorAll('.svv-tile .svi-soon')).toHaveLength(0)
    fireEvent.click(within(catalog).getByRole('button', { name: /^Steal 3/ }))
    const detail = screen.getByRole('complementary', { name: 'Steal 3 details' })
    expect(within(detail).queryByText('Coming soon')).toBeNull()
  })
})
