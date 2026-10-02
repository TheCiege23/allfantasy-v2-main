import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

/*
 * AllFantasy's own engine on the two waiver surfaces — the cross-league Waivers board and the
 * per-league "who is worth adding" panel. Display only: the provider figure still picks the add,
 * the drop and the ranking; AF sits beside it in the same league's points.
 */

const h = vi.hoisted(() => ({ engine: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/core-app/playerProjections', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core-app/playerProjections')>()),
  lookupAfEngineProjections: h.engine,
}))

import { attachAfEngine, type WaiverBoardRow, type WaiverPlayer } from '@/lib/core-app/waiversBoard'
import { WaiverLineupBoard } from '@/components/core-app/WaiverLineupBoard'

const player = (id: string, projected: number): WaiverPlayer => ({
  playerId: id, name: id, position: 'WR', team: 'KC', imageUrl: null, projected, ownPct: null, startPct: null,
})
/* `over` is the starter the add displaces — the other side of the lineup-gain swap the pill ranks on. */
const row = (add: WaiverPlayer, over: WaiverPlayer | null, drop: WaiverPlayer | null = null): WaiverBoardRow => ({
  leagueId: 'L', leagueName: 'L', platform: 'sleeper', platformLeagueId: 'P', logoUrl: null, format: null,
  netGain: add.projected - (over?.projected ?? 0),
  startsOver: over ? { playerId: over.playerId, name: over.name, projected: over.projected } : null,
  add, drop, faabRemaining: null, runsAt: null, href: '/', reasoning: '',
})
const engineRow = (id: string, pts: number) => [id, { playerId: id, projectedPoints: pts, basis: null, confidence: null }] as const

beforeEach(() => h.engine.mockReset())

describe('attachAfEngine — the cross-league Waivers board', () => {
  it('scales each AF figure into the league by the provider line, and nets the add against the starter he displaces', async () => {
    // add: provider 10 PPR -> 12 league; engine 15 -> 15 x 12/10 = 18. over: 8 -> 8 league; engine 6 -> 6.
    h.engine.mockResolvedValue(new Map([engineRow('add', 15), engineRow('over', 6)]))
    const rows = [row(player('add', 12), player('over', 8))]
    await attachAfEngine(rows, { season: '2026', week: 4 }, (id) => (id === 'add' ? 10 : 8))
    expect(rows[0].add.afProjected).toBe(18)
    expect(rows[0].startsOver?.afProjected).toBe(6)
    expect(rows[0].afNetGain).toBe(12)
    // The ranking key is not touched.
    expect(rows[0].netGain).toBe(4)
  })

  it('never nets against the DROP — a bench player never scored for you', async () => {
    /* Under the old add-minus-drop rule this read 18 - 2 = 16; the lineup swap is 18 - 6 = 12. */
    h.engine.mockResolvedValue(new Map([engineRow('add', 15), engineRow('over', 6), engineRow('drop', 2)]))
    const rows = [row(player('add', 12), player('over', 8), player('drop', 3))]
    await attachAfEngine(rows, { season: '2026', week: 4 }, (id) => (id === 'add' ? 10 : id === 'over' ? 8 : 3))
    expect(rows[0].drop?.afProjected).toBe(2)
    expect(rows[0].afNetGain).toBe(12)
  })

  it('names no AF swap when the engine priced only half of it', async () => {
    h.engine.mockResolvedValue(new Map([engineRow('add', 15)]))
    const rows = [row(player('add', 12), player('over', 8))]
    await attachAfEngine(rows, { season: '2026', week: 4 }, () => 10)
    expect(rows[0].add.afProjected).toBe(18)
    expect(rows[0].startsOver && 'afProjected' in rows[0].startsOver).toBe(false)
    expect(rows[0].afNetGain).toBeUndefined()
  })

  it('an add that fills an empty slot nets the add alone', async () => {
    h.engine.mockResolvedValue(new Map([engineRow('add', 9)]))
    const rows = [row(player('add', 9), null)]
    await attachAfEngine(rows, { season: '2026', week: 4 }, () => 9)
    expect(rows[0].afNetGain).toBe(9)
  })
})

describe('WaiverLineupBoard — the per-league panel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows AF beside the provider projection, for the free agent and the starter he displaces', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        state: 'ok', season: '2026', week: 4, currentLineupPoints: 120,
        candidates: [{
          sleeperId: '1', name: 'Free Agent', position: 'WR', team: 'KC', projectedPoints: 14.2, afProjectedPoints: 15.6,
          gain: 3.1, displaces: { sleeperId: 'x', name: 'Incumbent', projectedPoints: 11.1, afProjectedPoints: 10.4 },
          basis: 'projection',
        }],
        notes: [],
      }),
    })) as never)
    render(<WaiverLineupBoard leagueId="lg1" />)
    await waitFor(() => expect(screen.getByTestId('waiver-lineup-board')).toBeTruthy())
    const text = screen.getByTestId('waiver-lineup-board').textContent ?? ''
    expect(text).toContain('AF 15.6')
    expect(text).toContain('AF 10.4')
    // The gain is still the provider's.
    expect(text).toContain('+3.1')
  })
})
