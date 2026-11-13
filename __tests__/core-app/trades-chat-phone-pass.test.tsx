/**
 * Phone pass, 2026-11-06 (#5 and #6). Live at 375px: completed trades were 2,500px, half the Trades
 * screen; the chat bubble sat over the roster value on My team and the win probability on Matchup.
 */
import React from 'react'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import Trades, { HISTORY_PREVIEW } from '@/components/core-app/screens/Trades'
import { useHideOnScrollDown } from '@/components/core-app/comms/CommsDock'
import type { TradeRecord, TradesData } from '@/lib/core-app/trades'

const trade = (i: number): TradeRecord => ({
  transactionId: `sleeper:tx-${i}`,
  season: 2026,
  week: 7,
  rosterIds: ['1', '4'],
  yourSide: 'in',
  playersIn: 1,
  playersOut: 1,
  picks: 0,
  partnerTeamName: `Partner ${i}`,
  at: new Date('2026-10-20T12:00:00Z'),
  players: [
    { manager: 'You FC', isYou: true, received: [{ sleeperId: String(9000 + i), name: `Got ${i}`, position: 'WR', team: 'ATL' }] },
    { manager: `Partner ${i}`, isYou: false, received: [{ sleeperId: String(8000 + i), name: `Gave ${i}`, position: 'RB', team: 'SEA' }] },
  ],
})

const data = (n: number): TradesData => ({
  league: { id: 'l1', name: 'Last League Left', platform: 'sleeper', sourceLink: null },
  gradingContext: { available: true, data: { leagueName: 'Last League Left', format: 'Dynasty · PPR', teamCount: 12 } },
  canonicalHistory: true,
  history: { available: true, data: Array.from({ length: n }, (_, i) => trade(i + 1)) },
  inbox: { available: false, reason: 'not ingested' },
  sent: { available: false, reason: 'not ingested' },
  grades: { available: false, reason: 'nothing priced' },
  deadline: { available: true, data: { week: 11, regularSeasonLength: 14, none: false } },
}) as TradesData

const cards = (c: HTMLElement) => c.querySelectorAll('#af-tr-history-list > li').length

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('completed trades show the newest few first', () => {
  it('shows the preview, then every trade behind one button, and back', () => {
    const { container } = render(<Trades data={data(12)} hidePending />)
    expect(cards(container)).toBe(HISTORY_PREVIEW)
    const more = screen.getByRole('button', { name: 'Show all 12 trades' })
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(more.getAttribute('aria-controls')).toBe('af-tr-history-list')
    fireEvent.click(more)
    expect(cards(container)).toBe(12)
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer trades' }))
    expect(cards(container)).toBe(HISTORY_PREVIEW)
  })

  it('adds no button when the history already fits', () => {
    const { container } = render(<Trades data={data(HISTORY_PREVIEW)} hidePending />)
    expect(cards(container)).toBe(HISTORY_PREVIEW)
    expect(container.querySelector('.af-tr-history-more')).toBeNull()
  })

  it('opens the full list when a ?trade= link points past the preview, so the link still lands', () => {
    window.history.replaceState(null, '', '/core/trades?league=l1&trade=tx-9')
    const { container } = render(<Trades data={data(12)} hidePending />)
    expect(cards(container)).toBe(12)
    expect(container.querySelector('[data-trade-id="tx-9"]')).not.toBeNull()
  })

  it('keeps the preview for a link to a trade already in it', () => {
    window.history.replaceState(null, '', '/core/trades?league=l1&trade=tx-2')
    const { container } = render(<Trades data={data(12)} hidePending />)
    expect(cards(container)).toBe(HISTORY_PREVIEW)
  })
})

describe('the chat bubble steps aside while reading down', () => {
  const setScroll = (y: number, height = 5000) => {
    Object.defineProperty(window, 'scrollY', { value: y, configurable: true })
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: height, configurable: true })
  }
  const scrollTo = async (y: number) => {
    setScroll(y)
    await act(async () => {
      window.dispatchEvent(new Event('scroll'))
      await new Promise((r) => setTimeout(r, 40))
    })
  }

  it('hides on a scroll down, returns on a scroll up, and always shows near the top', async () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number)
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
    setScroll(0)
    const { result } = renderHook(() => useHideOnScrollDown(true))
    expect(result.current).toBe(false)
    await scrollTo(600)
    expect(result.current).toBe(true)
    await scrollTo(400)
    expect(result.current).toBe(false)
    await scrollTo(900)
    expect(result.current).toBe(true)
    await scrollTo(20)
    expect(result.current).toBe(false)
    vi.unstubAllGlobals()
  })

  it('never hides while the drawer is open', async () => {
    setScroll(0)
    const { result } = renderHook(() => useHideOnScrollDown(false))
    await scrollTo(800)
    expect(result.current).toBe(false)
  })

  it('acts only in a top-level phone query, never mid-drag, and gives way to keyboard focus', () => {
    const css = readFileSync(resolve(process.cwd(), 'components/core-app/af-comms.css'), 'utf8').replace(/\r\n/g, '\n')
    const marker = ".af-cm-launch[data-scroll-hidden='true']:not([data-dragging='true']):not(:focus-visible)"
    const at = css.indexOf(marker)
    expect(at).toBeGreaterThan(-1)
    const start = css.lastIndexOf('@media', at)
    expect(css.slice(start, at)).toMatch(/^@media \(max-width: 720px\) \{\s*$/)
    const before = css.slice(0, start)
    expect((before.match(/\{/g) ?? []).length).toBe((before.match(/\}/g) ?? []).length)
  })
})
