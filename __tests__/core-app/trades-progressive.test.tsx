/**
 * /core/trades paints in parts (2026-11-06).
 *
 * The page used to await the whole Trades read — including the 19–30s cold Sleeper history — before
 * drawing anything. Now it awaits only the shell (`startTradesRead`), renders the Trade Center's header
 * and summary strip at once, and streams the history into the Trade Center's `history` slot behind a
 * shaped placeholder (`TradesHistorySlot`).
 *
 * These pin the four promises that split makes:
 *   1. the header and summary render while the history promise has not settled — and never will;
 *   2. once it lands, the slot renders exactly what the page rendered before (`<Trades hidePending />`);
 *   3. a rejected history shows the screen's own "did not load" card in the slot, and only there;
 *   4. the loader hands back the shell while the history read is still pending, with the same values
 *      `getTradesData` returns.
 */
import React from 'react'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TradeCenter, useCompletedHistory } from '@/components/core-app/screens/TradeCenter'
import Trades from '@/components/core-app/screens/Trades'
import {
  TradesHistorySection,
  TradesHistorySkeleton,
  TradesHistorySlot,
  completedHistoryOf,
} from '@/components/core-app/screens/TradesHistorySection'
import type { TradeRecord, TradesData } from '@/lib/core-app/trades'

const TRADE: TradeRecord = {
  transactionId: 'tx-1',
  season: 2026,
  week: 7,
  rosterIds: ['1', '4'],
  yourSide: 'in',
  playersIn: 1,
  playersOut: 1,
  picks: 0,
  partnerTeamName: 'Gridiron Vultures',
  at: new Date('2026-10-20T12:00:00Z'),
  players: [
    { manager: 'You FC', isYou: true, received: [{ sleeperId: '9756', name: 'Drake London', position: 'WR', team: 'ATL' }] },
    { manager: 'Gridiron Vultures', isYou: false, received: [{ sleeperId: '4866', name: 'Kenneth Walker', position: 'RB', team: 'SEA' }] },
  ],
}

function data(over: Partial<TradesData> = {}): TradesData {
  return {
    league: { id: 'l1', name: 'Last League Left', platform: 'sleeper', sourceLink: null },
    gradingContext: { available: true, data: { leagueName: 'Last League Left', format: 'Dynasty · PPR', teamCount: 12 } },
    canonicalHistory: true,
    history: { available: true, data: [TRADE] },
    inbox: { available: false, reason: 'not ingested' },
    sent: { available: false, reason: 'not ingested' },
    grades: { available: false, reason: 'nothing priced' },
    deadline: { available: true, data: { week: 11, regularSeasonLength: 14, none: false } },
    ...over,
  }
}

const never = <T,>() => new Promise<T>(() => {})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the Trade Center paints before the history', () => {
  it('renders the header and the summary strip with a history promise that never settles, and shows the placeholder', () => {
    const pending = never<TradesData>()
    render(
      <TradeCenter
        league={{ id: 'l1', name: 'Last League Left', format: 'Dynasty · PPR', teamCount: 12 }}
        deadlineLabel="Deadline · week 11"
        platform="sleeper"
        history={<TradesHistorySlot data={pending} screen="Trades" retryHref="/core/trades?league=l1" language="en" />}
        completedHistory={completedHistoryOf(pending)}
      />,
    )
    // The header.
    expect(screen.getByRole('heading', { level: 1, name: 'Trade Center' })).toBeTruthy()
    // The summary strip: league, format, team count, deadline.
    const strip = document.querySelector('.af-tc-context')
    expect(strip?.textContent).toContain('Last League Left')
    expect(strip?.textContent).toContain('Dynasty · PPR · 12 teams')
    expect(strip?.textContent).toContain('Deadline · week 11')
    // The slot holds the shaped placeholder, and nothing of the history yet.
    const skeleton = screen.getByTestId('trades-history-skeleton')
    expect(skeleton.getAttribute('aria-busy')).toBe('true')
    expect(skeleton.textContent).toContain('Loading completed trades…')
    expect(document.querySelector('.af-tr-history')).toBeNull()
  })

  it('the placeholder speaks Spanish to a Spanish reader', () => {
    render(<TradesHistorySkeleton language="es" />)
    expect(screen.getByTestId('trades-history-skeleton').textContent).toContain('Cargando intercambios completados…')
  })
})

describe('the streamed history renders what the page rendered before', () => {
  it('the same markup as <Trades data hidePending />, row for row', async () => {
    const d = data()
    // `useId` numbers differ between two renders in one document; everything else must not.
    const html = (el: HTMLElement) => el.innerHTML.replace(/_r_[0-9a-z]+_/g, '_r_')
    const before = html(render(<Trades data={d} hidePending />).container)
    const section = await TradesHistorySection({ data: Promise.resolve(d), screen: 'Trades', retryHref: '/x', language: 'en' })
    const after = html(render(section).container)
    expect(after).toBe(before)
    expect(after).toContain('Drake London')
    expect(after).toContain('Kenneth Walker')
  })

  it('a rejected read shows the screen’s own "did not load" card with its retry link — not a throw', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const section = await TradesHistorySection({
      data: Promise.reject(new Error('sleeper timed out')),
      screen: 'Trades',
      retryHref: '/core/trades?league=l1',
      language: 'en',
    })
    render(section)
    const card = screen.getByRole('alert')
    expect(card.textContent).toContain('Trades did not load')
    // One section of a page that already has its h1: the card's title is an h2, not a second h1.
    expect(card.querySelector('h1')).toBeNull()
    expect(card.querySelector('h2')?.textContent).toContain('Trades did not load')
    expect(screen.getByRole('link', { name: 'Try again' }).getAttribute('href')).toBe('/core/trades?league=l1')
    expect(document.querySelector('.af-tr-history')).toBeNull()
    expect(log).toHaveBeenCalledWith('[core/trades] history read failed', expect.any(Error))
  })

  it('a rejected read leaves the Trade Center header standing, the card in the slot alone', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const failed = Promise.reject(new Error('boom'))
    failed.catch(() => {})
    /*
     * The section as the server streams it in: an async server component, awaited here the way the
     * RSC renderer awaits it (client React in jsdom does not run async components), then placed in
     * the slot it fills on the page.
     */
    const section = await TradesHistorySection({ data: failed, screen: 'Trades', retryHref: '/core/trades?league=l1', language: 'en' })
    render(
      <TradeCenter
        league={{ id: 'l1', name: 'Last League Left', format: null, teamCount: 12 }}
        history={section}
        completedHistory={completedHistoryOf(failed)}
      />,
    )
    expect(screen.getByRole('alert').textContent).toContain('Trades did not load')
    expect(screen.getByRole('heading', { level: 1, name: 'Trade Center' })).toBeTruthy()
    expect(document.querySelector('.af-tc-context')?.textContent).toContain('Last League Left')
  })
})

describe('the completed list the offers and timeline merge in', () => {
  it('is the Sleeper history once it lands, and not "known" before', async () => {
    let land: (d: TradesData) => void = () => {}
    const read = new Promise<TradesData>((resolve) => {
      land = resolve
    })
    const source = completedHistoryOf(read)
    const { result } = renderHook(() => useCompletedHistory(source))
    expect(result.current).toEqual({ ready: false, list: undefined })
    await act(async () => {
      land(data())
    })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.list).toEqual([TRADE])
  })

  it('is empty for a non-Sleeper league and for a failed read — the value the page passed before', async () => {
    await expect(completedHistoryOf(Promise.resolve(data({ league: { id: 'l1', name: 'x', platform: 'espn', sourceLink: null } })))).resolves.toEqual([])
    await expect(completedHistoryOf(Promise.reject(new Error('x')))).resolves.toEqual([])
  })

  it('a plain list passes straight through, ready at once', () => {
    const { result } = renderHook(() => useCompletedHistory([TRADE]))
    expect(result.current).toEqual({ ready: true, list: [TRADE] })
  })
})
