import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LeagueCalls } from '@/components/core-app/player-finder/LeagueCalls'
import { SwapNow } from '@/components/core-app/player-finder/SwapNow'
import type { LeagueCall } from '@/lib/core-app/leagueCall'

/* Phase 3: "Swap now" in an AllFantasy league, and one call per league with Ask Chimmy. */

const CARD = {
  actionId: 'a1',
  kind: 'lineup',
  token: 'signed-token',
  title: 'Lineup change — Week 4',
  league: { id: 'N1', name: 'My AF League', sport: 'NFL' },
  week: 4,
  season: 2026,
  expiresAt: '2026-10-25T16:30:00.000Z',
  lineup: { moveIn: [{ name: 'Tucker Kraft', position: 'TE', team: 'GB', slot: 'TE' }], moveOut: [{ name: 'Dalton Kincaid', position: 'TE', team: 'BUF' }] },
  warnings: ['Tucker Kraft is listed Questionable.'],
}

afterEach(() => vi.unstubAllGlobals())

describe('SwapNow', () => {
  it('asks for a card, shows exactly what will move, and changes NOTHING until Confirm', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('lineup-swap')
        ? { ok: true, json: async () => ({ ok: true, card: CARD }) }
        : { ok: true, json: async () => ({ ok: true, status: 'executed', message: 'Lineup saved.' }) },
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<SwapNow leagueId="N1" startId="kraft" benchId="kincaid" />)

    fireEvent.click(screen.getByRole('button', { name: 'Swap now' }))
    const card = await screen.findByRole('group', { name: 'Lineup change — Week 4' })
    expect(card).toHaveTextContent('Start Tucker Kraft at TE')
    expect(card).toHaveTextContent('Bench Dalton Kincaid')
    expect(card).toHaveTextContent('Tucker Kraft is listed Questionable.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toEqual({ leagueId: 'N1', startIds: ['kraft'], benchIds: ['kincaid'] })

    fireEvent.click(within(card).getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Lineup saved.')
    // The confirm tap sends the signed token and nothing else.
    const confirmCall = fetchMock.mock.calls[1] as unknown as [string, { body: string }]
    expect(confirmCall[0]).toBe('/api/chimmy/actions/confirm')
    expect(JSON.parse(confirmCall[1].body)).toEqual({ token: 'signed-token' })
  })

  it("shows the server's refusal as-is and lets you try again", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: false, message: "Dalton Kincaid's game has already started." }) })))
    render(<SwapNow leagueId="N1" startId="kraft" benchId="kincaid" />)
    fireEvent.click(screen.getByRole('button', { name: 'Swap now' }))
    expect(await screen.findByRole('status')).toHaveTextContent("Dalton Kincaid's game has already started.")
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('Cancel drops the card without a second request', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, card: CARD }) }))
    vi.stubGlobal('fetch', fetchMock)
    render(<SwapNow leagueId="N1" startId="kraft" benchId="kincaid" />)
    fireEvent.click(screen.getByRole('button', { name: 'Swap now' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Swap now' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('LeagueCalls', () => {
  const swap = { startId: 'kraft', startName: 'Tucker Kraft', benchId: 'kincaid', benchName: 'Dalton Kincaid' }
  const CALLS: LeagueCall[] = [
    { leagueId: 'S1', leagueName: 'KBFL', platform: 'sleeper', kind: 'hold', tone: 'good', headline: 'Keep him in', why: 'Nobody on your bench out-projects him here.', swap: null },
    { leagueId: 'N1', leagueName: 'My AF League', platform: 'manual', kind: 'sit', tone: 'bad', headline: 'Sit him — start Tucker Kraft', why: 'He is ruled out.', swap },
    { leagueId: 'E1', leagueName: 'The League', platform: 'espn', kind: 'sit', tone: 'bad', headline: 'Sit him — start Tucker Kraft', why: 'He is ruled out.', swap },
  ]

  it('puts the calls that need you first, and offers Swap now only in an AllFantasy league', () => {
    render(<LeagueCalls calls={CALLS} playerName="Dalton Kincaid" />)
    const items = screen.getAllByRole('listitem')
    expect(items.map((li) => li.getAttribute('data-kind'))).toEqual(['sit', 'sit', 'hold'])
    const native = items.find((li) => li.textContent?.includes('My AF League'))!
    const espn = items.find((li) => li.textContent?.includes('The League'))!
    expect(within(native).getByRole('button', { name: 'Swap now' })).toBeInTheDocument()
    expect(within(espn).queryByRole('button', { name: 'Swap now' })).toBeNull()
  })

  it('no Swap now on a "have X ready" hold — the call there is to keep him in', () => {
    const hold: LeagueCall = { leagueId: 'N2', leagueName: 'Native Two', platform: 'manual', kind: 'hold', tone: 'warn', headline: 'Keep him in — have Tucker Kraft ready', why: 'He is questionable…', swap }
    render(<LeagueCalls calls={[hold]} playerName="Dalton Kincaid" />)
    expect(screen.queryByRole('button', { name: 'Swap now' })).toBeNull()
  })

  it('no Swap now for an empty platform string — the server would refuse it', () => {
    render(<LeagueCalls calls={[{ ...CALLS[1], platform: '' }]} playerName="Dalton Kincaid" />)
    expect(screen.queryByRole('button', { name: 'Swap now' })).toBeNull()
  })
})
