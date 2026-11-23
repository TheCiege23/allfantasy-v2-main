/**
 * Draft room Phase 1, "space & duplicates" (2026-11-19). Reported from a live 8-team redraft:
 * auto-pick on but nothing on the manager's box, two Resume buttons, two auto-pick switches,
 * a legend that did not match the cells, "Current" duplicating "Focus round", a column of
 * AF ADP dashes, and a board squeezed by the tray.
 */
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  rosters: [] as Array<{ id: string; platformUserId: string | null; managerUserId: string | null }>,
  prefs: [] as Array<{ userId: string }>,
  settings: {} as unknown,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => ({ settings: db.settings })) },
    roster: { findMany: vi.fn(async () => db.rosters) },
    liveDraftAutopickPreference: { findMany: vi.fn(async () => db.prefs) },
  },
}))
vi.mock('@/lib/inactive-manager/chimmyPlayable', () => ({
  readPlayableChimmyLineups: vi.fn(async () => ({ r3: { autopilot: true } })),
}))

import { listAutoDraftRosterIds } from '@/lib/live-draft-engine/instantAutopick'
import { mergeDraftSessionSnapshot } from '@/lib/draft-room/mergeDraftSessionSnapshot'
import { buildSleeperPoolTableLayout } from '@/lib/draft-room/sleeperPoolTableLayout'
import { DraftBoard } from '@/components/app/draft-room/DraftBoard'
import type { DraftSessionSnapshot } from '@/lib/live-draft-engine/types'

afterEach(cleanup)

beforeEach(() => {
  db.rosters = [
    { id: 'r1', platformUserId: 'u1', managerUserId: null },
    { id: 'r2', platformUserId: 'u2', managerUserId: null },
    { id: 'r3', platformUserId: null, managerUserId: null },
    { id: 'r4', platformUserId: 'orphan-4', managerUserId: null },
  ]
  db.prefs = [{ userId: 'u2' }, { userId: 'orphan-4' }]
})

describe('which seats are drafting automatically', () => {
  it('lists managers with Auto-pick me on and Chimmy-run teams, never an orphan placeholder id', async () => {
    const ids = await listAutoDraftRosterIds({ leagueId: 'L', draftSessionId: 'ds' })
    expect(ids.sort()).toEqual(['r2', 'r3'])
  })
})

describe('the AUTO badge on the board', () => {
  const slotOrder = [1, 2, 3].map((slot) => ({ slot, rosterId: `r${slot}`, displayName: `Team ${slot}` }))

  it('marks exactly the seats that pick by themselves', () => {
    render(
      <DraftBoard picks={[]} slotOrder={slotOrder} teamCount={3} rounds={2} draftType="snake" thirdRoundReversal={false}
        autoDraftRosterIds={['r2']} />,
    )
    expect(screen.getByTestId('draft-board-team-header-auto-2').textContent).toBe('AUTO')
    expect(screen.queryByTestId('draft-board-team-header-auto-1')).toBeNull()
    expect(screen.queryByTestId('draft-board-team-header-auto-3')).toBeNull()
  })

  it('has no separate "Current" button; Focus round jumps to the round on the clock', () => {
    render(
      <DraftBoard picks={[]} slotOrder={slotOrder} teamCount={3} rounds={4} draftType="snake" thirdRoundReversal={false}
        currentOverallPick={8} />,
    )
    expect(screen.queryByTestId('draft-board-jump-current')).toBeNull()
    const toggle = screen.getByTestId('draft-board-toggle-view-mode')
    if (toggle.textContent === 'All rounds') fireEvent.click(toggle) // start from all rounds
    fireEvent.click(screen.getByTestId('draft-board-toggle-view-mode'))
    expect((screen.getByTestId('draft-board-round-selector') as HTMLSelectElement).value).toBe('3')
  })

  it('draws legend swatches as the cells are drawn: offset rings, white for your picks', () => {
    render(
      <DraftBoard picks={[]} slotOrder={slotOrder} teamCount={3} rounds={2} draftType="snake" thirdRoundReversal={false}
        currentUserRosterId="r1" />,
    )
    expect(screen.getByTestId('draft-board-legend-just-picked').className).toContain('ring-emerald-300')
    expect(screen.getByTestId('draft-board-legend-your-picks').className).toContain('ring-white')
  })
})

describe('the AUTO list follows a toggle without waiting for a pick', () => {
  it('is applied when the board itself has not moved', () => {
    const base = { id: 's', status: 'in_progress', version: 3, picks: [], slotOrder: [], updatedAt: '2026-11-19T00:00:00Z',
      currentPick: null, timer: { status: 'running' }, teamCount: 2, rounds: 2, autoDraftRosterIds: [] } as unknown as DraftSessionSnapshot
    const next = { ...base, autoDraftRosterIds: ['r1'] } as DraftSessionSnapshot
    expect(mergeDraftSessionSnapshot(base, next)?.autoDraftRosterIds).toEqual(['r1'])
    // An equal list keeps the same object, so polls do not re-render the room for nothing.
    const same = { ...base, autoDraftRosterIds: [] } as DraftSessionSnapshot
    expect(mergeDraftSessionSnapshot(base, same)).toBe(base)
  })
})

describe('AF ADP column', () => {
  it('is left out until AllFantasy has a value for this pool', () => {
    const keys = (hide: boolean) => buildSleeperPoolTableLayout('NFL', undefined, { hideAfAdp: hide }).columns.map((c) => c.key)
    expect(keys(true)).not.toContain('afAdp')
    expect(keys(false)).toContain('afAdp')
    expect(keys(true)).toContain('adp')
  })
})
