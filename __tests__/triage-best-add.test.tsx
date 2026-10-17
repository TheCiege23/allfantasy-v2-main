import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'

import { Dash3ATriage, type TriageBookRow } from '@/components/core-app/screens/Dash3ATriage'
import { bestAddFrom, bestAddText } from '@/components/core-app/screens/TriageBestAdd'

const NOW = new Date('2026-10-16T13:00:00Z')

function row(over: Partial<TriageBookRow> = {}): TriageBookRow {
  return {
    initials: 'JL',
    name: 'Jeremiyah Love',
    sleeperId: '12500',
    imageUrl: null,
    leagues: [
      { id: 'g26', name: 'Guillotine League 26', platform: 'sleeper', imageUrl: null, slot: 'starter', bench: [{ name: 'Tyler Allgeier', position: 'RB' }] },
    ],
    note: 'RB · Out',
    position: 'RB',
    team: 'ARI',
    sport: 'NFL',
    status: 'Out',
    exposure: '1 of 61',
    exposureCount: 1,
    exposureTotal: 61,
    startingIn: 1,
    reportedAt: null,
    reportedAgo: null,
    nextKickoffAt: null,
    tone: 'bad',
    ...over,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('bestAddFrom / bestAddText', () => {
  it('names the top add with what he is worth to your lineup', () => {
    const add = bestAddFrom({ state: 'ok', candidates: [{ name: 'Puka Nacua', position: 'WR', gain: 6.14 }] })
    expect(add && bestAddText(add, false)).toBe('top add: Puka Nacua (WR, +6.1 pts)')
    expect(add && bestAddText(add, true)).toBe('mejor agente libre: Puka Nacua (WR, +6.1 pts)')
  })

  it('says nobody beats your lineup when the best gain is zero — not a fake add', () => {
    const add = bestAddFrom({ state: 'ok', candidates: [{ name: 'Nobody Useful', position: 'WR', gain: 0 }] })
    expect(add).toEqual({ kind: 'none' })
    expect(bestAddText(add!, false)).toBe('no free agent beats your lineup')
  })

  it('says nothing when the board could not be built', () => {
    expect(bestAddFrom({ state: 'no_projections', candidates: [] })).toBeNull()
    expect(bestAddFrom(null)).toBeNull()
  })
})

describe('the triage card asks for the best add on demand', () => {
  it('fetches this league with the injured player priced at zero, and shows the answer', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ state: 'ok', candidates: [{ name: 'Puka Nacua', position: 'WR', gain: 6.1 }] })))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<Dash3ATriage book={[row()]} now={NOW} />)
    await waitFor(() => expect(container.textContent).toContain('top add: Puka Nacua (WR, +6.1 pts)'))
    const url = String((fetchMock.mock.calls[0] as unknown[])[0])
    expect(url).toContain('view=waiver-board')
    expect(url).toContain('leagueId=g26')
    expect(url).toContain('unavailable=12500')
  })

  it('caps the asks across the whole card, so the home never fans out', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ state: 'ok', candidates: [] })))
    vi.stubGlobal('fetch', fetchMock)
    const leagues = Array.from({ length: 6 }, (_, i) => ({ id: `cap${i}`, name: `League ${i}`, platform: 'sleeper', imageUrl: null, slot: 'starter' as const }))
    render(<Dash3ATriage book={[row({ leagues, startingIn: 6 })]} now={NOW} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls.length).toBe(3)
  })

  it('asks nothing outside the NFL or without an id', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<Dash3ATriage book={[row({ sport: 'NBA', name: 'A' }), row({ sleeperId: null, name: 'B' })]} now={NOW} />)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
