/**
 * Draft room Phase 4 (2026-11-19): the commissioner center in plain-English sections — Live
 * controls, Fix a pick, Penalties (forfeit), Managers (with Swap explained), Finish or start over,
 * Advanced — league-type options only in that league type, and nothing editable once the draft is final.
 */
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  session: null as null | Record<string, unknown>,
  upsert: vi.fn(async () => ({})),
  skip: vi.fn(async () => 0),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: { findFirst: vi.fn(async () => db.session) },
    league: { findUnique: vi.fn(async () => ({ season: 2026 })) },
    futureDraftPick: { upsert: db.upsert },
  },
}))
vi.mock('@/lib/live-draft-engine/forfeitedPickSkips', () => ({ skipForfeitedPicksOnClock: db.skip }))
vi.mock('@/lib/live-draft-engine/PickSubmissionService', () => ({ submitPick: vi.fn() }))

import { CommissionerControlCenterModal } from '@/components/app/draft-room/CommissionerControlCenterModal'
import { forfeitDraftPick, overallForSlotInRound } from '@/lib/live-draft-engine/commissioner/forfeitDraftPick'

afterEach(cleanup)

const seats = [
  { slot: 1, rosterId: 'r1', displayName: 'Kim', status: 'human' as const },
  { slot: 2, rosterId: 'r2', displayName: 'Lee', status: 'auto' as const },
  { slot: 3, rosterId: 'r3', displayName: 'Open Team 3', status: 'chimmy' as const },
]

function renderModal(over: Partial<React.ComponentProps<typeof CommissionerControlCenterModal>> = {}) {
  const onAction = vi.fn().mockResolvedValue({ ok: true })
  const onOpenPickEditor = vi.fn()
  render(
    <CommissionerControlCenterModal
      leagueId="L1"
      draftStatus="in_progress"
      draftType="snake"
      draftUISettings={{ timerMode: 'per_pick' } as never}
      timerSeconds={90}
      rounds={15}
      teamCount={8}
      seats={seats}
      leagueType="redraft"
      onClose={vi.fn()}
      onAction={onAction}
      onSettingsPatch={vi.fn().mockResolvedValue(undefined)}
      onResync={vi.fn()}
      onOpenPickEditor={onOpenPickEditor}
      {...over}
    />,
  )
  return { onAction, onOpenPickEditor }
}

describe('commissioner center sections', () => {
  it('explains the live controls in plain words', () => {
    renderModal()
    expect(screen.getByTestId('draft-commissioner-live-help').textContent).toMatch(/puts that player back in the pool/)
  })

  it('never shows Guillotine or Survivor options in a redraft league', () => {
    renderModal()
    expect(screen.queryByTestId('draft-commissioner-toggle-guillotine-auto-heygen')).toBeNull()
    expect(screen.queryByTestId('draft-commissioner-toggle-survivor-auto-heygen')).toBeNull()
  })

  it('shows the Guillotine option only in a guillotine league', () => {
    renderModal({ leagueType: 'guillotine' })
    expect(screen.getByTestId('draft-commissioner-toggle-guillotine-auto-heygen')).toBeTruthy()
    expect(screen.queryByTestId('draft-commissioner-toggle-survivor-auto-heygen')).toBeNull()
  })

  it('opens the pick editor on the chosen pick (Fix a pick)', () => {
    const { onOpenPickEditor } = renderModal()
    fireEvent.change(screen.getByTestId('draft-commissioner-fix-round'), { target: { value: '3' } })
    fireEvent.change(screen.getByTestId('draft-commissioner-fix-pick-number'), { target: { value: '6' } })
    fireEvent.click(screen.getByTestId('draft-commissioner-open-pick-editor'))
    expect(onOpenPickEditor).toHaveBeenCalledWith(2 * 8 + 6)
  })

  it('forfeits a team\'s pick in a round, with the reason', async () => {
    const { onAction } = renderModal()
    fireEvent.change(screen.getByTestId('draft-commissioner-forfeit-team'), { target: { value: 'r2' } })
    fireEvent.change(screen.getByTestId('draft-commissioner-forfeit-round'), { target: { value: '4' } })
    fireEvent.change(screen.getByTestId('draft-commissioner-forfeit-reason'), { target: { value: 'late payment' } })
    fireEvent.click(screen.getByTestId('draft-commissioner-forfeit-submit'))
    await waitFor(() => expect(onAction).toHaveBeenCalledWith('forfeit_pick', { rosterId: 'r2', round: 4, reason: 'late payment' }))
    expect(await screen.findByTestId('draft-commissioner-forfeit-message')).toBeTruthy()
  })

  it('lists every seat with who drafts for it, and explains Swap', () => {
    renderModal()
    expect(screen.getByTestId('draft-commissioner-seat-2').textContent).toContain('Auto')
    expect(screen.getByTestId('draft-commissioner-seat-3').textContent).toContain('Chimmy')
    expect(screen.getByTestId('draft-commissioner-managers').textContent).toMatch(/Picks already made stay where they are/)
  })

  it('only resets the whole draft after RESET is typed', async () => {
    const { onAction } = renderModal()
    const reset = screen.getByTestId('draft-commissioner-reset-draft') as HTMLButtonElement
    expect(reset.disabled).toBe(true)
    fireEvent.change(screen.getByTestId('draft-commissioner-reset-confirm-text'), { target: { value: 'reset' } })
    expect(reset.disabled).toBe(false)
    fireEvent.click(reset)
    await waitFor(() => expect(onAction).toHaveBeenCalledWith('reset_draft'))
  })

  it('once the draft is final: says so, and offers nothing that changes it', () => {
    renderModal({ draftStatus: 'completed' })
    expect(screen.getByTestId('draft-commissioner-final').textContent).toMatch(/on the record/)
    expect(screen.queryByTestId('draft-commissioner-fix-pick')).toBeNull()
    expect(screen.queryByTestId('draft-commissioner-penalties')).toBeNull()
    expect(screen.queryByTestId('draft-commissioner-finish')).toBeNull()
    expect(screen.queryByTestId('draft-commissioner-open-swap-manager')).toBeNull()
  })
})

describe('forfeitDraftPick', () => {
  beforeEach(() => {
    db.upsert.mockClear()
    db.skip.mockClear()
    db.session = {
      id: 's1', status: 'in_progress', draftType: 'snake', rounds: 15, teamCount: 8, thirdRoundReversal: false,
      slotOrder: [{ slot: 1, rosterId: 'r1', displayName: 'Kim' }, { slot: 2, rosterId: 'r2', displayName: 'Lee' }],
      picks: [{ overall: 1 }, { overall: 2 }],
    }
  })

  it('finds a slot\'s overall pick, snake order reversing in even rounds', () => {
    expect(overallForSlotInRound({ round: 1, slot: 2, teamCount: 8, draftType: 'snake', thirdRoundReversal: false })).toBe(2)
    expect(overallForSlotInRound({ round: 2, slot: 2, teamCount: 8, draftType: 'snake', thirdRoundReversal: false })).toBe(15)
    expect(overallForSlotInRound({ round: 2, slot: 2, teamCount: 8, draftType: 'linear', thirdRoundReversal: false })).toBe(10)
  })

  it('marks the pick forfeited for this draft and skips it now if it is on the clock', async () => {
    const res = await forfeitDraftPick({ leagueId: 'L1', round: 2, originalRosterId: 'r2', reason: 'late payment' })
    expect(res).toEqual({ ok: true, overall: 15, skippedNow: 0 })
    expect(db.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { leagueId_pickSeason_round_originalRosterId: { leagueId: 'L1', pickSeason: 2026, round: 2, originalRosterId: 'r2' } },
      update: expect.objectContaining({ status: 'forfeited', usedInDraftSessionId: 's1', forfeitReason: 'commissioner: late payment' }),
    }))
    expect(db.skip).toHaveBeenCalledTimes(1)
  })

  it('refuses a pick already made, and a finished draft', async () => {
    expect(await forfeitDraftPick({ leagueId: 'L1', round: 1, originalRosterId: 'r2', reason: '' })).toMatchObject({ ok: false, code: 'PICK_ALREADY_MADE' })
    db.session = { ...db.session!, status: 'completed' }
    expect(await forfeitDraftPick({ leagueId: 'L1', round: 3, originalRosterId: 'r2', reason: '' })).toMatchObject({ ok: false, code: 'INVALID_STATUS' })
    expect(db.upsert).not.toHaveBeenCalled()
  })

  it('does not run the skip while the draft is paused (resume runs it)', async () => {
    db.session = { ...db.session!, status: 'paused' }
    await forfeitDraftPick({ leagueId: 'L1', round: 3, originalRosterId: 'r1', reason: '' })
    expect(db.upsert).toHaveBeenCalledTimes(1)
    expect(db.skip).not.toHaveBeenCalled()
  })
})
