import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

import { WaiverLineupBoard } from '@/components/core-app/WaiverLineupBoard'

/**
 * The 2026-10-02 Waivers features, rendered: the league screen's bid, roster-needs strip and
 * rolling-priority line. (The cross-league board's sort / filter / show-all went with that board on
 * 2026-11-12 — /core/waivers without a league redirects to Your week.)
 */

describe('WaiverLineupBoard — bid, needs, priority', () => {
  afterEach(() => vi.unstubAllGlobals())

  const board = {
    state: 'ok', season: '2026', week: 5, currentLineupPoints: 110,
    candidates: [
      { sleeperId: '1', name: 'Top Add', position: 'RB', team: 'KC', projectedPoints: 14, gain: 6.1, displaces: null, basis: 'projection' },
      { sleeperId: '2', name: 'Next Add', position: 'WR', team: 'SF', projectedPoints: 12, gain: 5.8, displaces: null, basis: 'projection' },
    ],
    notes: [],
    needs: {
      week: 5,
      emptySlots: ['FLEX'],
      noBackup: [{ position: 'RB', rostered: 2, starting: 2 }],
      byes: [{ week: 6, players: [{ id: 'r1', name: 'Rb Starter', position: 'RB', team: 'BUF', starter: true }] }],
    },
  }
  const stubFetch = (intel: unknown) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () => (String(url).includes('waiver-intel') ? intel : board),
      })) as never,
    )

  it('prints the Waiver intelligence bid beside an add it can price, and says when it is over budget', async () => {
    stubFetch({ supported: true, intel: { bidQuotes: { '1': 30, '2': 8 } } })
    render(<WaiverLineupBoard leagueId="lg-bid" faab={{ remaining: 20 }} />)
    await waitFor(() => expect(screen.getByText(/bid ~\$8/)).toBeTruthy())
    expect(screen.getByText(/bid ~\$30 · over your \$20 left/)).toBeTruthy()
  })

  it('prints no bid at all on a league that is not FAAB, and never asks for one', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => board }))
    vi.stubGlobal('fetch', f as never)
    render(<WaiverLineupBoard leagueId="lg-nofaab" />)
    await waitFor(() => expect(screen.getByTestId('waiver-lineup-board')).toBeTruthy())
    expect(screen.queryByText(/bid ~/)).toBeNull()
    expect(f.mock.calls.some((c) => String(c[0]).includes('waiver-intel'))).toBe(false)
  })

  it('shows what the roster needs: empty slots, no backup, a starter on bye', async () => {
    stubFetch({ supported: false, platform: 'espn' })
    render(<WaiverLineupBoard leagueId="lg-needs" />)
    const strip = await screen.findByTestId('waiver-roster-needs')
    expect(strip.textContent).toContain('FLEX')
    expect(strip.textContent).toContain('No RB backup')
    expect(strip.textContent).toContain('Bye wk 6')
    expect(strip.textContent).toContain('Rb Starter (RB)')
  })

  it('on rolling priority, states what a claim costs and the gap to the next-best add', async () => {
    stubFetch({ supported: false, platform: 'espn' })
    render(<WaiverLineupBoard leagueId="lg-roll" rollingPriority={{ priority: 2, leagueRosters: 12 }} />)
    const line = await screen.findByTestId('waiver-priority-cost')
    expect(line.textContent).toContain('#2 of 12')
    expect(line.textContent).toContain('sends you to #12')
    expect(line.textContent).toContain('0.3-point gap')
  })
})
