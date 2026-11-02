import React, { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { Waivers } from '@/components/core-app/screens/Waivers'
import { WaiverFilteredList } from '@/components/core-app/WaiverLineupBoard'
import type { WaiversData } from '@/lib/core-app/waivers'
import type { WaiverBoard } from '@/lib/waivers/waiverBoard'

/**
 * The 2026-11 Waivers redesign: the KPI strip (FAAB with its budget, the next run as a tile) and the
 * filter bar over the ranked adds. Nothing here invents a figure: the "/ $100" appears only beside a real
 * league budget, and the filter only narrows the list the board already ranked.
 */

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function data(over: Partial<WaiversData> = {}): WaiversData {
  return {
    league: { id: 'L1', name: 'Sunday Night Redraft', platform: 'sleeper', format: null, platformLeagueId: 'S1' },
    budget: { available: true, data: { faabRemaining: 64, rankByBudget: 4, leagueRosters: 12, rostersWithBudget: 12 } },
    waiverPriority: { available: true, data: { priority: 9, leagueRosters: 12 } },
    rosterLoad: { available: true, data: { playersHeld: 16, starters: 9, bench: 6, reserve: 1 } },
    claimsQueued: { available: false, reason: 'x' },
    waiverType: { available: true, data: { kind: 'faab', label: 'FAAB blind bidding', budget: 100 } },
    processTime: {
      available: true,
      data: {
        schedule: { dayOfWeek: 3, time: '03:00', timeZone: 'America/Los_Angeles' },
        dayLabel: 'Wednesday',
        timeLabel: '03:00 Pacific',
        observedRuns: 6,
        fromSleeperSetting: false,
      },
    },
    tiebreak: { available: true, data: 'Rolling waiver priority' },
    claimLimits: { available: false, reason: 'x' },
    ...over,
  } as WaiversData
}

const renderWaivers = (d: WaiversData) => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})) as never)
  return render(<Waivers data={d} edge={null} edgeAccess={null} />)
}

describe('Waivers — the KPI strip', () => {
  it('says the league budget beside FAAB left, only when it is real', () => {
    const { container } = renderWaivers(data())
    expect(container.querySelector('.af-wv-tile[data-tile="faab"] .af-wv-tile-of')?.textContent).toBe(' / $100')
    cleanup()
    const { container: c2 } = renderWaivers(
      data({ waiverType: { available: true, data: { kind: 'faab', label: 'FAAB blind bidding', budget: null } } }),
    )
    expect(c2.querySelector('.af-wv-tile[data-tile="faab"] .af-wv-tile-of')).toBeNull()
  })

  it('puts FAAB, priority, the next run, claims and players held in that order', () => {
    const { container } = renderWaivers(data())
    const order = [...container.querySelectorAll('.af-wv-tiles > .af-wv-tile')].map((t) => t.getAttribute('data-tile'))
    expect(order).toEqual(['faab', 'priority', 'next-run', 'claims', 'held'])
    expect(screen.getByTestId('waiver-next-run-tile').textContent).toContain('Wednesday')
  })

  it('a schedule we have not read is the loader’s sentence, never a guessed day', () => {
    const { container } = renderWaivers(data({ processTime: { available: false, reason: 'this league has not published a schedule' } }))
    const tile = container.querySelector('.af-wv-tile[data-tile="next-run"]')
    expect(tile?.getAttribute('data-missing')).toBe('true')
    expect(tile?.textContent).toContain('this league has not published a schedule')
  })
})

type Candidate = WaiverBoard['candidates'][number]
const cand = (name: string, position: string): Candidate =>
  ({ name, position, team: 'MIA', sleeperId: name, projectedPoints: 10, gain: 2, displaces: null }) as unknown as Candidate

function Harness({ candidates }: { candidates: Candidate[] }) {
  const [query, setQuery] = useState('')
  const [pos, setPos] = useState<string | null>(null)
  return (
    <WaiverFilteredList candidates={candidates} query={query} pos={pos} onQuery={setQuery} onPos={setPos}>
      {(shown) => (
        <ul data-testid="rows">
          {shown.map((c) => (
            <li key={c.name}>{c.name}</li>
          ))}
        </ul>
      )}
    </WaiverFilteredList>
  )
}

const rows = () => [...screen.getByTestId('rows').querySelectorAll('li')].map((li) => li.textContent)

describe('Waivers — the filter bar', () => {
  const list = [cand('Jaylen Warren', 'RB'), cand('Rashid Shaheed', 'WR'), cand('Tucker Kraft', 'TE'), cand('Ray Davis', 'RB')]

  it('offers only the positions on the list, and a chip narrows to that position', () => {
    render(<Harness candidates={list} />)
    const chips = [...screen.getByTestId('waiver-filter-bar').querySelectorAll('button')].map((b) => b.textContent)
    expect(chips).toEqual(['All', 'RB', 'WR', 'TE'])
    fireEvent.click(screen.getByRole('button', { name: 'RB' }))
    expect(rows()).toEqual(['Jaylen Warren', 'Ray Davis'])
    expect(screen.getByRole('button', { name: 'RB' }).getAttribute('aria-pressed')).toBe('true')
    // Pressing the chip again clears it: the ranked order comes back untouched.
    fireEvent.click(screen.getByRole('button', { name: 'RB' }))
    expect(rows()).toEqual(['Jaylen Warren', 'Rashid Shaheed', 'Tucker Kraft', 'Ray Davis'])
  })

  it('searches by name, and an empty result says so with a way back', () => {
    render(<Harness candidates={list} />)
    fireEvent.change(screen.getByLabelText('Search by name'), { target: { value: 'shah' } })
    expect(rows()).toEqual(['Rashid Shaheed'])
    fireEvent.change(screen.getByLabelText('Search by name'), { target: { value: 'nobody' } })
    expect(screen.getByTestId('waiver-filter-empty')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }))
    expect(rows()).toHaveLength(4)
  })

  it('is not drawn for a list too short to need it', () => {
    render(<Harness candidates={list.slice(0, 2)} />)
    expect(screen.queryByTestId('waiver-filter-bar')).toBeNull()
    expect(rows()).toHaveLength(2)
  })
})
