/**
 * The settings window's Roster tab saves the roster the league plays with (2026-11-15).
 *
 * 🛑 Its own football-only grid sent a slot-count key the settings save ignores: every change showed and vanished, and
 * an NBA / MLB / NHL / soccer league was shown football positions. The tab now renders the League settings roster
 * editor for the league's own sport, and that editor's save keeps `League.irSlots` on the IR/IL count it saved.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const editor = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }))
vi.mock('@/components/league-settings/RosterSettingsEditor', () => ({
  RosterSettingsEditor: (p: Record<string, unknown>) => {
    editor.props.push(p)
    return <div data-testid="real-roster-editor" />
  },
}))
vi.mock('next/navigation', () => ({ useParams: () => ({ leagueId: 'L1' }) }))
vi.mock('@/app/league/[leagueId]/components/settings/TaxiSquadSettingsSection', () => ({ TaxiSquadSettingsSection: () => null }))
vi.mock('@/app/league/[leagueId]/components/settings/DynastyFormatPresetSection', () => ({ DynastyFormatPresetSection: () => null }))
vi.mock('@/app/league/[leagueId]/components/settings/useDynastySettingsSnapshot', () => ({
  useDynastySettingsSnapshot: () => ({ snapshot: null, put: vi.fn(), reload: vi.fn() }),
}))
const db = vi.hoisted(() => ({ league: { update: vi.fn(async () => ({})) } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { RosterComplianceSettingsPanel } from '@/app/league/[leagueId]/components/settings/RosterComplianceSettingsPanel'
import { injuredReserveSlotCount, syncLeagueIrSlotsColumn } from '@/lib/roster-engine/irSlotsColumn'

beforeEach(() => {
  editor.props = []
  vi.clearAllMocks()
})

describe('the Roster tab', () => {
  it('shows the league\'s own sport in the real roster editor, and no football grid', () => {
    const save = vi.fn()
    render(<RosterComplianceSettingsPanel initialData={{ sport: 'NBA' } as never} canEdit debouncedSave={save} />)
    expect(screen.getByTestId('real-roster-editor')).toBeTruthy()
    expect(editor.props[0]).toMatchObject({ leagueId: 'L1', sport: 'NBA' })
    expect(screen.queryByText('Quarterback')).toBeNull()
    expect(screen.queryByText('Injured reserve slots')).toBeNull()
    expect(save).not.toHaveBeenCalled()
  })
})

describe('the IR count the roster editor saves', () => {
  it('counts IR and IL seats, never taxi or bench', () => {
    expect(injuredReserveSlotCount({ QB: 1, BN: 6, IR: 2, TAXI: 3 })).toBe(2)
    expect(injuredReserveSlotCount({ C: 2, IL: 1, IL_PLUS: 1, BN: 4 })).toBe(2)
    expect(injuredReserveSlotCount({})).toBe(0)
  })

  it('is written to League.irSlots, and a failed write never fails the save', async () => {
    await syncLeagueIrSlotsColumn('L1', { IR: 3, BN: 5 })
    expect(db.league.update).toHaveBeenCalledWith({ where: { id: 'L1' }, data: { irSlots: 3 } })
    db.league.update.mockRejectedValueOnce(new Error('db down'))
    await expect(syncLeagueIrSlotsColumn('L1', { IR: 1 })).resolves.toBeUndefined()
  })
})
