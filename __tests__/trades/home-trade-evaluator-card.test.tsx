import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import React from 'react'

import { HomeTradeEvaluatorCard } from '@/components/core-app/home/HomeTradeEvaluatorCard'

/**
 * The league trade evaluator on Home, folded to one row (2026-11-06). Closed it costs nothing — no
 * roster read — and opened it is the Trades hub's own picker and builder, not a copy of it.
 */

const LEAGUES = [
  { id: 'lg-1', name: 'Dynasty One', platform: 'sleeper', mark: 'S', meta: 'NFL · 12 teams' },
  { id: 'lg-2', name: 'Redraft Two', platform: 'sleeper', mark: 'S', meta: 'NFL · 10 teams' },
]
const ROSTERS = {
  rosters: [
    { rosterId: 'r1', platformUserId: 'u1', players: [], picks: [], teamExternalId: 't1', ownerName: 'Me Myself', avatarUrl: null, wins: 3, losses: 2, ties: 0, faabRemaining: null, canReceiveProposal: false },
    { rosterId: 'r2', platformUserId: 'u2', players: [], picks: [], teamExternalId: 't2', ownerName: 'Matt Jones', avatarUrl: null, wins: 2, losses: 3, ties: 0, faabRemaining: null, canReceiveProposal: false },
  ],
  viewerRosterId: null,
  viewerTeamRosterId: 'r1',
}

const fetchMock = vi.fn()
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false }),
  })
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string) =>
    /\/api\/leagues\/[^/]+\/trades\/rosters$/.test(String(url))
      ? { ok: true, status: 200, json: async () => ROSTERS }
      : { ok: false, status: 500, json: async () => ({}) },
  )
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const rosterReads = () => fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => u.includes('/trades/rosters'))
const open = (card: HTMLDetailsElement) => {
  card.open = true
  fireEvent(card, new Event('toggle'))
}

describe('Evaluate a trade on Home', () => {
  it('is one closed row that reads nothing until opened', () => {
    const { container } = render(<HomeTradeEvaluatorCard leagues={LEAGUES} viewerId="v1" />)
    const card = container.querySelector('[data-testid=home-trade-evaluator]') as HTMLDetailsElement
    expect(card.tagName).toBe('DETAILS')
    expect(card.open).toBe(false)
    expect(card.querySelector('summary')?.textContent).toContain('Evaluate a trade')
    expect(card.querySelector('.af-tc-hub-league-select')).toBeNull()
    expect(rosterReads()).toEqual([])
  })

  it('opens into the hub evaluator: a league picker, then that league\'s builder', async () => {
    const { container } = render(<HomeTradeEvaluatorCard leagues={LEAGUES} viewerId="v1" />)
    const card = container.querySelector('[data-testid=home-trade-evaluator]') as HTMLDetailsElement
    open(card)
    const select = card.querySelector('.af-tc-hub-league-select select') as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'Dynasty One · NFL · 12 teams',
      'Redraft Two · NFL · 10 teams',
      'Outside offer — no league',
    ])
    await waitFor(() => expect(rosterReads()).toEqual(['/api/leagues/lg-1/trades/rosters']))
    await waitFor(() => expect(card.querySelector(".af-tc-team[data-side='get'] .af-tc-partner-select select")).not.toBeNull())
  })

  it('is not drawn at all with no leagues in scope', () => {
    const { container } = render(<HomeTradeEvaluatorCard leagues={[]} viewerId="v1" />)
    expect(container.querySelector('[data-testid=home-trade-evaluator]')).toBeNull()
  })
})
