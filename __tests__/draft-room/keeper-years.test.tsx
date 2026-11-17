/**
 * Keeper leagues: a kept player's tile says which year he is being kept ("Rd 4 · Yr 2"), counted
 * from the league's locked keeper history — the same count the max-years rule uses. Never from
 * `KeeperRecord.yearsKept`, which `selectionEngine` writes as a constant 1.
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ locked: [] as unknown, fail: false }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    keeperRecord: {
      findMany: vi.fn(async () => {
        if (h.fail) throw new Error('db down')
        return h.locked
      }),
    },
    league: { findUnique: vi.fn(async () => null) },
    $queryRaw: vi.fn(async () => []),
  },
}))
vi.mock('@/lib/salary-cap/SalaryCapLeagueConfig', () => ({ getSalaryCapConfig: vi.fn(async () => null) }))

import { countKeeperYears, keeperNameKey, keeperPlayerKeys } from '@/lib/keeper/keeperPlayerKey'
import { loadDraftRoomLeagueFacts } from '@/lib/draft-room/loadDraftRoomLeagueFacts'
import { DraftBoard } from '@/components/app/draft-room/DraftBoard'
import { draftRoomHeaderMessages } from '@/lib/core-app/messages/draftRoomHeader'

beforeEach(() => { h.locked = []; h.fail = false })
afterEach(cleanup)

describe('counting a keeper history', () => {
  it('counts each locked season under the player id and the name + position', () => {
    const years = countKeeperYears([
      { playerId: 'p1', playerName: 'Atlas Runner', position: 'RB' },
      { playerId: 'p1', playerName: 'Atlas Runner', position: 'RB' },
      // An older record with no id still counts, under the name.
      { playerId: null, playerName: 'Atlas  Runner', position: 'rb' },
      { playerId: 'p2', playerName: 'Bo Hands', position: 'WR' },
    ])
    expect(years.get('p1')).toBe(2)
    expect(years.get(keeperNameKey('Atlas Runner', 'RB'))).toBe(3)
    expect(years.get('p2')).toBe(1)
    expect(keeperPlayerKeys({ playerId: '  ', playerName: 'X', position: 'QB' })).toEqual([keeperNameKey('X', 'QB')])
  })
})

describe('what the room is given', () => {
  const base = { leagueId: 'L', concept: 'keeper' as const, draftType: 'snake', rounds: 3, teamCount: 3 }

  it('only players kept 2+ seasons, by every key', async () => {
    h.locked = [
      { playerId: 'p1', playerName: 'Atlas Runner', position: 'RB' },
      { playerId: 'p1', playerName: 'Atlas Runner', position: 'RB' },
      { playerId: 'p2', playerName: 'Bo Hands', position: 'WR' },
    ]
    const facts = await loadDraftRoomLeagueFacts(base)
    expect(facts.keeperYearsByPlayer).toEqual({ p1: 2, [keeperNameKey('Atlas Runner', 'RB')]: 2 })
  })

  it('no history, only first-year keepers, or a failed read: nothing', async () => {
    expect((await loadDraftRoomLeagueFacts(base)).keeperYearsByPlayer ?? null).toBeNull()
    h.locked = [{ playerId: 'p2', playerName: 'Bo Hands', position: 'WR' }]
    expect((await loadDraftRoomLeagueFacts(base)).keeperYearsByPlayer ?? null).toBeNull()
    h.fail = true
    expect((await loadDraftRoomLeagueFacts(base)).keeperYearsByPlayer ?? null).toBeNull()
  })
})

describe('the kept tile', () => {
  const lock = { round: 2, slot: 2, overall: 5, rosterId: 'r2', displayName: 'Team 2', playerName: 'Atlas Runner', position: 'RB', team: 'NYJ', playerId: 'p1', isKeeper: true as const }
  const renderBoard = (keeperYearsByPlayer: Record<string, number> | null, locks = [lock]) =>
    render(
      <DraftBoard
        picks={[]}
        slotOrder={[1, 2, 3].map((slot) => ({ slot, rosterId: `r${slot}`, displayName: `Team ${slot}` }))}
        teamCount={3}
        rounds={2}
        draftType="snake"
        thirdRoundReversal={false}
        keeperLocks={locks}
        keeperYearsByPlayer={keeperYearsByPlayer}
      />,
    )

  it('says the year beside the round it costs, and "Costs" gives way on a narrow tile', () => {
    renderBoard({ p1: 3 })
    const cost = screen.getByTestId('draft-board-cell-keeper-cost-5')
    expect(cost.textContent).toBe('Costs Rd 2 · Yr 3')
    expect(cost.querySelector('.af-tile-squeezable')?.textContent).toBe('Costs ')
    expect(screen.getByTestId('draft-board-cell-keeper-year-5').getAttribute('aria-label')).toBe('Year 3 as a keeper')
  })

  it('finds a keeper by name + position when the lock has no id', () => {
    renderBoard({ [keeperNameKey('Atlas Runner', 'RB')]: 2 }, [{ ...lock, playerId: null as unknown as string }])
    expect(screen.getByTestId('draft-board-cell-keeper-cost-5').textContent).toBe('Costs Rd 2 · Yr 2')
  })

  it('a first-year keeper, or no history, keeps the tile as it was', () => {
    renderBoard(null)
    expect(screen.getByTestId('draft-board-cell-keeper-cost-5').textContent).toBe('Costs Rd 2')
    expect(screen.queryByTestId('draft-board-cell-keeper-year-5')).toBeNull()
  })

  it('Spanish says it too', () => {
    expect(draftRoomHeaderMessages.es.keeperYear(2)).toBe('Año 2')
    expect(draftRoomHeaderMessages.es.keeperYearTitle(2)).toBe('Año 2 como keeper')
  })
})
