import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CoreLeagueContextBar from '@/components/core-app/CoreLeagueContextBar'

/*
 * The /core league header's type picker, Pirate follow-up included.
 *
 * User decision 2026-09-16: a commissioner who picks Pirate must also say
 * whether rosters carry over, and nothing is saved until both are answered —
 * the API rejects Pirate without the answer, and the answer picks the value book.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch() {}, push() {}, replace() {}, refresh() {} }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams('league=lg-1'),
}))

type Call = { url: string; method: string; body: unknown }
let calls: Call[] = []
let patchStatus = 200

function stubFetch(getPayload: Record<string, unknown>) {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null })
      if (method === 'PATCH') {
        return Promise.resolve(new Response(JSON.stringify({}), { status: patchStatus }))
      }
      return Promise.resolve(new Response(JSON.stringify(getPayload), { status: 200 }))
    }),
  )
}

const patches = () => calls.filter((c) => c.method === 'PATCH')

const bar = () => (
  <CoreLeagueContextBar
    leagueId="lg-1"
    leagueName="Seven Seas"
    platform="sleeper"
    logoLetter="S"
    syncLabel="3m ago"
    syncStale={false}
    gameDayActive={false}
    surface="standings"
    decisionSlot={null}
    recommendationSlot={null}
  />
)

async function loadedTypeSelect(): Promise<HTMLSelectElement> {
  const select = (await screen.findByLabelText('League type')) as HTMLSelectElement
  await waitFor(() => expect(select).not.toBeDisabled())
  return select
}

beforeEach(() => {
  patchStatus = 200
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('league type picker — Pirate', () => {
  it('offers Pirate and EFL', async () => {
    stubFetch({ canConfirm: true, storedType: 'redraft', confirmation: null })
    render(bar())
    const select = await loadedTypeSelect()
    const values = Array.from(select.options).map((o) => o.value)
    expect(values).toEqual(expect.arrayContaining(['pirate', 'efl', 'survivor_guillotine', 'survivor', 'guillotine']))
    expect(screen.getByRole('option', { name: 'Pirate' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'EFL' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Survivor Guillotine' })).toBeInTheDocument()
  })

  it('saves Survivor Guillotine immediately as one type', async () => {
    stubFetch({ canConfirm: true, storedType: 'redraft', confirmation: null })
    render(bar())
    const select = await loadedTypeSelect()

    fireEvent.change(select, { target: { value: 'survivor_guillotine' } })

    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(patches()[0].body).toEqual({ type: 'survivor_guillotine' })
    expect(screen.queryByLabelText('Rosters carry over?')).toBeNull()
  })

  it('shows a confirmed Survivor Guillotine league as that, not as its guillotine column', async () => {
    stubFetch({
      canConfirm: false,
      storedType: 'guillotine',
      confirmation: { type: 'survivor_guillotine', baseFormat: null },
    })
    render(bar())
    expect(await screen.findByText('Survivor Guillotine')).toBeInTheDocument()
  })

  it('asks whether rosters carry over, and saves nothing until it is answered', async () => {
    stubFetch({ canConfirm: true, storedType: 'redraft', confirmation: null })
    render(bar())
    const select = await loadedTypeSelect()
    expect(screen.queryByLabelText('Rosters carry over?')).toBeNull()

    fireEvent.change(select, { target: { value: 'pirate' } })

    const base = screen.getByLabelText('Rosters carry over?') as HTMLSelectElement
    expect(base.value).toBe('')
    expect(select.value).toBe('pirate')
    expect(screen.getByRole('status')).toHaveTextContent('Pick dynasty or redraft to save')
    expect(patches()).toHaveLength(0)

    fireEvent.change(base, { target: { value: 'redraft' } })

    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(patches()[0]).toMatchObject({
      url: '/api/leagues/lg-1/league-type',
      body: { type: 'pirate', baseFormat: 'redraft' },
    })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved — trades here are graded as Pirate'))
    expect((screen.getByLabelText('Rosters carry over?') as HTMLSelectElement).value).toBe('redraft')
  })

  it('saves any other type immediately, with no base field', async () => {
    stubFetch({ canConfirm: true, storedType: 'redraft', confirmation: null })
    render(bar())
    const select = await loadedTypeSelect()

    fireEvent.change(select, { target: { value: 'efl' } })

    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(patches()[0].body).toEqual({ type: 'efl' })
    expect(screen.queryByLabelText('Rosters carry over?')).toBeNull()
  })

  it('abandons an unanswered Pirate choice when another type is picked', async () => {
    stubFetch({ canConfirm: true, storedType: 'redraft', confirmation: null })
    render(bar())
    const select = await loadedTypeSelect()

    fireEvent.change(select, { target: { value: 'pirate' } })
    fireEvent.change(select, { target: { value: 'dynasty' } })

    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(patches()[0].body).toEqual({ type: 'dynasty' })
    expect(screen.queryByLabelText('Rosters carry over?')).toBeNull()
  })

  it('shows a saved Pirate answer and lets the commissioner change it', async () => {
    stubFetch({
      canConfirm: true,
      storedType: 'pirate',
      confirmation: { type: 'pirate', baseFormat: 'dynasty' },
    })
    render(bar())
    const select = await loadedTypeSelect()
    expect(select.value).toBe('pirate')

    const base = screen.getByLabelText('Rosters carry over?') as HTMLSelectElement
    await waitFor(() => expect(base.value).toBe('dynasty'))

    fireEvent.change(base, { target: { value: 'redraft' } })
    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(patches()[0].body).toEqual({ type: 'pirate', baseFormat: 'redraft' })
  })

  it('puts the previous answer back when the save fails', async () => {
    patchStatus = 500
    stubFetch({
      canConfirm: true,
      storedType: 'pirate',
      confirmation: { type: 'pirate', baseFormat: 'dynasty' },
    })
    render(bar())
    await loadedTypeSelect()
    const base = screen.getByLabelText('Rosters carry over?') as HTMLSelectElement

    fireEvent.change(base, { target: { value: 'redraft' } })

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Could not load or save'))
    expect((screen.getByLabelText('Rosters carry over?') as HTMLSelectElement).value).toBe('dynasty')
  })

  it('shows members the type and the answer as text, with no controls', async () => {
    stubFetch({
      canConfirm: false,
      storedType: 'pirate',
      confirmation: { type: 'pirate', baseFormat: 'redraft' },
    })
    render(bar())
    expect(await screen.findByText('Pirate · Redraft')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).toBeNull()
  })
})

/*
 * 🛑 AN UNCONFIRMED LEAGUE TYPE IS SAID, AND CAN BE CONFIRMED AS SHOWN (2026-09-25). The select was
 * pre-filled with the imported guess and looked exactly like an answer; choosing the value it
 * already held fired no change, so a correct guess could never be confirmed. Every trade grade in
 * the league is priced on this type.
 */
describe('league type — confirmed or not, and why it matters', () => {
  it('🛑 an unconfirmed type says so, and one button confirms the type shown', async () => {
    stubFetch({ canConfirm: true, storedType: 'redraft', confirmation: null })
    render(bar())
    const select = await loadedTypeSelect()
    expect(select.value).toBe('redraft')
    expect(screen.getByRole('status')).toHaveTextContent(
      'Not confirmed — your league type decides how every trade in this league is graded.',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Redraft' }))
    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(patches()[0].body).toEqual({ type: 'redraft' })
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Saved — trades here are graded as Redraft'),
    )
    expect(screen.queryByRole('button', { name: /^Confirm / })).toBeNull()
  })

  it('shows the type the grades use, ahead of a stale column', async () => {
    // A Sleeper keeper league: stored `redraft`, graded as keeper.
    stubFetch({ canConfirm: true, storedType: 'redraft', gradedAs: { type: 'keeper' }, confirmation: null })
    render(bar())
    expect((await loadedTypeSelect()).value).toBe('keeper')
    expect(screen.getByRole('button', { name: 'Confirm Keeper' })).toBeInTheDocument()
  })

  it('a confirmed type offers no confirm and no warning', async () => {
    stubFetch({ canConfirm: true, storedType: 'dynasty', confirmation: { type: 'dynasty' } })
    render(bar())
    await loadedTypeSelect()
    expect(screen.queryByRole('button', { name: /^Confirm / })).toBeNull()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('a member who cannot confirm still sees it is unconfirmed, with no button that would 403', async () => {
    stubFetch({ canConfirm: false, storedType: 'redraft', confirmation: null })
    render(bar())
    expect(await screen.findByText('Redraft')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Not confirmed'))
    expect(screen.queryByRole('button', { name: /^Confirm / })).toBeNull()
  })

  it('is the target of every grade’s "Confirm your league type" link', async () => {
    stubFetch({ canConfirm: true, storedType: 'redraft', confirmation: null })
    const { container } = render(bar())
    await loadedTypeSelect()
    expect(container.querySelector('#league-type')).not.toBeNull()
  })
})
